using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Leash.Core.Payments;

/// <summary>
/// Stripe's signature check, through Stripe.net's own verifier
/// (REQUIREMENTS.md M6). The one wrapper the webhook uses, so the test suite
/// and the route exercise the same code.
/// </summary>
public static class StripeWebhookSignature
{
    /// <summary>Stripe's default: an intercepted signed request stays usable for five minutes, not forever.</summary>
    public const long ToleranceSeconds = 300;

    /// <summary>
    /// The verified event, or null for anything that does not verify — a
    /// missing or malformed header, a wrong secret, a stale timestamp, a body
    /// changed by so much as its whitespace. An empty secret verifies nothing:
    /// an HMAC keyed on "" is computable by anyone.
    ///
    /// The API version is deliberately not enforced. It is set per endpoint in
    /// Stripe's dashboard and can drift from the library's; refusing on a
    /// mismatch would turn a dashboard click into a payment outage, and the
    /// handler reads only fields that have been stable for years.
    /// </summary>
    public static Stripe.Event? Verify(string payload, string? signatureHeader, string secret)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrWhiteSpace(signatureHeader)) return null;

        try
        {
            return Stripe.EventUtility.ConstructEvent(
                payload, signatureHeader, secret, ToleranceSeconds, throwOnApiVersionMismatch: false);
        }
        catch (Exception)
        {
            // Untrusted input that did not verify, whichever way it failed —
            // a bad signature (StripeException) or a body that would not parse.
            return null;
        }
    }
}

/// <summary>A verified event, as the claim store records it.</summary>
public sealed record IncomingEvent(string Id, string Type, DateTimeOffset EventAt, string ApiVersion, string Payload);

public enum ClaimKind
{
    /// <summary>Nobody has seen this event. Process it.</summary>
    New,

    /// <summary>Already processed or skipped. Answer 200 and do nothing.</summary>
    Duplicate,

    /// <summary>A previous attempt died mid-flight, or failed. Process it again.</summary>
    Retry,

    /// <summary>Another worker holds it. Answer 500 so the provider redelivers later.</summary>
    InFlight,

    /// <summary>Failed too many times. Answer 200; a human replays it.</summary>
    Exhausted,
}

public sealed record EventClaim(ClaimKind Kind, int Attempts = 0);

/// <summary>
/// Webhook idempotency — the claim protocol (REQUIREMENTS.md M7).
///
/// The obvious implementation is "insert the event id; on conflict, answer
/// 200". That loses events: insert <c>received</c>, crash halfway through, and
/// the provider's retry hits the conflict and is told all is well. The event is
/// gone for good, and the only symptom is an order that never got paid. So a
/// claim has five outcomes, and the difference between "somebody is working on
/// this" and "somebody died working on this" is a lock timestamp.
/// </summary>
public interface IWebhookEventStore
{
    Task<EventClaim> ClaimAsync(IncomingEvent incoming, DateTimeOffset now, CancellationToken ct = default);
    Task MarkProcessedAsync(string id, CancellationToken ct = default);
    Task MarkFailedAsync(string id, string error, CancellationToken ct = default);

    /// <summary>Settled, in the sense that there is nothing to do. Distinct from failed so the two can be told apart.</summary>
    Task MarkSkippedAsync(string id, string reason, CancellationToken ct = default);

    /// <summary>
    /// Drop old processed and skipped events: they carry email addresses and
    /// card last-fours, and nobody will replay them. Failed ones are kept —
    /// they are the ones somebody may still need.
    /// </summary>
    Task<int> PurgeOldEventsAsync(DateTimeOffset now, int retentionDays = 90, CancellationToken ct = default);
}

public sealed class WebhookEventStore(IWebhookEventRepository events) : IWebhookEventStore
{
    /// <summary>How long an in-flight claim is trusted before it is presumed dead.</summary>
    public static readonly TimeSpan LockTtl = TimeSpan.FromMinutes(5);

    /// <summary>How many times a failing event is retried before it is left for a human.</summary>
    public const int MaxAttempts = 5;

    public async Task<EventClaim> ClaimAsync(IncomingEvent incoming, DateTimeOffset now, CancellationToken ct = default)
    {
        if (await events.TryInsertClaimedAsync(
                incoming.Id, incoming.Type, incoming.ApiVersion, incoming.EventAt, incoming.Payload, now, ct))
            return new EventClaim(ClaimKind.New, 1);

        var existing = await events.GetAsync(incoming.Id, ct);
        if (existing is null) return new EventClaim(ClaimKind.InFlight); // vanished under us; let it retry

        if (existing.Status is "processed" or "skipped") return new EventClaim(ClaimKind.Duplicate, existing.Attempts);

        if (existing.Attempts >= MaxAttempts) return new EventClaim(ClaimKind.Exhausted, existing.Attempts);

        var fresh = existing.LockedAt is { } locked && now - locked < LockTtl;
        if (existing.Status == "received" && fresh) return new EventClaim(ClaimKind.InFlight, existing.Attempts);

        // Conditional on the row being as just read, so two redeliveries of a
        // dead event cannot both take it over.
        var attempts = await events.TryReclaimAsync(incoming.Id, existing, now, ct);
        return attempts is null
            ? new EventClaim(ClaimKind.InFlight, existing.Attempts)
            : new EventClaim(ClaimKind.Retry, attempts.Value);
    }

    public Task MarkProcessedAsync(string id, CancellationToken ct = default)
        => events.SetOutcomeAsync(id, "processed", "", Ids.Now(), ct);

    public Task MarkFailedAsync(string id, string error, CancellationToken ct = default)
        => events.SetOutcomeAsync(id, "failed", error.Length > 1000 ? error[..1000] : error, null, ct);

    public Task MarkSkippedAsync(string id, string reason, CancellationToken ct = default)
        => events.SetOutcomeAsync(id, "skipped", reason, Ids.Now(), ct);

    public Task<int> PurgeOldEventsAsync(DateTimeOffset now, int retentionDays = 90, CancellationToken ct = default)
        => events.PurgeSettledAsync(now.AddDays(-retentionDays), ct);
}

/// <summary>Why an event produced no change. Every one of these is a 200.</summary>
public static class WebhookSkipReasons
{
    public const string UnknownType = "unknown_type";
    public const string UnknownSubject = "unknown_subject";
    public const string Stale = "stale";
    public const string NoopTransition = "noop_transition";
}

public sealed record WebhookHandled(bool Handled, string? Effect = null, string? SkipReason = null)
{
    public static WebhookHandled Did(string effect) => new(true, effect);
    public static WebhookHandled Skip(string reason) => new(false, null, reason);
}

/// <summary>Turns a verified Stripe event into changes in this application. See <c>StripeWebhookHandler</c>.</summary>
public interface IStripeWebhookHandler
{
    Task<WebhookHandled> HandleAsync(Stripe.Event evt, CancellationToken ct = default);
}

public enum WebhookIntakeStatus
{
    /// <summary>No signing secret configured: every request refused. 403 (M6).</summary>
    NotConfigured,
    /// <summary>400.</summary>
    Unsigned,
    /// <summary>400.</summary>
    BadSignature,
    /// <summary>200.</summary>
    Processed,
    /// <summary>A business-level "no". 200 — it will be refused identically on every retry.</summary>
    Skipped,
    /// <summary>200.</summary>
    Duplicate,
    /// <summary>200; a human replays it.</summary>
    Exhausted,
    /// <summary>Another worker has it. 500, so Stripe redelivers later.</summary>
    InFlight,
    /// <summary>A transient failure. 500, so Stripe redelivers.</summary>
    Failed,
}

public sealed record WebhookIntakeResult(WebhookIntakeStatus Status, string? Detail = null);

/// <summary>
/// The whole of <c>POST /webhooks/stripe</c> below HTTP: verify, claim,
/// handle, record. Kept out of the controller so the "delivered twice,
/// processed once" property is testable without a server.
/// </summary>
public interface IStripeWebhookIntake
{
    /// <param name="payload">The raw body, byte for byte. A re-serialised body never verifies.</param>
    Task<WebhookIntakeResult> ReceiveAsync(string payload, string? signatureHeader, CancellationToken ct = default);
}

public sealed class StripeWebhookIntake(
    IConfiguration config,
    IWebhookEventStore store,
    IStripeWebhookHandler handler,
    ILogger<StripeWebhookIntake> log) : IStripeWebhookIntake
{
    private readonly string _secret = config["Payments:Stripe:WebhookSecret"] ?? "";

    public async Task<WebhookIntakeResult> ReceiveAsync(
        string payload, string? signatureHeader, CancellationToken ct = default)
    {
        // Fails closed. An endpoint that mutates orders and payments is not
        // something to leave open because a setting was forgotten.
        if (_secret.Length == 0) return new(WebhookIntakeStatus.NotConfigured);

        if (string.IsNullOrWhiteSpace(signatureHeader)) return new(WebhookIntakeStatus.Unsigned);

        var evt = StripeWebhookSignature.Verify(payload, signatureHeader, _secret);
        if (evt is null)
        {
            // Nothing from the payload is logged: it failed verification, so
            // none of it is trustworthy enough to write down.
            log.LogWarning("Stripe webhook signature verification failed");
            return new(WebhookIntakeStatus.BadSignature);
        }

        var claim = await store.ClaimAsync(
            new IncomingEvent(evt.Id, evt.Type, new DateTimeOffset(DateTime.SpecifyKind(evt.Created, DateTimeKind.Utc)),
                evt.ApiVersion ?? "", payload),
            Ids.Now(), ct);

        switch (claim.Kind)
        {
            case ClaimKind.Duplicate: return new(WebhookIntakeStatus.Duplicate, "duplicate");
            case ClaimKind.Exhausted: return new(WebhookIntakeStatus.Exhausted, "exhausted");
            case ClaimKind.InFlight: return new(WebhookIntakeStatus.InFlight);
        }

        try
        {
            var result = await handler.HandleAsync(evt, ct);
            if (result.Handled)
            {
                await store.MarkProcessedAsync(evt.Id, ct);
                return new(WebhookIntakeStatus.Processed, result.Effect);
            }

            await store.MarkSkippedAsync(evt.Id, result.SkipReason ?? "", ct);
            return new(WebhookIntakeStatus.Skipped, result.SkipReason);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Stripe webhook handler failed for {EventId}", evt.Id);
            await store.MarkFailedAsync(evt.Id, e.Message, CancellationToken.None);
            return new(WebhookIntakeStatus.Failed);
        }
    }
}
