using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The acceptance criteria in REQUIREMENTS.md section 3.4, over real HTTP:
///
///   sign up → verify → sign in → reach a guarded endpoint;
///   reset a password → the previous session is refused on its next request;
///   suspend an account → its session is refused on the next request.
///
/// The last two are the ones worth having. They cannot be tested at the service
/// layer at all — they are properties of the pipeline, and the pipeline is
/// where a session-revocation bug lives.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AuthEndpointTests(DatabaseFixture db) : IAsyncLifetime
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

    private async Task<HttpClient> SignedInAsync(
        string email = MayaEmail, string password = DemoPassword)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email, password });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    // ── the happy path ───────────────────────────────────────────────────

    [Fact]
    public async Task Sign_up_verify_sign_in_and_reach_a_guarded_endpoint()
    {
        var client = _app.CreateSessionClient();

        var signup = await client.PostAsJsonAsync("/api/v1/auth/signup", new
        {
            name = "Ada Lovelace",
            email = "ada@example.com",
            password = "analytical1",
        });

        Assert.Equal(HttpStatusCode.Created, signup.StatusCode);

        var created = await JsonOf(signup);
        Assert.False(created.GetProperty("user").GetProperty("verified").GetBoolean());

        // Signing up signs you in, so the guarded endpoint is already reachable.
        var me = await client.GetAsync("/api/v1/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal("ada@example.com", (await JsonOf(me)).GetProperty("email").GetString());

        // The verification link comes back in the response only because this is
        // development (EmailDevMode). In production it is only ever in the email.
        var devLink = created.GetProperty("devLink").GetString();
        Assert.NotNull(devLink);

        var token = System.Web.HttpUtility.ParseQueryString(new Uri(devLink).Query)["token"];
        var verify = await client.PostAsJsonAsync("/api/v1/auth/verify-email", new { token });

        Assert.Equal(HttpStatusCode.OK, verify.StatusCode);
        Assert.True((await JsonOf(verify))
            .GetProperty("user").GetProperty("verified").GetBoolean());
    }

    [Fact]
    public async Task Me_is_refused_without_a_session()
    {
        var response = await _app.CreateSessionClient().GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        // The envelope, not a redirect to an HTML login page — the client's
        // fetch layer parses this.
        Assert.Equal("You must be signed in",
            (await JsonOf(response)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Logout_clears_the_cookie_so_the_client_cannot_reuse_it()
    {
        var client = await SignedInAsync();

        var logout = await client.PostAsync("/api/v1/auth/logout", null);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        // The response carried a deletion for the session cookie, so the
        // client's jar no longer has one to send.
        Assert.Contains("leash.session", string.Join(' ', logout.Headers.GetValues("Set-Cookie")));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/me")).StatusCode);
    }

    [Fact]
    public async Task A_cookie_copied_before_logout_still_works_afterwards()
    {
        // ⚠ This documents a deliberate property, not a bug — but it is the one
        // people assume is not true, so it is pinned here rather than left to be
        // discovered.
        //
        // Cookie sign-out is client-side: the response deletes the cookie, and
        // there is no server-side session table to invalidate a copy that was
        // taken beforehand. REQUIREMENTS.md A14 is explicit about which events
        // bump the `sessionsValidFrom` watermark — password reset, suspension,
        // and an administrator forcing sign-out — and ordinary sign-out is
        // deliberately not one of them, because it would sign every other
        // device out too.
        //
        // So a leaked cookie survives its owner clicking "log out", for up to
        // the 30-day cookie lifetime. The mitigations that do exist: it is
        // HttpOnly (script cannot read it), Secure in production, and any of the
        // three watermark events kills it immediately. The mobile path has no
        // equivalent gap — sign-out revokes the refresh token server-side, so
        // the exposure there is the 15-minute access token.
        //
        // If this is ever prioritised, the fix is a server-side session table
        // keyed by a ticket id, which is a schema change and one lookup per
        // request. Do not "fix" it by bumping the watermark on logout.
        // Sign in and take a copy of the cookie value, the way anyone who had
        // stolen it would hold it.
        var login = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        var cookie = SessionCookieFrom(login);
        Assert.NotNull(cookie);

        // The legitimate client signs out.
        var signedOut = _app.CreateClient();
        signedOut.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(
            HttpStatusCode.NoContent,
            (await signedOut.PostAsync("/api/v1/auth/logout", null)).StatusCode);

        // The copy still works, because nothing server-side changed.
        var replay = _app.CreateClient();
        replay.DefaultRequestHeaders.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.OK, (await replay.GetAsync("/api/v1/me")).StatusCode);
    }

    [Fact]
    public async Task But_a_password_reset_kills_a_copied_cookie_immediately()
    {
        // The counterpart to the test above: the watermark is the mechanism that
        // does invalidate a copy, and it is what somebody whose account was
        // compromised actually reaches for.
        var login = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        var cookie = SessionCookieFrom(login);

        var forgot = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/forgot-password", new { email = MayaEmail });

        var devLink = (await JsonOf(forgot)).GetProperty("devLink").GetString();
        var token = System.Web.HttpUtility.ParseQueryString(new Uri(devLink!).Query)["token"];

        Assert.Equal(HttpStatusCode.OK, (await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/reset-password",
            new { token, password = "brandnew1" })).StatusCode);

        var replay = _app.CreateClient();
        replay.DefaultRequestHeaders.Add("Cookie", cookie);

        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/v1/me")).StatusCode);
    }

    /// <summary>The session cookie as a request-header value, from a login response.</summary>
    private static string? SessionCookieFrom(HttpResponseMessage response)
        => response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values
                .Select(v => v.Split(';')[0])
                .FirstOrDefault(v => v.StartsWith("leash.session=", StringComparison.Ordinal))
            : null;

    [Fact]
    public async Task Logout_is_idempotent_for_a_caller_with_no_session()
    {
        // A 401 here would mean a client whose session had already lapsed could
        // not clear its own state without special-casing the error.
        var response = await _app.CreateSessionClient().PostAsync("/api/v1/auth/logout", null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    // ── sign-in failures say nothing useful ──────────────────────────────

    [Fact]
    public async Task A_wrong_password_and_an_unknown_address_answer_identically()
    {
        var client = _app.CreateSessionClient();

        var wrongPassword = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = "nope" });

        var unknownEmail = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = "ghost@example.com", password = DemoPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);

        // Byte-identical. Anything else turns the sign-in form into a
        // membership lookup (REQUIREMENTS.md A10).
        Assert.Equal(
            await wrongPassword.Content.ReadAsStringAsync(),
            await unknownEmail.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Rate_limits_sign_in_per_email_address()
    {
        var client = _app.CreateSessionClient();

        // The rule permits 8 in 15 minutes; the ninth is refused.
        for (var attempt = 0; attempt < 8; attempt++)
        {
            var response = await client.PostAsJsonAsync(
                "/api/v1/auth/login", new { email = MayaEmail, password = "nope" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var throttled = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = "nope" });

        Assert.Equal(HttpStatusCode.TooManyRequests, throttled.StatusCode);

        // And the message does not say which limit tripped or whether the
        // address exists.
        var body = await JsonOf(throttled);
        Assert.Equal("Too many sign-in attempts. Try again in a few minutes.",
            body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_correct_password_clears_the_per_email_counter()
    {
        var client = _app.CreateSessionClient();

        for (var attempt = 0; attempt < 5; attempt++)
            await client.PostAsJsonAsync(
                "/api/v1/auth/login", new { email = MayaEmail, password = "nope" });

        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword })).StatusCode);

        // Someone who mistypes five times and then gets it right starts fresh,
        // so the next wrong attempt is not near a limit.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var remaining = await conn.ExecuteScalarAsync<int>(
            "SELECT count(*) FROM rate_limit_hits WHERE bucket = 'signin:email'");

        Assert.Equal(0, remaining);
    }

    // ── session revocation ───────────────────────────────────────────────

    [Fact]
    public async Task Resetting_a_password_refuses_the_previous_session()
    {
        var client = await SignedInAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/me")).StatusCode);

        var forgot = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/forgot-password", new { email = MayaEmail });

        var devLink = (await JsonOf(forgot)).GetProperty("devLink").GetString();
        Assert.NotNull(devLink);

        var token = System.Web.HttpUtility.ParseQueryString(new Uri(devLink).Query)["token"];

        var reset = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/reset-password", new { token, password = "brandnew1" });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // The cookie is untouched and still cryptographically valid. It is
        // refused because the watermark now post-dates it.
        var after = await client.GetAsync("/api/v1/me");

        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        Assert.Equal("Please sign in again",
            (await JsonOf(after)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task Suspending_an_account_refuses_its_session_on_the_next_request()
    {
        var client = await SignedInAsync();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/me")).StatusCode);

        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            "UPDATE users SET status = 'suspended', \"suspendedAt\" = now() WHERE id = 'u1'");

        var after = await client.GetAsync("/api/v1/me");

        // 401 and not 403 (REQUIREMENTS.md A15): the correct client response is
        // to sign out, not to retry with the same cookie.
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
        Assert.Equal("Your account is not active",
            (await JsonOf(after)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_suspended_account_cannot_sign_in_at_all()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync("UPDATE users SET status = 'suspended' WHERE id = 'u1'");

        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Your account is not active",
            (await JsonOf(response)).GetProperty("error").GetString());
    }

    // ── validation and the error envelope ────────────────────────────────

    [Fact]
    public async Task A_short_password_is_a_400_with_a_field_path()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/signup", new
        {
            name = "Short",
            email = "short@example.com",
            password = "abc",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await JsonOf(response);
        Assert.Equal("Validation failed", body.GetProperty("error").GetString());

        var issue = body.GetProperty("issues").EnumerateArray().Single();

        // camelCase, so the form can map it back to the input it belongs to.
        Assert.Equal("password", issue.GetProperty("path").GetString());
        Assert.Equal("Use at least 8 characters.", issue.GetProperty("message").GetString());
    }

    [Fact]
    public async Task A_duplicate_signup_is_a_409()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/signup", new
        {
            name = "Dup",
            email = MayaEmail,
            password = "hunter2!",
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Signups_can_be_closed_from_settings()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """
            INSERT INTO system_settings (key, value, "updatedAt", "updatedBy")
            VALUES ('signupsOpen', 'false'::jsonb, now(), 'test')
            ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb
            """);

        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/signup", new
        {
            name = "Too Late",
            email = "toolate@example.com",
            password = "hunter2!",
        });

        // 503, not 403: the feature is switched off on this deployment rather
        // than forbidden to this caller.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    // ── public config ────────────────────────────────────────────────────

    [Fact]
    public async Task Config_is_public_and_reports_google_as_unconfigured()
    {
        var response = await _app.CreateSessionClient().GetAsync("/api/v1/config");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await JsonOf(response);
        Assert.True(body.GetProperty("signupsOpen").GetBoolean());

        // No OAuth client is configured here, so the button stays hidden
        // (REQUIREMENTS.md A6).
        Assert.False(body.GetProperty("googleEnabled").GetBoolean());
    }

    [Fact]
    public async Task Google_sign_in_is_503_when_unconfigured()
    {
        var response = await _app.CreateSessionClient().GetAsync("/api/v1/auth/google");

        // Not a 404: the route exists on every deployment, and "not set up
        // here" is a different answer from "no such endpoint".
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }
}
