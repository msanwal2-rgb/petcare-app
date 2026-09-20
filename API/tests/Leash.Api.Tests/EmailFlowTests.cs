using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/email-flows.test.ts</c>, plus the cases M1 adds: the
/// watermark bump on reset, and the refresh tokens that go with it.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class EmailFlowTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";

    private CoreHost _core = null!;
    private IAuthService _auth = null!;
    private IEmailFlowService _flows = null!;
    private IVerificationTokenRepository _tokens = null!;
    private ITokenService _tokenService = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();

        _core = new CoreHost(db.ConnectionString);
        _auth = _core.Get<IAuthService>();
        _flows = _core.Get<IEmailFlowService>();
        _tokens = _core.Get<IVerificationTokenRepository>();
        _tokenService = _core.Get<ITokenService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static string TokenFromLink(string link)
        => System.Web.HttpUtility.ParseQueryString(new Uri(link).Query)["token"]!;

    // ── tokens ───────────────────────────────────────────────────────────
    //
    // The service hashes before it stores, so these go through the repository
    // with a hash the test computes itself — the same thing the service does.

    private static string Hash(string raw)
        => Convert.ToHexStringLower(
            System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(raw)));

    [Fact]
    public async Task Issues_a_token_that_consumes_to_its_identifier_exactly_once()
    {
        const string Raw = "raw-token-value";
        var now = Ids.Now();

        await _tokens.CreateAsync(
            Ids.New("tok"), "u1", Hash(Raw), TokenTypes.VerifyEmail,
            now.AddHours(24), now);

        var first = await _tokens.ConsumeAsync(Hash(Raw));
        Assert.Equal("u1", first?.Identifier);

        // Single use.
        Assert.Null(await _tokens.ConsumeAsync(Hash(Raw)));
    }

    [Fact]
    public async Task Issuing_a_second_token_invalidates_the_first()
    {
        var now = Ids.Now();

        await _tokens.CreateAsync(
            Ids.New("tok"), "u1", Hash("first"), TokenTypes.ResetPassword,
            now.AddHours(1), now);

        await _tokens.CreateAsync(
            Ids.New("tok"), "u1", Hash("second"), TokenTypes.ResetPassword,
            now.AddHours(1), now);

        // Otherwise every "resend it, I didn't get the email" leaves another
        // live key to the account lying in a mailbox.
        Assert.Null(await _tokens.ConsumeAsync(Hash("first")));
        Assert.Equal("u1", (await _tokens.ConsumeAsync(Hash("second")))?.Identifier);
    }

    [Fact]
    public async Task Rejects_a_token_used_for_the_wrong_type()
    {
        // Both types are 32 random bytes. Without the type check, a link that
        // only proves "you can read this inbox" would also set a password.
        var link = await _flows.RequestEmailVerificationAsync(
            "u2", "daniel.reyes@example.com", "Daniel");

        Assert.False(await _flows.ResetPasswordAsync(TokenFromLink(link), "brandnew1"));
    }

    [Fact]
    public async Task Rejects_an_expired_token()
    {
        var link = await _flows.RequestEmailVerificationAsync(
            "u2", "daniel.reyes@example.com", "Daniel");

        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """
            UPDATE verification_tokens SET "expiresAt" = '2000-01-01T00:00:00Z'
            WHERE identifier = 'u2' AND type = 'verify_email'
            """);

        Assert.Null(await _flows.VerifyEmailAsync(TokenFromLink(link)));
    }

    // ── email verification ───────────────────────────────────────────────

    [Fact]
    public async Task Verifies_a_user_via_their_token()
    {
        // u2 is seeded unverified.
        var link = await _flows.RequestEmailVerificationAsync(
            "u2", "daniel.reyes@example.com", "Daniel");

        var user = await _flows.VerifyEmailAsync(TokenFromLink(link));

        Assert.Equal("u2", user?.Id);
        Assert.True(user!.Verified);
    }

    [Fact]
    public async Task Rejects_a_bogus_verification_token()
        => Assert.Null(await _flows.VerifyEmailAsync("not-a-real-token"));

    [Fact]
    public async Task Verification_links_point_at_the_configured_origin()
    {
        var link = await _flows.RequestEmailVerificationAsync(
            "u2", "daniel.reyes@example.com", "Daniel");

        // Never the Host header. A link built from the request would let
        // `Host: attacker.example` put a valid token on an attacker's domain
        // inside a genuine email from us — see Core/Configuration/AppOrigin.cs.
        Assert.StartsWith($"{CoreHost.TestOrigin}/verify-email?token=", link);
    }

    [Fact]
    public async Task Escapes_the_display_name_in_the_email_body()
    {
        await _flows.RequestEmailVerificationAsync(
            "u2", "daniel.reyes@example.com", "<script>alert(1)</script> Reyes");

        var sent = Assert.Single(_core.Mailer.Sent);

        Assert.DoesNotContain("<script>", sent.Html);
        Assert.Contains("&lt;script&gt;", sent.Html);
    }

    // ── password reset ───────────────────────────────────────────────────

    [Fact]
    public async Task Returns_a_link_for_a_known_email_and_resets_the_password()
    {
        var link = await _flows.RequestPasswordResetAsync("maya.chen@example.com");
        Assert.NotNull(link);

        Assert.True(await _flows.ResetPasswordAsync(TokenFromLink(link), "brandnew1"));

        // The new password works and the old one no longer does.
        Assert.NotNull(await _auth.VerifyCredentialsAsync("maya.chen@example.com", "brandnew1"));
        Assert.Null(await _auth.VerifyCredentialsAsync("maya.chen@example.com", DemoPassword));
    }

    [Fact]
    public async Task Does_not_reveal_unknown_emails()
    {
        // No link, no throw — the difference between "sent" and "no such
        // account" is an enumeration oracle.
        Assert.Null(await _flows.RequestPasswordResetAsync("ghost@example.com"));
    }

    [Fact]
    public async Task Rejects_resetting_with_a_bad_token()
        => Assert.False(await _flows.ResetPasswordAsync("bad-token", "whatever1"));

    [Fact]
    public async Task Completing_a_reset_bumps_the_session_watermark()
    {
        var before = Ids.Now();

        var link = await _flows.RequestPasswordResetAsync("maya.chen@example.com");
        Assert.True(await _flows.ResetPasswordAsync(TokenFromLink(link!), "brandnew1"));

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var watermark = await conn.ExecuteScalarAsync<DateTimeOffset?>(
            "SELECT \"sessionsValidFrom\" FROM users WHERE id = 'u1'");

        // REQUIREMENTS.md A5. Without this, someone resetting their password
        // because they were compromised changes nothing for the attacker, whose
        // cookie stays valid for its full thirty days.
        Assert.NotNull(watermark);
        Assert.True(watermark >= before);
    }

    [Fact]
    public async Task Completing_a_reset_revokes_mobile_refresh_tokens()
    {
        var pair = await _tokenService.IssueAsync("u1", "test-agent");

        var link = await _flows.RequestPasswordResetAsync("maya.chen@example.com");
        Assert.True(await _flows.ResetPasswordAsync(TokenFromLink(link!), "brandnew1"));

        var (rotated, failure) = await _tokenService.RotateAsync(pair.RefreshToken, "test-agent");

        Assert.Null(rotated);
        Assert.NotNull(failure);
    }

    [Fact]
    public async Task A_failed_reset_leaves_the_password_untouched()
    {
        // The token is consumed and the password write is refused in the same
        // transaction, so a reset that cannot complete must roll all of it back
        // rather than leaving the account half-changed.
        Assert.False(await _flows.ResetPasswordAsync("nonexistent-token", "brandnew1"));

        Assert.NotNull(await _auth.VerifyCredentialsAsync("maya.chen@example.com", DemoPassword));
    }
}
