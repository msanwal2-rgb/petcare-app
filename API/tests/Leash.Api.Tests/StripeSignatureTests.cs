using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Leash.Core.Payments;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/stripe-signature.test.ts</c>.
///
/// The one thing the fake provider cannot cover, and worth a file of its own:
/// if this check is wrong, <c>POST /webhooks/stripe</c> is an open,
/// unauthenticated endpoint that marks orders paid on request.
///
/// Runs offline against the real Stripe.net verifier, through the one wrapper
/// the webhook route uses, with a made-up secret — no account, no key, no
/// network. The signature is built by hand, the way Stripe builds it, so the
/// test does not trust the library to agree with itself.
/// </summary>
public sealed class StripeSignatureTests
{
    private const string Secret = "whsec_test_secret_for_signature_verification";

    private static readonly string Payload = JsonSerializer.Serialize(new
    {
        id = "evt_test",
        @object = "event",
        type = "payment_intent.succeeded",
        api_version = "2025-08-27.basil",
        created = 1_800_000_000,
        data = new { @object = new { id = "pi_test", @object = "payment_intent" } },
    });

    /// <summary>Build the <c>Stripe-Signature</c> header the way Stripe does.</summary>
    private static string Sign(string payload, string secret, long timestamp)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{payload}"));
        return $"t={timestamp},v1={Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    [Fact]
    public void Accepts_a_correctly_signed_payload()
    {
        var evt = StripeWebhookSignature.Verify(Payload, Sign(Payload, Secret, Now), Secret);

        Assert.NotNull(evt);
        Assert.Equal("evt_test", evt.Id);
        Assert.Equal("payment_intent.succeeded", evt.Type);
    }

    [Fact]
    public void Accepts_an_event_from_another_api_version()
    {
        // The endpoint's version is set in Stripe's dashboard and can drift from
        // the library's. Refusing every event on a mismatch would turn a
        // dashboard click into a payment outage; the handler reads fields that
        // have been stable for years instead.
        var other = Payload.Replace("2025-08-27.basil", "2024-06-20");

        Assert.NotNull(StripeWebhookSignature.Verify(other, Sign(other, Secret, Now), Secret));
    }

    [Fact]
    public void Rejects_a_payload_that_was_tampered_with_after_signing()
    {
        // The attack this stops: take a real event, change it, resend it.
        var signature = Sign(Payload, Secret, Now);
        var tampered = Payload.Replace("pi_test", "pi_attacker");

        Assert.Null(StripeWebhookSignature.Verify(tampered, signature, Secret));
    }

    [Fact]
    public void Rejects_a_signature_made_with_the_wrong_secret()
        => Assert.Null(StripeWebhookSignature.Verify(
            Payload, Sign(Payload, "whsec_someone_elses_secret", Now), Secret));

    [Fact]
    public void Rejects_a_replayed_signature_that_is_too_old()
    {
        // Stripe's tolerance is five minutes. Without it an intercepted signed
        // request stays valid forever.
        var longAgo = Now - 60 * 60;

        Assert.Null(StripeWebhookSignature.Verify(Payload, Sign(Payload, Secret, longAgo), Secret));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("t=,v1=")]
    [InlineData("garbage")]
    public void Rejects_a_missing_or_malformed_signature_header(string? header)
        => Assert.Null(StripeWebhookSignature.Verify(Payload, header, Secret));

    [Fact]
    public void Rejects_a_re_serialised_body()
    {
        // Why the route reads the raw body and never binds it: parsing and
        // re-serialising produces different bytes, and the signature is over
        // the bytes.
        var signature = Sign(Payload, Secret, Now);
        var reserialised = JsonSerializer.Serialize(
            JsonDocument.Parse(Payload).RootElement, new JsonSerializerOptions { WriteIndented = true });

        Assert.Null(StripeWebhookSignature.Verify(reserialised, signature, Secret));
    }

    [Fact]
    public void Refuses_everything_when_no_secret_is_configured()
    {
        // M6. A correctly-signed request against an empty secret must not pass —
        // an HMAC keyed on "" is computable by anyone.
        Assert.Null(StripeWebhookSignature.Verify(Payload, Sign(Payload, "", Now), ""));
    }
}
