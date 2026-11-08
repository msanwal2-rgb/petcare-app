using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Booking as a guest (STATUS §3-G): somebody with no account books a
/// caretaker or a vet by giving their own and their pet's details.
///
/// A booking needs an owner and a pet needs an owner, so a guest is a user
/// row — <c>guest</c>, or <c>pending</c> when they ticked "save my details" —
/// with no password, which cannot sign in. The rules that matter:
///
///  - the user, the pet and the booking are written together or not at all;
///  - the price, the lead time and the calendar are the signed-in rules, run
///    by the same code;
///  - an email that already has an account is refused — they sign in;
///  - nothing typed overwrites what is stored, and an unclaimed guest's pets
///    are never reused: nothing proves the person typing owns the inbox.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class GuestBookingServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string GuestEmail = "sam.guest@example.com";

    private CoreHost _core = null!;
    private IGuestBookingService _guests = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await Calendars.OpenCaretakerAsync(db.ConnectionString, "c1");
        await Calendars.OpenVetAsync(db.ConnectionString, "v1");
        _core = new CoreHost(db.ConnectionString);
        _guests = _core.Get<IGuestBookingService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private Task<int> Count(string sql, object? args = null) => One<int>(sql, args);

    private static GuestContactRequest Contact(string email = GuestEmail, string name = "Sam Lee", string phone = "+1 512 555 0100")
        => new(name, email, phone);

    private static GuestPetRequest Pet(string name = "Biscuit", string species = Species.Dog)
        => new(name, species, "Beagle", PetSex.Male, new DateOnly(2021, 4, 2), 24, ["chicken"], "Shy with big dogs");

    private static GuestBookingDetails Walk(int hour = 10) => new(
        "c1", ServiceTypes.Walking,
        Calendars.DaysAhead(3, hour), Calendars.DaysAhead(3, hour + 1), "Side gate", 0);

    private static GuestBookingRequest Booking(
        bool save = false, string email = GuestEmail, GuestBookingDetails? details = null, GuestPetRequest? pet = null,
        GuestContactRequest? contact = null)
        => new(contact ?? Contact(email), pet ?? Pet(), details ?? Walk(), save);

    private static GuestAppointmentDetails Visit() => new(
        "v1", ConsultModes.InClinic, "Limping after a long walk", ["Limping"],
        Calendars.DaysAhead(3, 10), Calendars.DaysAhead(3, 10, 30), "", 0);

    private Task<string> GuestId(string email = GuestEmail)
        => One<string>("SELECT id FROM users WHERE email = @email", new { email });

    // ── The happy path ───────────────────────────────────────────────────

    [Fact]
    public async Task Writes_the_guest_their_pet_and_the_booking()
    {
        var outcome = await _guests.BookCaretakerAsync(Booking());

        Assert.Null(outcome.Guest);
        Assert.Null(outcome.Booking);
        var result = outcome.Result!;
        Assert.Equal(BookingStatuses.Requested, result.Booking.Status);
        Assert.Equal("Liam Novak", result.CaretakerName);
        Assert.Equal("Biscuit", result.PetName);
        Assert.False(result.AccountEmailSent);

        var user = await One<(string Status, string? Hash, string[] Roles, string Name, string Phone)>(
            """SELECT status, "passwordHash", roles, name, phone FROM users WHERE email = @GuestEmail""",
            new { GuestEmail });
        Assert.Equal(AccountStatus.Guest, user.Status);
        Assert.Null(user.Hash);
        Assert.Equal([UserRoles.Owner], user.Roles);
        Assert.Equal("Sam Lee", user.Name);

        var userId = await GuestId();
        var booking = await One<(string OwnerId, string[] PetIds)>(
            """SELECT "ownerId", "petIds" FROM bookings WHERE id = @id""", new { id = result.Booking.Id });
        Assert.Equal(userId, booking.OwnerId);

        var pet = await One<(string OwnerId, string Name, string Species, string[] Allergies)>(
            """SELECT "ownerId", name, species, allergies FROM pets WHERE id = @id""", new { id = Assert.Single(booking.PetIds) });
        Assert.Equal(userId, pet.OwnerId);
        Assert.Equal("Biscuit", pet.Name);
        Assert.Equal(Species.Dog, pet.Species);
        Assert.Equal(["chicken"], pet.Allergies);

        // No account was asked for, so no set-password email.
        Assert.DoesNotContain(_core.Mailer.Sent, m => m.Html.Contains("/set-password"));
    }

    [Fact]
    public async Task Prices_from_the_rate_card()
    {
        // c1 walks at $28/hour; the request has no price field to say otherwise.
        var outcome = await _guests.BookCaretakerAsync(Booking());

        Assert.Equal(28m, outcome.Result!.Booking.PriceTotal);
    }

    [Fact]
    public async Task Ticking_the_box_makes_a_pending_account_and_emails_a_seven_day_link()
    {
        var outcome = await _guests.BookCaretakerAsync(Booking(save: true));

        Assert.True(outcome.Result!.AccountEmailSent);
        Assert.Equal(AccountStatus.Pending,
            await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));

        var mail = Assert.Single(_core.Mailer.Sent, m => m.To == GuestEmail && m.Html.Contains("/set-password?token="));
        Assert.Contains("Biscuit", mail.Text);

        var expiresAt = await One<DateTime>(
            "SELECT \"expiresAt\" FROM verification_tokens WHERE identifier = @id AND type = @type",
            new { id = await GuestId(), type = TokenTypes.SetPassword });
        Assert.InRange(expiresAt - DateTime.UtcNow, TimeSpan.FromDays(6.9), TimeSpan.FromDays(7.1));
    }

    [Fact]
    public async Task Tells_the_guest_their_request_went_through_inside_the_booking()
    {
        var outcome = await _guests.BookCaretakerAsync(Booking());
        var userId = await GuestId();

        var notice = await One<(string Kind, string Href)>(
            """SELECT kind, href FROM notifications WHERE "userId" = @userId""", new { userId });
        Assert.Equal(NotificationKinds.BookingRequested, notice.Kind);
        Assert.Equal($"/booking/{outcome.Result!.Booking.Id}", notice.Href);

        Assert.Equal(1, await Count(
            """
            SELECT count(*)::int FROM notification_outbox o
            JOIN notifications n ON n.id = o."notificationId" WHERE n."userId" = @userId
            """, new { userId }));
    }

    [Fact]
    public async Task A_mail_outage_does_not_lose_the_booking()
    {
        _core.Mailer.FailWith = "provider down";

        var outcome = await _guests.BookCaretakerAsync(Booking(save: true));

        Assert.NotNull(outcome.Result);
        Assert.False(outcome.Result.AccountEmailSent);
        Assert.Equal(1, await Count("SELECT count(*)::int FROM bookings WHERE id = @id", new { id = outcome.Result.Booking.Id }));
    }

    // ── The signed-in rules, by the same code ────────────────────────────

    [Fact]
    public async Task A_guest_gets_the_standard_lead_time_and_nothing_is_written()
    {
        var soon = DateTimeOffset.UtcNow.AddHours(3);
        var outcome = await _guests.BookCaretakerAsync(
            Booking(details: Walk() with { StartDateTime = soon, EndDateTime = soon.AddHours(1) }));

        Assert.Equal(BookingFailure.LeadTime, outcome.Booking);
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public async Task A_time_outside_the_calendar_is_refused_and_nothing_is_written()
    {
        await Calendars.CloseCaretakerAsync(db.ConnectionString, "c1");

        var outcome = await _guests.BookCaretakerAsync(Booking(save: true));

        Assert.Equal(BookingFailure.NotAvailable, outcome.Booking);
        await AssertNothingWrittenAsync();
        Assert.Empty(_core.Mailer.Sent);
    }

    [Fact]
    public async Task A_service_the_caretaker_does_not_offer_is_refused_and_nothing_is_written()
    {
        var outcome = await _guests.BookCaretakerAsync(
            Booking(details: Walk() with { ServiceType = ServiceTypes.Boarding }));

        Assert.Equal(BookingFailure.ServiceNotOffered, outcome.Booking);
        await AssertNothingWrittenAsync();
    }

    [Fact]
    public async Task An_unknown_caretaker_is_refused()
    {
        var outcome = await _guests.BookCaretakerAsync(Booking(details: Walk() with { CaretakerId = "ghost" }));

        Assert.Equal(BookingFailure.CaretakerNotFound, outcome.Booking);
        await AssertNothingWrittenAsync();
    }

    private async Task AssertNothingWrittenAsync()
    {
        Assert.Equal(0, await Count("SELECT count(*)::int FROM users WHERE email = @GuestEmail", new { GuestEmail }));
        Assert.Equal(0, await Count("SELECT count(*)::int FROM pets WHERE name = 'Biscuit' AND breed = 'Beagle'"));
    }

    // ── Who is a guest ───────────────────────────────────────────────────

    [Theory]
    [InlineData("maya.chen@example.com")]
    [InlineData("  Maya.Chen@Example.COM ")]
    public async Task An_email_with_an_account_is_told_to_sign_in(string email)
    {
        var petsBefore = await Count("""SELECT count(*)::int FROM pets WHERE "ownerId" = 'u1'""");
        var bookingsBefore = await Count("""SELECT count(*)::int FROM bookings WHERE "ownerId" = 'u1'""");

        var outcome = await _guests.BookCaretakerAsync(Booking(email: email));

        Assert.Null(outcome.Result);
        Assert.Equal(GuestFailure.AccountExists, outcome.Guest);
        Assert.Equal(petsBefore, await Count("""SELECT count(*)::int FROM pets WHERE "ownerId" = 'u1'"""));
        Assert.Equal(bookingsBefore, await Count("""SELECT count(*)::int FROM bookings WHERE "ownerId" = 'u1'"""));
    }

    [Fact]
    public async Task A_suspended_account_gets_the_same_answer()
    {
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
            await conn.ExecuteAsync("UPDATE users SET status = 'suspended' WHERE id = 'u2'");

        var outcome = await _guests.BookCaretakerAsync(Booking(email: "daniel.reyes@example.com"));

        Assert.Equal(GuestFailure.AccountExists, outcome.Guest);
    }

    [Fact]
    public async Task Booking_again_reuses_the_guest_and_keeps_what_was_stored()
    {
        await _guests.BookCaretakerAsync(Booking());
        var first = await GuestId();

        var again = await _guests.BookCaretakerAsync(Booking(
            contact: Contact(name: "Someone Else", phone: "+1 000 000 0000"), details: Walk(hour: 14)));

        Assert.NotNull(again.Result);
        Assert.Equal(first, await GuestId());
        var user = await One<(string Name, string Phone)>(
            "SELECT name, phone FROM users WHERE id = @first", new { first });
        Assert.Equal(("Sam Lee", "+1 512 555 0100"), user);
    }

    [Fact]
    public async Task An_unclaimed_guests_pet_is_never_reused()
    {
        // The same name and species again. Reusing it would let anyone who
        // knows a guest's email and pet name book a vet for that animal — and
        // hand the vet its health record (the owner's decision, 2026-11-08).
        var one = await _guests.BookCaretakerAsync(Booking());
        var two = await _guests.BookCaretakerAsync(Booking(details: Walk(hour: 14)));

        var petIds = await One<string[]>(
            """SELECT array_agg(p) FROM bookings, unnest("petIds") p WHERE id = ANY(@ids)""",
            new { ids = new[] { one.Result!.Booking.Id, two.Result!.Booking.Id } });
        Assert.Equal(2, petIds.Distinct().Count());
        Assert.Equal(2, await Count("""SELECT count(*)::int FROM pets WHERE "ownerId" = @id""", new { id = await GuestId() }));
    }

    [Fact]
    public async Task Ticking_the_box_later_upgrades_a_guest_and_not_ticking_never_downgrades()
    {
        await _guests.BookCaretakerAsync(Booking(save: false));
        Assert.Equal(AccountStatus.Guest, await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));

        var upgraded = await _guests.BookCaretakerAsync(Booking(save: true, details: Walk(hour: 13)));
        Assert.True(upgraded.Result!.AccountEmailSent);
        Assert.Equal(AccountStatus.Pending, await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));

        await _guests.BookCaretakerAsync(Booking(save: false, details: Walk(hour: 15)));
        Assert.Equal(AccountStatus.Pending, await One<string>("SELECT status FROM users WHERE email = @GuestEmail", new { GuestEmail }));
    }

    [Fact]
    public async Task Two_first_bookings_at_once_make_one_guest()
    {
        // Both read "no such user" and both insert; the unique index on email
        // refuses one, which starts again and finds the other's row.
        var results = await Task.WhenAll(
            _guests.BookCaretakerAsync(Booking(details: Walk(hour: 9))),
            _guests.BookCaretakerAsync(Booking(details: Walk(hour: 15))));

        Assert.All(results, r => Assert.NotNull(r.Result));
        Assert.Equal(1, await Count("SELECT count(*)::int FROM users WHERE email = @GuestEmail", new { GuestEmail }));
        Assert.Equal(2, await Count("""SELECT count(*)::int FROM bookings WHERE "ownerId" = @id""", new { id = await GuestId() }));
    }

    // ── Vet visits ───────────────────────────────────────────────────────

    [Fact]
    public async Task Books_a_vet_visit_at_the_clinics_fee()
    {
        var outcome = await _guests.BookVetAsync(new GuestAppointmentRequest(Contact(), Pet(), Visit(), SaveAccount: false));

        Assert.Null(outcome.Guest);
        Assert.Null(outcome.Appointment);
        var result = outcome.Result!;
        Assert.Equal(AppointmentStatuses.Requested, result.Appointment.Status);
        Assert.Equal("Biscuit", result.PetName);

        var row = await One<(string OwnerId, int BaseFee, int Pct, int Fee)>(
            """SELECT "ownerId", "baseFeeCents", "discountPct", "feeCents" FROM vet_appointments WHERE id = @id""",
            new { id = result.Appointment.Id });
        Assert.Equal(await GuestId(), row.OwnerId);
        Assert.Equal(0, row.Pct);
        Assert.Equal(row.BaseFee, row.Fee);

        Assert.Equal(NotificationKinds.AppointmentRequested, await One<string>(
            """SELECT kind FROM notifications WHERE "userId" = @id""", new { id = await GuestId() }));
    }

    [Fact]
    public async Task A_species_the_clinic_does_not_treat_is_refused_and_nothing_is_written()
    {
        var outcome = await _guests.BookVetAsync(
            new GuestAppointmentRequest(Contact(), Pet(species: Species.Other), Visit(), SaveAccount: true));

        Assert.Equal(AppointmentFailure.SpeciesNotAccepted, outcome.Appointment);
        Assert.Equal(0, await Count("SELECT count(*)::int FROM users WHERE email = @GuestEmail", new { GuestEmail }));
        Assert.Empty(_core.Mailer.Sent);
    }

    [Fact]
    public async Task A_visit_outside_the_clinics_hours_is_refused()
    {
        await Calendars.CloseVetAsync(db.ConnectionString, "v1");

        var outcome = await _guests.BookVetAsync(new GuestAppointmentRequest(Contact(), Pet(), Visit(), false));

        Assert.Equal(AppointmentFailure.NotAvailable, outcome.Appointment);
    }

    [Fact]
    public async Task A_vet_visit_with_an_account_email_is_told_to_sign_in()
    {
        var outcome = await _guests.BookVetAsync(
            new GuestAppointmentRequest(Contact(email: "maya.chen@example.com"), Pet(), Visit(), false));

        Assert.Equal(GuestFailure.AccountExists, outcome.Guest);
    }
}
