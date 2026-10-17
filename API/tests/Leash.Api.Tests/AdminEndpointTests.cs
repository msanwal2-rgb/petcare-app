using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The admin console over HTTP: guarded, a 403 that explains rather than a 404
/// (D2), the role matrix, and two of REQUIREMENTS.md §13's journeys — staff
/// suspend a user and that user's very next request is refused (7); staff
/// refund an order and both the ledger and the customer's view show it (8).
///
/// Staff accounts sign in with <c>STAFF_PASSWORD</c>, which the suite does not
/// know; each test gives u21–u23 the demo password's hash instead.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AdminEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Maya = "maya.chen@example.com";        // u1, customer
    private const string Daniel = "daniel.reyes@example.com";   // u2, customer
    private const string Rosa = "rosa.delgado@example.com";     // u21, ops
    private const string Priya = "priya.raman@example.com";     // u22, admin
    private const string Tom = "tom.okafor@example.com";        // u23, support + finance

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
        {
            await conn.ExecuteAsync(
                """
                UPDATE users SET "passwordHash" = (SELECT "passwordHash" FROM users WHERE id = 'u1')
                WHERE id IN ('u21', 'u22', 'u23')
                """);
        }
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = DemoPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    [Theory]
    [InlineData("GET", "/api/v1/admin/stats")]
    [InlineData("GET", "/api/v1/admin/users")]
    [InlineData("GET", "/api/v1/admin/users/u1")]
    [InlineData("PATCH", "/api/v1/admin/users/u1")]
    [InlineData("DELETE", "/api/v1/admin/users/u1")]
    [InlineData("GET", "/api/v1/admin/professionals")]
    [InlineData("PATCH", "/api/v1/admin/professionals/v1")]
    [InlineData("GET", "/api/v1/admin/payments")]
    [InlineData("POST", "/api/v1/admin/payments/pay_seed_o1/refund")]
    [InlineData("GET", "/api/v1/admin/subscriptions")]
    [InlineData("PATCH", "/api/v1/admin/subscriptions/sub_seed_active")]
    [InlineData("GET", "/api/v1/admin/audit")]
    [InlineData("GET", "/api/v1/admin/settings")]
    [InlineData("PATCH", "/api/v1/admin/settings")]
    public async Task Every_admin_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/v1/admin/stats")]
    [InlineData("/api/v1/admin/users")]
    [InlineData("/api/v1/admin/payments")]
    [InlineData("/api/v1/admin/audit")]
    [InlineData("/api/v1/admin/settings")]
    public async Task A_customer_gets_a_403_that_explains(string path)
    {
        // D2: route existence is not a secret worth a 404.
        var maya = await SignedInAsync(Maya);
        var response = await maya.GetAsync(path);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("staff", (await JsonOf(response)).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData(Rosa, "/api/v1/admin/stats", HttpStatusCode.OK)]
    [InlineData(Rosa, "/api/v1/admin/users", HttpStatusCode.Forbidden)]
    [InlineData(Rosa, "/api/v1/admin/payments", HttpStatusCode.Forbidden)]
    [InlineData(Tom, "/api/v1/admin/users", HttpStatusCode.OK)]
    [InlineData(Tom, "/api/v1/admin/professionals", HttpStatusCode.OK)]
    [InlineData(Tom, "/api/v1/admin/payments", HttpStatusCode.OK)]
    [InlineData(Tom, "/api/v1/admin/subscriptions", HttpStatusCode.OK)]
    [InlineData(Tom, "/api/v1/admin/audit", HttpStatusCode.Forbidden)]
    [InlineData(Tom, "/api/v1/admin/settings", HttpStatusCode.Forbidden)]
    [InlineData(Priya, "/api/v1/admin/audit", HttpStatusCode.OK)]
    [InlineData(Priya, "/api/v1/admin/settings", HttpStatusCode.OK)]
    [InlineData(Priya, "/api/v1/admin/payments", HttpStatusCode.OK)]
    public async Task The_role_matrix(string email, string path, HttpStatusCode expected)
        => Assert.Equal(expected, (await (await SignedInAsync(email)).GetAsync(path)).StatusCode);

    [Fact]
    public async Task A_suspended_users_next_request_is_refused()
    {
        // Journey 7.
        var daniel = await SignedInAsync(Daniel);
        Assert.Equal(HttpStatusCode.OK, (await daniel.GetAsync("/api/v1/me")).StatusCode);

        var tom = await SignedInAsync(Tom);
        var suspended = await tom.PatchAsJsonAsync("/api/v1/admin/users/u2",
            new { action = "suspend", reason = "Chargeback fraud" });
        Assert.Equal(HttpStatusCode.OK, suspended.StatusCode);
        Assert.Equal("suspended", (await JsonOf(suspended)).GetProperty("status").GetString());

        // 401, not 403: the right client response is to sign out (A15).
        Assert.Equal(HttpStatusCode.Unauthorized, (await daniel.GetAsync("/api/v1/me")).StatusCode);
        // And signing in again is refused while suspended.
        var again = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/login", new { email = Daniel, password = DemoPassword });
        Assert.NotEqual(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task A_forced_sign_out_ends_existing_sessions_but_not_the_account()
    {
        var daniel = await SignedInAsync(Daniel);
        var tom = await SignedInAsync(Tom);

        await tom.PatchAsJsonAsync("/api/v1/admin/users/u2", new { action = "sign_out" });

        Assert.Equal(HttpStatusCode.Unauthorized, (await daniel.GetAsync("/api/v1/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await (await SignedInAsync(Daniel)).GetAsync("/api/v1/me")).StatusCode);
    }

    [Fact]
    public async Task A_staff_refund_shows_in_the_ledger_and_on_the_customers_order()
    {
        // Journey 8.
        var tom = await SignedInAsync(Tom);
        var refunded = await tom.PostAsJsonAsync("/api/v1/admin/payments/pay_seed_o1/refund",
            new { amountCents = 1000, reason = "requested_by_customer", note = "Torn bag" });

        Assert.Equal(HttpStatusCode.OK, refunded.StatusCode);
        Assert.Equal(1000, (await JsonOf(refunded)).GetProperty("amountCents").GetInt32());

        var ledger = await JsonOf(await tom.GetAsync("/api/v1/admin/payments?q=o1"));
        var row = ledger.GetProperty("items").EnumerateArray().Single(p => p.GetProperty("id").GetString() == "pay_seed_o1");
        Assert.Equal("partially_refunded", row.GetProperty("status").GetString());
        Assert.Equal(1000, row.GetProperty("refunds")[0].GetProperty("amountCents").GetInt32());

        var maya = await SignedInAsync(Maya);
        var order = await JsonOf(await maya.GetAsync("/api/v1/orders/o1"));
        Assert.Equal("partially_refunded", order.GetProperty("paymentStatus").GetString());
    }

    [Fact]
    public async Task Ops_cannot_refund()
    {
        var rosa = await SignedInAsync(Rosa);
        var response = await rosa.PostAsJsonAsync("/api/v1/admin/payments/pay_seed_o1/refund", new { });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("finance", (await JsonOf(response)).GetProperty("error").GetString());
    }

    [Theory]
    [InlineData("{\"action\":\"suspend\"}")]
    [InlineData("{\"action\":\"suspend\",\"reason\":\"ok\"}")]
    [InlineData("{\"action\":\"reactivate\",\"reason\":\"sneaky\"}")]
    [InlineData("{\"action\":\"set_roles\",\"roles\":[\"wizard\"]}")]
    [InlineData("{\"action\":\"promote_to_god\"}")]
    public async Task A_malformed_action_is_a_400(string body)
    {
        var tom = await SignedInAsync(Tom);
        var response = await tom.PatchAsync("/api/v1/admin/users/u2",
            new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Editing_your_own_staff_roles_is_a_403()
    {
        var priya = await SignedInAsync(Priya);
        var response = await priya.PatchAsJsonAsync("/api/v1/admin/users/u22",
            new { action = "set_staff_roles", staffRoles = new[] { "admin", "finance" } });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_audit_row_records_who_and_from_where()
    {
        var tom = await SignedInAsync(Tom);
        var request = new HttpRequestMessage(HttpMethod.Patch, "/api/v1/admin/users/u2")
        {
            Content = JsonContent.Create(new { action = "verify", verified = true }),
        };
        request.Headers.Add("X-Forwarded-For", "198.51.100.23, 10.0.0.1");
        Assert.Equal(HttpStatusCode.OK, (await tom.SendAsync(request)).StatusCode);

        var priya = await SignedInAsync(Priya);
        var log = await JsonOf(await priya.GetAsync("/api/v1/admin/audit?targetId=u2"));
        var entry = log.GetProperty("items")[0];
        Assert.Equal("user.verify", entry.GetProperty("action").GetString());
        Assert.Equal("tom.okafor@example.com", entry.GetProperty("actorEmail").GetString());
        Assert.Equal("198.51.100.23", entry.GetProperty("ip").GetString());
    }

    [Fact]
    public async Task Settings_reach_the_public_config()
    {
        var priya = await SignedInAsync(Priya);
        var saved = await priya.PatchAsJsonAsync("/api/v1/admin/settings",
            new { maintenanceBanner = "Back at noon", signupsOpen = false });
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);

        var config = await JsonOf(await _app.CreateClient().GetAsync("/api/v1/config"));
        Assert.Equal("Back at noon", config.GetProperty("maintenanceBanner").GetString());
        Assert.False(config.GetProperty("signupsOpen").GetBoolean());
    }

    [Fact]
    public async Task Only_staff_set_a_vets_verification()
    {
        // V11 from the other side: the vet's own profile form has no such field,
        // and this route refuses them.
        var naomi = await SignedInAsync("naomi.ruiz@example.com");
        var refused = await naomi.PatchAsJsonAsync("/api/v1/admin/professionals/v1", new { kind = "vet", status = "verified" });
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);

        var tom = await SignedInAsync(Tom);
        var done = await tom.PatchAsJsonAsync("/api/v1/admin/professionals/v1", new { kind = "vet", status = "pending" });
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);

        var vet = await JsonOf(await _app.CreateClient().GetAsync("/api/v1/vets/v1"));
        Assert.Equal("pending", vet.GetProperty("profile").GetProperty("verificationStatus").GetString());
    }
}
