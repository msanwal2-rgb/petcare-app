using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// Dual auth (REQUIREMENTS.md A18): the same endpoints, a different credential,
/// selected by header.
///
/// The rotation tests are the ones that matter. A refresh token that is not
/// actually single-use is a long-lived bearer credential with extra steps, and
/// the failure is invisible — everything works, it is just no safer than not
/// rotating at all.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class MobileTokenTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string MayaEmail = "maya.chen@example.com";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    /// <summary>Sign in as a native client would: the header, and no cookie jar.</summary>
    private async Task<(string Access, string Refresh)> MobileLoginAsync()
    {
        var client = _app.CreateClient();
        client.DefaultRequestHeaders.Add("X-Leash-Client", "mobile");

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var tokens = (await JsonOf(response)).GetProperty("tokens");
        return (tokens.GetProperty("accessToken").GetString()!,
                tokens.GetProperty("refreshToken").GetString()!);
    }

    private HttpClient Bearer(string accessToken)
    {
        var client = _app.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", accessToken);
        return client;
    }

    [Fact]
    public async Task A_browser_login_returns_a_cookie_and_no_tokens()
    {
        var client = _app.CreateSessionClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        var body = await JsonOf(response);

        // Never both. An access token in a response the browser can read is
        // exactly what the HttpOnly cookie exists to avoid.
        Assert.Equal(JsonValueKind.Null, body.GetProperty("tokens").ValueKind);
        Assert.Contains("leash.session",
            string.Join(' ', response.Headers.GetValues("Set-Cookie")));
    }

    [Fact]
    public async Task A_mobile_login_returns_tokens_and_no_cookie()
    {
        var client = _app.CreateClient();
        client.DefaultRequestHeaders.Add("X-Leash-Client", "mobile");

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        Assert.NotEqual(JsonValueKind.Null, (await JsonOf(response)).GetProperty("tokens").ValueKind);
        Assert.False(response.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task An_access_token_reaches_a_guarded_endpoint()
    {
        var (access, _) = await MobileLoginAsync();

        var response = await Bearer(access).GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(MayaEmail, (await JsonOf(response)).GetProperty("email").GetString());
    }

    [Fact]
    public async Task A_garbage_bearer_token_is_401_with_the_envelope()
    {
        var response = await Bearer("not.a.jwt").GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        // The bearer challenge is suppressed so the body carries the same
        // envelope every other 401 uses.
        Assert.Equal("You must be signed in",
            (await JsonOf(response)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Refreshing_rotates_the_token()
    {
        var (_, refresh) = await MobileLoginAsync();

        var response = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await JsonOf(response);
        var next = body.GetProperty("refreshToken").GetString();

        Assert.NotNull(next);
        Assert.NotEqual(refresh, next);

        // And the new access token works.
        Assert.Equal(HttpStatusCode.OK,
            (await Bearer(body.GetProperty("accessToken").GetString()!)
                .GetAsync("/api/v1/me")).StatusCode);
    }

    [Fact]
    public async Task A_spent_refresh_token_is_refused_and_ends_every_session()
    {
        var (_, refresh) = await MobileLoginAsync();

        var first = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });
        var replacement = (await JsonOf(first)).GetProperty("refreshToken").GetString();

        // Replaying the spent token.
        var replay = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });

        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);

        // The whole chain goes with it. An honest client cannot replay — it
        // discarded the old token — so a replay means either theft or a lost
        // replacement, and both are answered by making everyone sign in again.
        var afterReplay = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = replacement });

        Assert.Equal(HttpStatusCode.Unauthorized, afterReplay.StatusCode);
    }

    [Fact]
    public async Task An_unknown_refresh_token_and_a_replayed_one_answer_identically()
    {
        var (_, refresh) = await MobileLoginAsync();
        await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });

        var replayed = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });

        var unknown = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = new string('a', 64) });

        // Distinguishing them would tell whoever holds a stolen token that they
        // have been noticed.
        Assert.Equal(
            await replayed.Content.ReadAsStringAsync(),
            await unknown.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Suspending_an_account_refuses_its_access_token()
    {
        var (access, _) = await MobileLoginAsync();

        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync("UPDATE users SET status = 'suspended' WHERE id = 'u1'");

        var response = await Bearer(access).GetAsync("/api/v1/me");

        // The JWT is still signed, unexpired and valid. It is refused because
        // the account behind it is re-checked on every request.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Logging_out_revokes_the_refresh_token()
    {
        var (access, refresh) = await MobileLoginAsync();

        Assert.Equal(HttpStatusCode.NoContent,
            (await Bearer(access).PostAsync("/api/v1/auth/logout", null)).StatusCode);

        var response = await _app.CreateClient().PostAsJsonAsync(
            "/api/v1/auth/refresh", new { refreshToken = refresh });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Only_the_hash_of_a_refresh_token_is_stored()
    {
        var (_, refresh) = await MobileLoginAsync();

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var stored = await conn.ExecuteScalarAsync<string>(
            "SELECT \"tokenHash\" FROM refresh_tokens WHERE \"userId\" = 'u1'");

        // A dump of this table must not be a set of working logins.
        Assert.NotEqual(refresh, stored);
        Assert.Equal(64, stored!.Length);
    }
}
