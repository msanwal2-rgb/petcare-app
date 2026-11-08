using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// A guest becoming an account (STATUS §3-G).
///
/// A guest or pending user has no password and cannot sign in. The only way
/// in is a set-password link sent to their email: 32 random bytes, stored
/// hashed, single-use, seven days. Spending it makes the account active and
/// verified — clicking a link we mailed proves the inbox — and everything the
/// guest booked is already theirs, because it was written against this user.
///
/// The link only ever activates an <i>unclaimed</i> account. Otherwise a
/// leftover link would be a seven-day password reset for an active one.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class GuestAccountTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string GuestEmail = "sam.guest@example.com";

    private CoreHost _core = null!;
    private IGuestBookingService _guests = null!;
    private IEmailFlowService _flows = null!;
    private IAuthService _auth = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await Calendars.OpenCaretakerAsync(db.ConnectionString, "c1");
        _core = new CoreHost(db.ConnectionString);
        _guests = _core.Get<IGuestBookingService>();
        _flows = _core.Get<IEmailFlowService>();
        _auth = _core.Get<IAuthService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private async Task Exec(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    private static string Hash(string raw)
        => Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(raw)));

    private static string TokenFromLink(string link)
        => System.Web.HttpUtility.ParseQueryString(new Uri(link).Query)["token"]!;

    /// <summary>The token in the newest set-password email to the guest.</summary>
    private string LatestSetPasswordToken()
    {
        var mail = _core.Mailer.Sent.Last(m => m.To == GuestEmail && m.Html.Contains("/set-password?token="));
        var start = mail.Text.IndexOf("http", StringComparison.Ordinal);
        var link = mail.Text[start..].Split(['\n', ' '], 2)[0];
        return TokenFromLink(link);
    }

    private async Task<BookingDto> BookAsync(bool save)
    {
        var outcome = await _guests.BookCaretakerAsync(new GuestBookingRequest(
            new GuestContactRequest("Sam Lee", GuestEmail, "+1 512 555 0100"),
            new GuestPetRequest("Biscuit", Species.Dog, "Beagle", PetSex.Male, new DateOnly(2021, 4, 2), 24, null, null),
            new GuestBookingDetails("c1", ServiceTypes.Walking,
                Calendars.DaysAhead(3, 10), Calendars.DaysAhead(3, 11), null, 0),
            save));
        return outcome.Result!.Booking;
    }

    private Task<string> GuestId()
        => One<string>("SELECT id FROM users WHERE email = @GuestEmail", new { GuestEmail });

    // ── Setting the password ─────────────────────────────────────────────

    [Fact]
    public async Task Setting_the_password_activates_the_account_and_brings_the_bookings()
    {
        var booking = await BookAsync(save: true);

        var user = await _flows.SetPasswordAsync(LatestSetPasswordToken(), "a-new-password");

        Assert.NotNull(user);
        Assert.Equal(AccountStatus.Active, user.Status);
        Assert.True(user.Verified);
        Assert.NotNull(await _auth.VerifyCredentialsAsync(GuestEmail, "a-new-password"));

        var mine = await _core.Get<IBookingService>().ListMineAsync(user.Id, null, 24);
        Assert.Contains(mine.Items, b => b.Id == booking.Id);
        var pets = await _core.Get<IPetService>().ListMineAsync(user.Id);
        Assert.Contains(pets, p => p.Name == "Biscuit");
    }

    [Fact]
    public async Task A_link_works_once()
    {
        await BookAsync(save: true);
        var token = LatestSetPasswordToken();

        Assert.NotNull(await _flows.SetPasswordAsync(token, "a-new-password"));
        Assert.Null(await _flows.SetPasswordAsync(token, "another-password"));
        Assert.NotNull(await _auth.VerifyCredentialsAsync(GuestEmail, "a-new-password"));
    }

    [Fact]
    public async Task A_link_stops_working_after_seven_days()
    {
        await BookAsync(save: true);
        var token = LatestSetPasswordToken();
        await Exec("""UPDATE verification_tokens SET "expiresAt" = now() - interval '1 minute' WHERE type = @type""",
            new { type = TokenTypes.SetPassword });

        Assert.Null(await _flows.SetPasswordAsync(token, "a-new-password"));
        Assert.Equal(AccountStatus.Pending, await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));
    }

    [Theory]
    [InlineData(TokenTypes.ResetPassword)]
    [InlineData(TokenTypes.VerifyEmail)]
    public async Task Another_kind_of_token_cannot_set_the_password(string type)
    {
        await BookAsync(save: true);
        const string Raw = "not-a-set-password-token";
        var now = Ids.Now();
        await _core.Get<IVerificationTokenRepository>().CreateAsync(
            Ids.New("tok"), await GuestId(), Hash(Raw), type, now.AddDays(1), now);

        Assert.Null(await _flows.SetPasswordAsync(Raw, "a-new-password"));
    }

    [Fact]
    public async Task A_set_password_token_cannot_reset_an_active_accounts_password()
    {
        // Without the status check a leftover link would be a seven-day
        // password reset for an account somebody already owns.
        const string Raw = "leftover-link";
        var now = Ids.Now();
        await _core.Get<IVerificationTokenRepository>().CreateAsync(
            Ids.New("tok"), "u1", Hash(Raw), TokenTypes.SetPassword, now.AddDays(7), now);

        Assert.Null(await _flows.SetPasswordAsync(Raw, "taken-over"));
        Assert.Null(await _auth.VerifyCredentialsAsync("maya.chen@example.com", "taken-over"));
        Assert.NotNull(await _auth.VerifyCredentialsAsync("maya.chen@example.com", "leashdemo123"));
    }

    [Fact]
    public async Task A_new_link_replaces_the_old_one()
    {
        await BookAsync(save: true);
        var first = LatestSetPasswordToken();

        await _flows.RequestPasswordResetAsync(GuestEmail);
        var second = LatestSetPasswordToken();

        Assert.NotEqual(first, second);
        Assert.Null(await _flows.SetPasswordAsync(first, "a-new-password"));
        Assert.NotNull(await _flows.SetPasswordAsync(second, "a-new-password"));
    }

    // ── Getting in another way ───────────────────────────────────────────

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_guest_cannot_sign_in(bool save)
    {
        await BookAsync(save);

        Assert.Null(await _auth.VerifyCredentialsAsync(GuestEmail, ""));
        Assert.Null(await _auth.VerifyCredentialsAsync(GuestEmail, "anything"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Forgot_password_sends_a_guest_the_set_password_link(bool save)
    {
        // Decision 4: a guest who never ticked the box can still claim the
        // account later, by proving the inbox.
        await BookAsync(save);
        _core.Mailer.Clear();

        var link = await _flows.RequestPasswordResetAsync(GuestEmail);

        Assert.Contains("/set-password?token=", link);
        var mail = Assert.Single(_core.Mailer.Sent);
        Assert.Equal(GuestEmail, mail.To);
        Assert.DoesNotContain("/reset-password", mail.Html);
        Assert.NotNull(await _flows.SetPasswordAsync(TokenFromLink(link!), "a-new-password"));
    }

    [Fact]
    public async Task Forgot_password_for_an_active_account_is_unchanged()
    {
        var link = await _flows.RequestPasswordResetAsync("maya.chen@example.com");

        Assert.Contains("/reset-password?token=", link);
    }

    [Fact]
    public async Task Account_setup_is_offered_only_to_unclaimed_accounts()
    {
        await BookAsync(save: false);
        _core.Mailer.Clear();

        Assert.Null(await _flows.RequestAccountSetupAsync("maya.chen@example.com"));
        Assert.Null(await _flows.RequestAccountSetupAsync("nobody@example.com"));
        Assert.Empty(_core.Mailer.Sent);

        Assert.NotNull(await _flows.RequestAccountSetupAsync(GuestEmail));
        Assert.Single(_core.Mailer.Sent);
    }

    [Fact]
    public async Task Google_does_not_take_over_a_guest()
    {
        // An account with no password is normally linked to Google on sight.
        // A guest has no password, and Google signing in would leave a Google
        // id on a row that still cannot hold a session.
        await BookAsync(save: true);

        var outcome = await _auth.LinkOrCreateOAuthUserAsync(
            new OAuthIdentity(GuestEmail, true, "google-sam", "Sam Lee", null));

        Assert.Null(outcome.User);
        Assert.Equal(OAuthFailure.FinishSetup, outcome.Failure);
        Assert.Null(await One<string?>("""SELECT "googleId" FROM users WHERE email = @GuestEmail""", new { GuestEmail }));
    }

    // ── Emails, and staff ────────────────────────────────────────────────

    [Fact]
    public async Task The_outbox_emails_guests_and_points_them_at_account_setup()
    {
        var booking = await BookAsync(save: false);
        _core.Mailer.Clear();

        var report = await _core.Get<INotificationOutbox>().DrainAsync(Ids.Now());

        Assert.Equal(1, report.Sent);
        var mail = Assert.Single(_core.Mailer.Sent);
        Assert.Equal(GuestEmail, mail.To);

        // The booking page needs a session a guest does not have.
        Assert.DoesNotContain($"/booking/{booking.Id}", mail.Html);
        Assert.Contains("/forgot-password?setup=1", mail.Html);
    }

    [Fact]
    public async Task The_outbox_still_skips_a_suspended_account()
    {
        await BookAsync(save: false);
        await Exec("UPDATE users SET status = 'suspended' WHERE email = @GuestEmail", new { GuestEmail });
        _core.Mailer.Clear();

        var report = await _core.Get<INotificationOutbox>().DrainAsync(Ids.Now());

        Assert.Equal(1, report.Skipped);
        Assert.Empty(_core.Mailer.Sent);
    }

    [Fact]
    public async Task Staff_cannot_reactivate_a_guest_into_an_account()
    {
        // "Reactivate" sets status = active. On a guest that is an account with
        // no password, reachable by nothing — the guest claims it themselves.
        await BookAsync(save: false);

        var (_, refusal) = await _core.Get<IAdminUserService>().ApplyAsync(
            new StaffActor("u22"), await GuestId(), new AdminUserActionRequest("reactivate"));

        Assert.NotNull(refusal);
        Assert.Equal(AdminFailure.Conflict, refusal.Kind);
        Assert.Equal(AccountStatus.Guest, await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));
    }
}
