using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/bookings.test.ts</c>, plus the caretaker half of
/// <c>tests/reputation.test.ts</c>.
///
/// The block that matters is "who may move a booking". The reference
/// implementation checked only whether a transition was <i>legal</i>, never who
/// was making it — so an owner could accept their own request and then mark it
/// completed. <c>completed</c> unlocks the review form and every status change
/// feeds the caretaker's response rate, so the owner of a booking could
/// manufacture a caretaker's responsiveness and then review them for it.
///
/// ── Two deliberate departures from the reference suite ──
///
///  1. <b>Its fixtures book August 2026, which is now the past.</b>
///     REQUIREMENTS.md C13 gives bookings a minimum lead time, so these use
///     dates relative to the clock instead of literals that rot.
///  2. <b>There is no actor-less path.</b> The reference allowed
///     <c>updateBookingStatus</c> with no actor for its seeder and its
///     assistant tool; this build has neither, so every status change is
///     attributable to a person. The test that covered that case has no
///     counterpart here on purpose.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class BookingServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Owner = "u1";           // owns p1, p2; booking b1
    private const string CaretakerUser = "u7";   // caretaker profile c1
    private const string Caretaker = "c1";
    private const string Stranger = "u2";

    private CoreHost _core = null!;
    private IBookingService _bookings = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();

        // The seed publishes July 2026 only. Open c1 all day so the cases about
        // something else are not refused for availability (STATUS §3-G).
        await Calendars.OpenCaretakerAsync(db.ConnectionString, Caretaker);

        _core = new CoreHost(db.ConnectionString);
        _bookings = _core.Get<IBookingService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    /// <summary>
    /// A request comfortably clear of the 24-hour lead time, so these never
    /// fail for being too eager.
    /// </summary>
    private static CreateBookingRequest NewBooking(double hours = 1) => new(
        CaretakerId: Caretaker,
        PetIds: ["p1"],
        ServiceType: ServiceTypes.Walking,
        StartDateTime: DateTimeOffset.UtcNow.AddDays(3),
        EndDateTime: DateTimeOffset.UtcNow.AddDays(3).AddHours(hours),
        Notes: "Test booking");

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_an_owners_bookings_newest_first()
    {
        var page = await _bookings.ListMineAsync(Owner, null, 24);

        Assert.NotEmpty(page.Items);
        for (var i = 1; i < page.Items.Length; i++)
            Assert.True(page.Items[i - 1].CreatedAt >= page.Items[i].CreatedAt);
    }

    [Fact]
    public async Task Returns_an_empty_page_for_an_owner_with_no_bookings()
    {
        // u7 is a caretaker, not an owner — they hold bookings on the other side.
        Assert.Empty((await _bookings.ListMineAsync(CaretakerUser, null, 24)).Items);
    }

    [Fact]
    public async Task Lists_a_caretakers_queue_to_the_caretaker()
    {
        var page = await _bookings.ListForCaretakerAsync(CaretakerUser, Caretaker, null, 24);

        Assert.NotNull(page);
        Assert.All(page.Items, b => Assert.Equal(Caretaker, b.CaretakerId));
    }

    [Fact]
    public async Task Refuses_a_caretakers_queue_to_anybody_else()
    {
        // Otherwise an owner could read the marketplace's entire schedule.
        Assert.Null(await _bookings.ListForCaretakerAsync(Owner, Caretaker, null, 24));
        Assert.Null(await _bookings.ListForCaretakerAsync(Stranger, Caretaker, null, 24));
    }

    [Fact]
    public async Task Gets_a_booking_for_either_party()
    {
        var (asOwner, _) = await _bookings.GetAsync(Owner, "b1");
        Assert.Equal(BookingStatuses.Requested, asOwner!.Status);
        Assert.Equal(["p1"], asOwner.PetIds);

        var (asCaretaker, _) = await _bookings.GetAsync(CaretakerUser, "b1");
        Assert.NotNull(asCaretaker);
    }

    [Fact]
    public async Task Hides_a_booking_from_everyone_else()
    {
        var (booking, failure) = await _bookings.GetAsync(Stranger, "b1");

        Assert.Null(booking);
        Assert.Equal(BookingFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Reports_not_participant_for_an_unknown_booking()
    {
        // Indistinguishable from a booking that exists and is not yours, which
        // is the point: ids are sequential.
        var (_, failure) = await _bookings.GetAsync(Owner, "ghost");
        Assert.Equal(BookingFailure.NotParticipant, failure);
    }

    // ── Pagination ───────────────────────────────────────────────────────

    [Fact]
    public async Task Pages_through_an_owners_bookings_without_repeating_or_skipping()
    {
        var all = (await _bookings.ListMineAsync(Owner, null, 100)).Items;
        Assert.True(all.Length >= 3, "fixture needs at least three bookings for u1");

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _bookings.ListMineAsync(Owner, cursor, 1);
            seen.AddRange(page.Items.Select(b => b.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        // Same rows, same order, one at a time. The (createdAt, id) tie-break is
        // what makes this hold — the seed writes several bookings at the same
        // instant, and a cursor on the timestamp alone would skip them.
        Assert.Equal(all.Select(b => b.Id), seen);
        Assert.Equal(seen.Distinct(), seen);
    }

    // ── Creation, and the price ──────────────────────────────────────────

    [Fact]
    public async Task Creates_a_booking_in_the_requested_state()
    {
        var (booking, failure) = await _bookings.CreateAsync(Owner, NewBooking());

        Assert.Null(failure);
        Assert.StartsWith("b_", booking!.Id);
        Assert.Equal(BookingStatuses.Requested, booking.Status);
        Assert.NotEqual(default, booking.CreatedAt);
    }

    [Fact]
    public async Task Prices_from_the_caretakers_rate_card_not_the_request()
    {
        // The request carries no price at all, so there is nothing to tamper
        // with: c1 charges $28/hour for a walk, and this is one hour.
        var (booking, _) = await _bookings.CreateAsync(Owner, NewBooking(hours: 1));

        Assert.Equal(28m, booking!.PriceTotal);
    }

    [Fact]
    public async Task Multiplies_the_rate_by_the_duration()
    {
        var (booking, _) = await _bookings.CreateAsync(Owner, NewBooking(hours: 3));

        Assert.Equal(84m, booking!.PriceTotal);
    }

    [Fact]
    public async Task Refuses_a_service_the_caretaker_does_not_offer()
    {
        // c1's rate card has walking, daycare and sitting — no boarding line, so
        // there is no honest price to charge.
        var (booking, failure) = await _bookings.CreateAsync(
            Owner, NewBooking() with { ServiceType = ServiceTypes.Boarding });

        Assert.Null(booking);
        Assert.Equal(BookingFailure.ServiceNotOffered, failure);
    }

    [Fact]
    public async Task Refuses_an_unknown_caretaker()
    {
        var (_, failure) = await _bookings.CreateAsync(
            Owner, NewBooking() with { CaretakerId = "ghost" });

        Assert.Equal(BookingFailure.CaretakerNotFound, failure);
    }

    [Fact]
    public async Task Refuses_a_booking_that_ends_before_it_starts()
    {
        var (_, failure) = await _bookings.CreateAsync(
            Owner,
            NewBooking() with
            {
                StartDateTime = DateTimeOffset.UtcNow.AddDays(3).AddHours(3),
                EndDateTime = DateTimeOffset.UtcNow.AddDays(3),
            });

        Assert.Equal(BookingFailure.BadDates, failure);
    }

    [Fact]
    public async Task Refuses_a_booking_that_does_not_clear_the_lead_time()
    {
        // REQUIREMENTS.md C13: same-day and next-morning slots are a Leash Plus
        // benefit, so a standard customer books a day ahead.
        var (_, failure) = await _bookings.CreateAsync(
            Owner,
            NewBooking() with
            {
                StartDateTime = DateTimeOffset.UtcNow.AddHours(2),
                EndDateTime = DateTimeOffset.UtcNow.AddHours(3),
            });

        Assert.Equal(BookingFailure.LeadTime, failure);
    }

    [Fact]
    public async Task Refuses_a_booking_for_somebody_elses_pet()
    {
        // A booking is *how* a caretaker gets to read a pet — CanViewPet grants
        // on exactly this row. Unchecked, anyone could hand any animal's file to
        // any caretaker by naming it in a request.
        var (_, failure) = await _bookings.CreateAsync(
            Owner, NewBooking() with { PetIds = ["p3"] });

        Assert.Equal(BookingFailure.NotYourPet, failure);
    }

    [Fact]
    public async Task A_refused_booking_writes_nothing()
    {
        var before = (await _bookings.ListMineAsync(Owner, null, 100)).Items.Length;

        await _bookings.CreateAsync(Owner, NewBooking() with { PetIds = ["p3"] });

        Assert.Equal(before, (await _bookings.ListMineAsync(Owner, null, 100)).Items.Length);
    }

    // ── The published calendar (STATUS §3-G) ─────────────────────────────

    [Fact]
    public async Task Refuses_a_booking_when_the_caretaker_has_published_nothing()
    {
        await Calendars.CloseCaretakerAsync(db.ConnectionString, Caretaker);
        var before = (await _bookings.ListMineAsync(Owner, null, 100)).Items.Length;

        var (booking, failure) = await _bookings.CreateAsync(Owner, NewBooking());

        Assert.Null(booking);
        Assert.Equal(BookingFailure.NotAvailable, failure);
        Assert.Equal(before, (await _bookings.ListMineAsync(Owner, null, 100)).Items.Length);
    }

    [Fact]
    public async Task Refuses_a_booking_outside_the_published_hours()
    {
        var start = Calendars.DaysAhead(3, hour: 13);
        await Calendars.CloseCaretakerAsync(db.ConnectionString, Caretaker);
        await Calendars.SetCaretakerDayAsync(
            db.ConnectionString, Caretaker, DateOnly.FromDateTime(start.UtcDateTime), ("08:00", "12:00"));

        var (_, failure) = await _bookings.CreateAsync(
            Owner, NewBooking() with { StartDateTime = start, EndDateTime = start.AddHours(1) });

        Assert.Equal(BookingFailure.NotAvailable, failure);
    }

    [Fact]
    public async Task Refuses_a_stay_whose_pick_up_day_is_closed()
    {
        var start = Calendars.DaysAhead(3, hour: 9);
        await Calendars.CloseCaretakerAsync(db.ConnectionString, Caretaker);
        await Calendars.SetCaretakerDayAsync(
            db.ConnectionString, Caretaker, DateOnly.FromDateTime(start.UtcDateTime), ("08:00", "18:00"));

        var (_, failure) = await _bookings.CreateAsync(
            Owner, NewBooking() with
            {
                ServiceType = ServiceTypes.Sitting,
                StartDateTime = start,
                EndDateTime = start.AddDays(2),
            });

        Assert.Equal(BookingFailure.NotAvailable, failure);
    }

    [Fact]
    public async Task Reads_the_published_hours_in_the_owners_zone()
    {
        // 09:00 at UTC-6 is 15:00 UTC: open at 08:00–12:00 local, closed if
        // the server read the instant as UTC.
        var localNine = new DateTimeOffset(
            Calendars.DaysAhead(3, hour: 9).DateTime, TimeSpan.FromHours(-6));
        await Calendars.CloseCaretakerAsync(db.ConnectionString, Caretaker);
        await Calendars.SetCaretakerDayAsync(
            db.ConnectionString, Caretaker, DateOnly.FromDateTime(localNine.DateTime), ("08:00", "12:00"));

        var request = NewBooking() with
        {
            StartDateTime = localNine.ToUniversalTime(),
            EndDateTime = localNine.ToUniversalTime().AddHours(1),
        };

        var (asUtc, refused) = await _bookings.CreateAsync(Owner, request);
        Assert.Null(asUtc);
        Assert.Equal(BookingFailure.NotAvailable, refused);

        var (booking, failure) = await _bookings.CreateAsync(Owner, request with { UtcOffsetMinutes = -360 });
        Assert.Null(failure);
        Assert.Equal(localNine.ToUniversalTime(), booking!.StartDateTime);
    }

    // ── Who may move a booking ───────────────────────────────────────────

    [Fact]
    public async Task Lets_the_caretaker_accept_a_request()
    {
        var (booking, failure) = await _bookings.UpdateStatusAsync(
            CaretakerUser, "b1", BookingStatuses.Accepted);

        Assert.Null(failure);
        Assert.Equal(BookingStatuses.Accepted, booking!.Status);
    }

    [Fact]
    public async Task Stops_the_owner_accepting_their_own_request()
    {
        var (_, failure) = await _bookings.UpdateStatusAsync(
            Owner, "b1", BookingStatuses.Accepted);

        Assert.Equal(BookingFailure.WrongActor, failure);

        var (unchanged, _) = await _bookings.GetAsync(Owner, "b1");
        Assert.Equal(BookingStatuses.Requested, unchanged!.Status);
    }

    [Fact]
    public async Task Stops_the_owner_completing_a_booking()
    {
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.Accepted);
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.InProgress);

        var (_, failure) = await _bookings.UpdateStatusAsync(
            Owner, "b1", BookingStatuses.Completed);

        Assert.Equal(BookingFailure.WrongActor, failure);
    }

    [Fact]
    public async Task Lets_either_party_cancel()
    {
        var (byOwner, ownerFailure) = await _bookings.UpdateStatusAsync(
            Owner, "b1", BookingStatuses.Cancelled);
        Assert.Null(ownerFailure);
        Assert.Equal(BookingStatuses.Cancelled, byOwner!.Status);

        await db.ResetAsync();

        var (_, caretakerFailure) = await _bookings.UpdateStatusAsync(
            CaretakerUser, "b1", BookingStatuses.Cancelled);
        Assert.Null(caretakerFailure);
    }

    [Fact]
    public async Task Refuses_a_status_change_from_a_stranger()
    {
        var (_, failure) = await _bookings.UpdateStatusAsync(
            Stranger, "b1", BookingStatuses.Accepted);

        Assert.Equal(BookingFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Checks_legality_before_authority()
    {
        // An illegal move reports as illegal even when the actor would have been
        // entitled to a legal one — more useful to say, and it does not leak the
        // current status to someone probing with the wrong verb.
        await _bookings.UpdateStatusAsync(Owner, "b1", BookingStatuses.Cancelled);

        var (_, failure) = await _bookings.UpdateStatusAsync(
            Owner, "b1", BookingStatuses.Accepted);

        Assert.Equal(BookingFailure.InvalidTransition, failure);
    }

    // ── The lifecycle ────────────────────────────────────────────────────

    [Fact]
    public async Task Walks_the_full_happy_path()
    {
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.Accepted);
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.InProgress);

        var (booking, failure) = await _bookings.UpdateStatusAsync(
            CaretakerUser, "b1", BookingStatuses.Completed);

        Assert.Null(failure);
        Assert.Equal(BookingStatuses.Completed, booking!.Status);
    }

    [Fact]
    public async Task Rejects_skipping_straight_to_in_progress()
    {
        var (_, failure) = await _bookings.UpdateStatusAsync(
            CaretakerUser, "b1", BookingStatuses.InProgress);

        Assert.Equal(BookingFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_changing_a_completed_booking()
    {
        // b9 is seeded completed. Terminal means terminal.
        //
        // The caller is resolved from the fixture rather than hardcoded: the
        // actor check runs before the transition check, so naming the wrong
        // user would make this pass for the wrong reason — NotParticipant looks
        // like a refusal too.
        var b9 = await BookingRowAsync("b9");

        var (_, failure) = await _bookings.UpdateStatusAsync(
            b9.OwnerId, "b9", BookingStatuses.InProgress);

        Assert.Equal(BookingFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_reviving_a_declined_booking()
    {
        // b13 is seeded declined.
        var booking = await BookingRowAsync("b13");
        var caretakerUser = await CaretakerUserAsync(booking.CaretakerId);

        var (_, failure) = await _bookings.UpdateStatusAsync(
            caretakerUser, "b13", BookingStatuses.Accepted);

        Assert.Equal(BookingFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Treats_a_no_op_same_status_update_as_valid()
    {
        // A double-tapped Accept button is not an error.
        var (booking, failure) = await _bookings.UpdateStatusAsync(
            CaretakerUser, "b1", BookingStatuses.Requested);

        Assert.Null(failure);
        Assert.Equal(BookingStatuses.Requested, booking!.Status);
    }

    // ── Response rate ────────────────────────────────────────────────────

    [Fact]
    public void The_response_rate_is_a_whole_percentage_of_requests_answered()
    {
        Assert.Equal(75, ReputationService.ResponseRateFrom(3, 1));
        Assert.Equal(33, ReputationService.ResponseRateFrom(1, 2));
        Assert.Equal(100, ReputationService.ResponseRateFrom(5, 0));
        Assert.Equal(0, ReputationService.ResponseRateFrom(0, 4));
    }

    [Fact]
    public void The_response_rate_is_100_for_someone_nobody_has_asked_yet()
    {
        // Nothing has gone unanswered, so there is nothing to hold against them.
        // Starting a new caretaker at 0% would be a scarlet letter for signing up.
        Assert.Equal(100, ReputationService.ResponseRateFrom(0, 0));
    }

    [Fact]
    public async Task The_seeded_response_rates_match_what_the_rows_imply()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var profiles = await conn.QueryAsync<(string Id, int Stored)>(
            """SELECT id, "responseRatePct" FROM caretaker_profiles""");

        foreach (var (id, stored) in profiles)
        {
            var answered = await conn.ExecuteScalarAsync<int>(
                """
                SELECT count(*)::int FROM bookings
                WHERE "caretakerId" = @id
                  AND status = ANY(ARRAY['accepted','declined','in_progress','completed'])
                """, new { id });

            var waiting = await conn.ExecuteScalarAsync<int>(
                """SELECT count(*)::int FROM bookings WHERE "caretakerId" = @id AND status = 'requested'""",
                new { id });

            Assert.Equal(ReputationService.ResponseRateFrom(answered, waiting), stored);
        }
    }

    [Fact]
    public async Task The_response_rate_rises_when_a_request_is_answered()
    {
        var before = await ResponseRateAsync(Caretaker);
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.Accepted);

        Assert.True(await ResponseRateAsync(Caretaker) > before);
    }

    [Fact]
    public async Task The_response_rate_rises_just_the_same_on_a_decline()
    {
        // Replying is the point. A caretaker who honestly says no is responsive.
        var before = await ResponseRateAsync(Caretaker);
        await _bookings.UpdateStatusAsync(CaretakerUser, "b1", BookingStatuses.Declined);

        Assert.True(await ResponseRateAsync(Caretaker) > before);
    }

    [Fact]
    public async Task The_response_rate_falls_when_a_new_request_arrives_unanswered()
    {
        var before = await ResponseRateAsync(Caretaker);
        await _bookings.CreateAsync(Owner, NewBooking());

        Assert.True(await ResponseRateAsync(Caretaker) < before);
    }

    [Fact]
    public async Task A_cancellation_says_nothing_about_responsiveness()
    {
        // Nothing records who cancelled or when, so a cancellation could equally
        // mean the caretaker ignored it or the owner changed their mind. b1
        // leaves the waiting pile without joining the answered one.
        var before = await ResponseRateAsync(Caretaker);
        await _bookings.UpdateStatusAsync(Owner, "b1", BookingStatuses.Cancelled);

        Assert.True(await ResponseRateAsync(Caretaker) >= before);
    }

    // ── Pricing arithmetic ───────────────────────────────────────────────

    [Theory]
    // An hour is an hour.
    [InlineData(2800, "hour", 1.0, 2800)]
    [InlineData(2800, "hour", 3.0, 8400)]
    // Under an hour still occupies an hour of somebody's calendar.
    [InlineData(2800, "hour", 0.25, 2800)]
    // Days round up: a stay running into a fourth day occupies a fourth day.
    [InlineData(5500, "day", 24.0, 5500)]
    [InlineData(5500, "day", 25.0, 11000)]
    [InlineData(5500, "day", 72.0, 16500)]
    public void Prices_a_booking_from_the_rate_and_the_duration(
        int rateCents, string unit, double hours, int expectedCents)
    {
        var start = new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

        Assert.Equal(
            expectedCents,
            BookingService.PriceBooking(rateCents, unit, start, start.AddHours(hours)));
    }

    [Fact]
    public void Pricing_is_integer_arithmetic_end_to_end()
    {
        // The reference multiplied a float rate by a count and rounded after,
        // which is how $210.00000000000003 reaches a receipt. Cents times a
        // whole number has nothing to round.
        var start = new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
        var cents = BookingService.PriceBooking(333, PricingUnits.Hour, start, start.AddHours(3));

        Assert.Equal(999, cents);
        Assert.Equal(9.99m, cents / 100m);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<int> ResponseRateAsync(string caretakerId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<int>(
            """SELECT "responseRatePct" FROM caretaker_profiles WHERE id = @caretakerId""",
            new { caretakerId });
    }

    private async Task<(string CaretakerId, string OwnerId)> BookingRowAsync(string id)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.QuerySingleAsync<(string, string)>(
            """SELECT "caretakerId", "ownerId" FROM bookings WHERE id = @id""", new { id });
    }

    private async Task<string> CaretakerUserAsync(string caretakerId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<string>(
            """SELECT "userId" FROM caretaker_profiles WHERE id = @caretakerId""",
            new { caretakerId }) ?? "";
    }
}
