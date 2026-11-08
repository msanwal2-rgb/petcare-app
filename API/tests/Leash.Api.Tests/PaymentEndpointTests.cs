using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Membership and the Stripe webhook over HTTP, and REQUIREMENTS.md §9.4's
/// acceptance: buy Leash Plus → free shipping at checkout and the consult
/// discount on a vet booking; deliver the same webhook event twice → it is
/// processed once.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class PaymentEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string MayaEmail = "maya.chen@example.com"; // u1, not a member

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private async Task<HttpClient> SignedInAsync(LeashApp app, string email = MayaEmail)
    {
        var client = app.CreateSessionClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = DemoPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    // ── Membership ───────────────────────────────────────────────────────

    [Theory]
    [InlineData("GET", "/api/v1/membership")]
    [InlineData("POST", "/api/v1/membership/checkout")]
    [InlineData("POST", "/api/v1/membership/cancel")]
    [InlineData("POST", "/api/v1/membership/resume")]
    [InlineData("POST", "/api/v1/membership/portal")]
    [InlineData("POST", "/api/v1/membership/sync")]
    public async Task Every_membership_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Buying_leash_plus_waives_shipping_and_discounts_the_vet()
    {
        var maya = await SignedInAsync(_app);
        var cart = new { items = new[] { new { productId = "prod13", quantity = 1 } } };

        var before = await JsonOf(await maya.PostAsJsonAsync("/api/v1/orders/quote", cart));
        Assert.True(before.GetProperty("shippingCents").GetInt32() > 0);

        var view = await JsonOf(await maya.GetAsync("/api/v1/membership"));
        Assert.False(view.GetProperty("membership").GetProperty("active").GetBoolean());
        Assert.True(view.GetProperty("plan").GetProperty("purchasable").GetBoolean());

        var checkout = await maya.PostAsync("/api/v1/membership/checkout", null);
        Assert.Equal(HttpStatusCode.OK, checkout.StatusCode);
        Assert.EndsWith("/account/membership?checkout=success", (await JsonOf(checkout)).GetProperty("url").GetString());

        var member = await JsonOf(await maya.GetAsync("/api/v1/membership"));
        Assert.True(member.GetProperty("membership").GetProperty("active").GetBoolean());

        // Free shipping, enforced in the quote — not a badge (M11).
        var after = await JsonOf(await maya.PostAsJsonAsync("/api/v1/orders/quote", cart));
        Assert.Equal(0, after.GetProperty("shippingCents").GetInt32());
        Assert.True(after.GetProperty("shippingWaivedByMembership").GetBoolean());

        // The consultation discount, snapshotted onto the appointment (V4, V5).
        // The clinic must be open then (STATUS §3-G).
        await Calendars.OpenVetAsync(db.ConnectionString, "v1");
        var start = Calendars.DaysAhead(3, hour: 10);
        var booked = await maya.PostAsJsonAsync("/api/v1/appointments", new
        {
            vetId = "v1", petId = "p1", mode = "in_clinic", reason = "Check-up", symptoms = Array.Empty<string>(),
            startDateTime = start, endDateTime = start.AddMinutes(30), notes = "",
        });
        Assert.Equal(HttpStatusCode.Created, booked.StatusCode);
        var id = (await JsonOf(booked)).GetProperty("id").GetString();

        var (baseFee, pct, fee) = await One<(int, int, int)>(
            "SELECT \"baseFeeCents\", \"discountPct\", \"feeCents\" FROM vet_appointments WHERE id = @id", new { id });
        Assert.Equal(20, pct);
        Assert.Equal(baseFee * 80 / 100, fee);
    }

    [Fact]
    public async Task A_member_buying_again_is_a_409()
    {
        var maya = await SignedInAsync(_app);
        await maya.PostAsync("/api/v1/membership/checkout", null);

        var again = await maya.PostAsync("/api/v1/membership/checkout", null);

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.True((await JsonOf(again)).TryGetProperty("error", out _));
    }

    [Fact]
    public async Task The_demo_billing_portal_is_a_503_not_a_pretend_page()
    {
        var maya = await SignedInAsync(_app);

        Assert.Equal(HttpStatusCode.ServiceUnavailable,
            (await maya.PostAsync("/api/v1/membership/portal", null)).StatusCode);
    }

    [Fact]
    public async Task Cancel_then_resume_over_http()
    {
        var maya = await SignedInAsync(_app);
        await maya.PostAsync("/api/v1/membership/checkout", null);

        var cancelled = await maya.PostAsync("/api/v1/membership/cancel", null);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.True((await JsonOf(cancelled)).TryGetProperty("endsAt", out _));

        Assert.Equal(HttpStatusCode.OK, (await maya.PostAsync("/api/v1/membership/resume", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await maya.PostAsync("/api/v1/membership/resume", null)).StatusCode);
    }

    [Fact]
    public async Task A_too_soon_appointment_says_when_a_member_could_have_booked()
    {
        var maya = await SignedInAsync(_app);
        var start = DateTimeOffset.UtcNow.AddHours(3);

        var refused = await maya.PostAsJsonAsync("/api/v1/appointments", new
        {
            vetId = "v1", petId = "p1", mode = "in_clinic", reason = "Urgent", symptoms = Array.Empty<string>(),
            startDateTime = start, endDateTime = start.AddMinutes(30), notes = "",
        });

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var body = await JsonOf(refused);
        Assert.False(body.GetProperty("isMember").GetBoolean());
        Assert.True(body.GetProperty("memberEarliestAt").GetDateTimeOffset()
                    < body.GetProperty("earliestAt").GetDateTimeOffset());
        Assert.Equal(24, body.GetProperty("leadTimeHours").GetInt32());
    }

    // ── The webhook ──────────────────────────────────────────────────────

    private static string Sign(string payload, string secret)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{payload}"));
        return $"t={timestamp},v1={Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static HttpRequestMessage Delivery(string payload, string? signature)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/webhooks/stripe")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        if (signature is not null) request.Headers.Add("Stripe-Signature", signature);
        return request;
    }

    private static string Succeeded(string intent, int amount) => StripeEvents.Json(
        "evt_endpoint_1", "payment_intent.succeeded",
        new
        {
            id = intent, @object = "payment_intent", amount, currency = "usd", status = "succeeded",
            metadata = new { orderId = "o1" },
        });

    [Fact]
    public async Task Refuses_every_request_while_the_signing_secret_is_unset()
    {
        // M6 — even a request signed with the secret someone guessed.
        var payload = Succeeded("pi_x", 100);

        var response = await _app.CreateClient().SendAsync(Delivery(payload, Sign(payload, LeashApp.TestWebhookSecret)));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    [Fact]
    public async Task Needs_no_session_and_refuses_a_bad_signature()
    {
        await using var app = new LeashApp(db.ConnectionString, LeashApp.TestWebhookSecret);
        var payload = Succeeded("pi_x", 100);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await app.CreateClient().SendAsync(Delivery(payload, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await app.CreateClient().SendAsync(Delivery(payload, Sign(payload, "whsec_wrong")))).StatusCode);
    }

    [Fact]
    public async Task The_same_event_delivered_twice_is_processed_once()
    {
        await using var app = new LeashApp(db.ConnectionString, LeashApp.TestWebhookSecret);

        await using (var conn = new NpgsqlConnection(db.ConnectionString))
        {
            await conn.ExecuteAsync("UPDATE orders SET status = 'pending_payment', \"paymentStatus\" = 'unpaid' WHERE id = 'o1'");
            await conn.ExecuteAsync(
                "UPDATE payments SET status = 'pending', \"providerRef\" = 'pi_endpoint', \"lastEventAt\" = NULL WHERE \"orderId\" = 'o1'");
            await conn.ExecuteAsync("DELETE FROM order_events WHERE \"orderId\" = 'o1'");
        }

        var total = await One<int>("SELECT \"totalCents\" FROM orders WHERE id = 'o1'");
        var payload = Succeeded("pi_endpoint", total);

        var first = await app.CreateClient().SendAsync(Delivery(payload, Sign(payload, LeashApp.TestWebhookSecret)));
        var second = await app.CreateClient().SendAsync(Delivery(payload, Sign(payload, LeashApp.TestWebhookSecret)));

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("duplicate", (await JsonOf(second)).GetProperty("claim").GetString());

        Assert.Equal("paid", await One<string>("SELECT status FROM orders WHERE id = 'o1'"));
        Assert.Equal(1, await One<int>(
            "SELECT count(*)::int FROM order_events WHERE \"orderId\" = 'o1' AND status = 'paid'"));
        Assert.Equal(("processed", 1), await One<(string, int)>(
            "SELECT status, attempts FROM webhook_events WHERE id = 'evt_endpoint_1'"));
    }

    [Fact]
    public async Task An_event_type_nobody_handles_is_a_200_not_a_retry_storm()
    {
        await using var app = new LeashApp(db.ConnectionString, LeashApp.TestWebhookSecret);
        var payload = StripeEvents.Json("evt_endpoint_2", "customer.discount.created", new { id = "di_1", @object = "discount" });

        var response = await app.CreateClient().SendAsync(Delivery(payload, Sign(payload, LeashApp.TestWebhookSecret)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("unknown_type", (await JsonOf(response)).GetProperty("skipped").GetString());
    }
}
