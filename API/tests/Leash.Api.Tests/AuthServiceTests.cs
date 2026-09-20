using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Repositories;
using Leash.Core.Security;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/auth.test.ts</c>.
///
/// Those suites are the specification (BUILD_PLAN.md section 4), so this keeps
/// their cases one for one rather than rewriting them around the new
/// implementation — including the two that exist because the behaviour they
/// describe was once wrong: Google must not take over a password account, and a
/// Google id must not be claimable twice.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AuthServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    /// <summary>
    /// The shared demo password from the seed fixtures. Not a secret — it only
    /// ever unlocks throwaway data.
    /// </summary>
    private const string DemoPassword = "leashdemo123";

    private CoreHost _core = null!;
    private IAuthService _auth = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _auth = _core.Get<IAuthService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    // ── password hashing ─────────────────────────────────────────────────

    [Fact]
    public void Hashes_and_verifies_a_password()
    {
        var hash = Passwords.Hash("s3cret!");

        Assert.NotEqual("s3cret!", hash);
        Assert.True(Passwords.Verify("s3cret!", hash));
        Assert.False(Passwords.Verify("wrong", hash));
    }

    [Fact]
    public void Verifies_the_bcrypt_hashes_the_old_stack_wrote()
    {
        // The whole reason bcrypt at cost 10 was kept rather than moving to
        // Argon2id: this hash is in the seed data, written by bcryptjs, and it
        // still has to verify. If this test fails, the database did not survive
        // the port.
        const string FromBcryptJs = "$2b$10$1DLm4ZqIniiGaoQJc0B.zeamJNT4C0h2Cv0e2H/XnFYxxUyg/xFq.";

        Assert.True(Passwords.Verify(DemoPassword, FromBcryptJs));
    }

    [Fact]
    public void Treats_an_unparseable_hash_as_a_wrong_password()
    {
        // A data problem should answer like a failed sign-in, not a 500 that
        // tells the caller this account is unusual.
        Assert.False(Passwords.Verify(DemoPassword, "not-a-bcrypt-hash"));
    }

    // ── credential verification ──────────────────────────────────────────

    [Fact]
    public async Task Logs_in_a_seeded_demo_account()
    {
        var user = await _auth.VerifyCredentialsAsync("maya.chen@example.com", DemoPassword);

        Assert.NotNull(user);
        Assert.Equal("u1", user.Id);
    }

    [Fact]
    public async Task Is_case_insensitive_on_email()
    {
        var user = await _auth.VerifyCredentialsAsync("MAYA.CHEN@EXAMPLE.COM", DemoPassword);

        Assert.Equal("u1", user?.Id);
    }

    [Fact]
    public async Task Rejects_a_wrong_password()
        => Assert.Null(await _auth.VerifyCredentialsAsync("maya.chen@example.com", "nope"));

    [Fact]
    public async Task Rejects_an_unknown_email()
        => Assert.Null(await _auth.VerifyCredentialsAsync("ghost@example.com", DemoPassword));

    [Fact]
    public async Task Rejects_an_account_with_no_password()
    {
        // A Google-only account. Returning a user here would let anyone sign in
        // to it with any password, and distinguishing it in the response would
        // say which accounts are worth attacking differently.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            "UPDATE users SET \"passwordHash\" = NULL WHERE id = 'u1'");

        Assert.Null(await _auth.VerifyCredentialsAsync("maya.chen@example.com", DemoPassword));
    }

    // ── registration ─────────────────────────────────────────────────────

    [Fact]
    public async Task Creates_an_account_that_can_then_log_in()
    {
        var created = await _auth.RegisterAsync(
            new SignupRequest("New Person", "new.person@example.com", "hunter2!", null, null));

        Assert.NotNull(created);
        Assert.StartsWith("u_", created.Id);

        var login = await _auth.VerifyCredentialsAsync("new.person@example.com", "hunter2!");
        Assert.Equal(created.Id, login?.Id);
    }

    [Fact]
    public async Task Normalizes_email_to_lowercase()
    {
        var created = await _auth.RegisterAsync(
            new SignupRequest("Caps", "Caps.User@Example.com", "hunter2!", null, null));

        Assert.Equal("caps.user@example.com", created?.Email);
    }

    [Fact]
    public async Task Rejects_a_duplicate_email()
    {
        var created = await _auth.RegisterAsync(
            new SignupRequest("Dup", "maya.chen@example.com", "hunter2!", null, null));

        Assert.Null(created);
    }

    [Fact]
    public async Task A_new_account_starts_unverified_active_and_without_staff_roles()
    {
        var created = await _auth.RegisterAsync(
            new SignupRequest("Fresh", "fresh@example.com", "hunter2!", null, ["owner"]));

        Assert.NotNull(created);
        Assert.False(created.Verified);
        Assert.Equal("active", created.Status);

        // Self-declared marketplace roles are the design; staff roles are never
        // reachable from a request (REQUIREMENTS.md A12).
        Assert.Equal(["owner"], created.Roles);
        Assert.Empty(created.StaffRoles);
    }

    // ── oauth provisioning ───────────────────────────────────────────────

    private Task<OAuthResult> Google(
        string email = "oauth.user@gmail.com",
        bool verified = true,
        string googleId = "google-sub-1",
        string? name = "OAuth User")
        => _auth.LinkOrCreateOAuthUserAsync(
            new OAuthIdentity(email, verified, googleId, name, null));

    [Fact]
    public async Task Creates_a_user_on_first_sign_in_and_returns_the_same_on_the_next()
    {
        var first = await Google();

        Assert.Null(first.Failure);
        Assert.True(first.Created);
        Assert.True(first.User!.Verified);

        var second = await Google();

        Assert.False(second.Created);
        Assert.Equal(first.User.Id, second.User!.Id);
    }

    [Fact]
    public async Task Recognises_the_google_account_even_after_the_address_changes()
    {
        var first = await Google();

        // Same subject, new address: still the same person. This is what keying
        // on the subject rather than the email buys (A8).
        var renamed = await Google(email: "new.address@gmail.com");

        Assert.Equal(first.User!.Id, renamed.User!.Id);
    }

    [Fact]
    public async Task Refuses_an_unverified_google_address()
    {
        var result = await Google(verified: false);

        Assert.Equal(OAuthFailure.EmailUnverified, result.Failure);
        Assert.Null(result.User);
    }

    [Fact]
    public async Task Refuses_to_take_over_an_existing_password_account()
    {
        // The pre-hijack: register a password account at someone's address
        // before they arrive, and a naive email lookup hands you their Google
        // sign-in (REQUIREMENTS.md A7).
        var result = await Google(email: "maya.chen@example.com", googleId: "attacker-sub");

        Assert.Equal(OAuthFailure.AccountExists, result.Failure);
        Assert.Null(result.User);

        // And the refusal left no trace on the target account.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var linked = await conn.ExecuteScalarAsync<string?>(
            "SELECT \"googleId\" FROM users WHERE id = 'u1'");

        Assert.Null(linked);
    }

    [Fact]
    public async Task Adopts_an_account_that_has_no_password()
    {
        // Nobody can reach a passwordless account by password, so there is no
        // second owner for linking to displace.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """
            INSERT INTO users
              (id, name, email, phone, "avatarUrl", roles, "addressCity", "addressState",
               lat, lng, verified, "createdAt", "staffRoles", status)
            VALUES
              ('u_invited', 'Invited', 'invited@gmail.com', '', '', ARRAY[]::text[],
               'Austin', 'TX', 30.2672, -97.7431, false, now(), ARRAY[]::text[], 'active')
            """);

        var result = await Google(email: "invited@gmail.com", googleId: "invited-sub");

        Assert.Equal("u_invited", result.User?.Id);
        Assert.True(result.User!.Verified);
    }

    [Fact]
    public async Task Will_not_let_a_second_account_claim_a_google_id_already_linked()
    {
        await Google();

        Assert.False(await _auth.LinkGoogleToUserAsync("u2", "google-sub-1"));
    }

    [Fact]
    public async Task Links_google_to_the_signed_in_account()
    {
        // The safe direction: the caller already holds the account.
        Assert.True(await _auth.LinkGoogleToUserAsync("u2", "fresh-sub"));

        var result = await Google(email: "anything@gmail.com", googleId: "fresh-sub");
        Assert.Equal("u2", result.User?.Id);
    }
}
