using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The dashboards: the top cards, the calendar's window reads, and the vet's
/// reschedule. None of it has a reference counterpart — the client asked for
/// it after M10 — so the rules pinned here are the ones settled with the
/// owner: a total counts what went ahead or still might, "upcoming" is live
/// and not over before the viewer's today, earnings are the quoted price of
/// completed work, and an owner's spending is what the ledger actually took.
///
/// Fixtures. v1 (Dr Ruiz, u17): a1 completed $85, a3 confirmed, a4 requested,
/// a8 completed $85 — all in July 2026, so the past. c4 (Elena, u10): b2
/// requested, b5 accepted, b10 completed $70. Maya (u1): bookings b1, b7, b17
/// (completed) and the declined b14; visits a3, a4, a8 (completed); three paid
/// orders, $230.58.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class DashboardServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Maya = "u1";
    private const string DrRuiz = "u17";
    private const string Elena = "u10";
    private const string Stranger = "u2";

    private CoreHost _core = null!;
    private IDashboardService _dashboard = null!;
    private IAppointmentService _appointments = null!;
    private IBookingService _bookings = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _dashboard = _core.Get<IDashboardService>();
        _appointments = _core.Get<IAppointmentService>();
        _bookings = _core.Get<IBookingService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task ExecAsync(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    private async Task<T> ScalarAsync<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.ExecuteScalarAsync<T>(sql, args)
            ?? throw new InvalidOperationException("No value");
    }

    /// <summary>An appointment for Maya's Biscuit with Dr Ruiz, at a time relative to now.</summary>
    private Task AddVisitAsync(string id, TimeSpan fromNow, string status, int feeCents = 8500,
        TimeSpan? length = null)
    {
        var start = Ids.Now().Add(fromNow);
        return ExecAsync(
            """
            INSERT INTO vet_appointments (
                id, "ownerId", "vetId", "petId", mode, reason, symptoms,
                "startDateTime", "endDateTime", status, notes, "createdAt",
                "baseFeeCents", "discountPct", priority, "feeCents")
            VALUES (@id, 'u1', 'v1', 'p1', 'in_clinic', 'Check-up', '{}',
                    @start, @end, @status, '', now(), @feeCents, 0, false, @feeCents)
            """,
            new { id, start, end = start.Add(length ?? TimeSpan.FromMinutes(30)), status, feeCents });
    }

    /// <summary>A booking of Maya's with Elena (c4), at a time relative to now.</summary>
    private Task AddBookingAsync(string id, TimeSpan fromNow, TimeSpan length, string status,
        int priceCents = 5000)
    {
        var start = Ids.Now().Add(fromNow);
        return ExecAsync(
            """
            INSERT INTO bookings (
                id, "ownerId", "caretakerId", "petIds", "serviceType",
                "startDateTime", "endDateTime", notes, status, "createdAt", "priceTotalCents")
            VALUES (@id, 'u1', 'c4', '{p1}', 'boarding', @start, @end, '', @status, now(), @priceCents)
            """,
            new { id, start, end = start.Add(length), status, priceCents });
    }

    // ── The vet's cards ──────────────────────────────────────────────────

    [Fact]
    public async Task A_clinic_sees_its_totals_and_what_its_completed_visits_were_worth()
    {
        var stats = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", null);

        Assert.NotNull(stats);
        Assert.Equal(4, stats.Total);          // a1, a3, a4, a8
        Assert.Equal(2, stats.Completed);      // a1, a8
        Assert.Equal(17000, stats.EarnedCents);
        Assert.Equal(0, stats.Upcoming);       // a3 and a4 were in July
    }

    [Fact]
    public async Task Declined_and_cancelled_visits_are_not_work()
    {
        await AddVisitAsync("ax1", TimeSpan.FromDays(3), AppointmentStatuses.Declined);
        await AddVisitAsync("ax2", TimeSpan.FromDays(4), AppointmentStatuses.Cancelled);

        var stats = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", null);

        Assert.Equal(4, stats!.Total);
        Assert.Equal(0, stats.Upcoming);
    }

    [Fact]
    public async Task Upcoming_is_live_and_not_yet_over()
    {
        await AddVisitAsync("ax1", TimeSpan.FromDays(2), AppointmentStatuses.Confirmed);
        await AddVisitAsync("ax2", TimeSpan.FromDays(5), AppointmentStatuses.Requested);
        // Started ten minutes ago and still going — today's, so upcoming.
        await AddVisitAsync("ax3", TimeSpan.FromMinutes(-10), AppointmentStatuses.InProgress);
        // A request nobody answered whose time has gone is not upcoming.
        await AddVisitAsync("ax4", TimeSpan.FromDays(-3), AppointmentStatuses.Requested);

        var stats = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", null);

        Assert.Equal(3, stats!.Upcoming);
        Assert.Equal(8, stats.Total);
    }

    [Fact]
    public async Task Earnings_count_only_completed_visits_at_the_price_recorded()
    {
        // The recorded fee, not the clinic's list price today: a member's
        // discounted visit earned what it was quoted.
        await AddVisitAsync("ax1", TimeSpan.FromDays(-10), AppointmentStatuses.Completed, feeCents: 6800);
        await AddVisitAsync("ax2", TimeSpan.FromDays(2), AppointmentStatuses.Confirmed, feeCents: 9999);

        var stats = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", null);

        Assert.Equal(17000 + 6800, stats!.EarnedCents);
        Assert.Equal(3, stats.Completed);
    }

    [Fact]
    public async Task A_clinics_figures_are_the_clinics_alone()
    {
        Assert.Null(await _dashboard.GetVetStatsAsync(Stranger, "v1", null));
        Assert.Null(await _dashboard.GetVetStatsAsync(Maya, "v1", null));
        // Another vet, too.
        Assert.Null(await _dashboard.GetVetStatsAsync("u18", "v1", null));
    }

    [Fact]
    public async Task Today_is_the_viewers_but_cannot_be_pushed_into_the_past()
    {
        // A visit six days ago would be "upcoming" if the client could say
        // today began last week. It cannot: the start is clamped to a day.
        await AddVisitAsync("ax1", TimeSpan.FromDays(-6), AppointmentStatuses.Confirmed);

        var stats = await _dashboard.GetVetStatsAsync(
            DrRuiz, "v1", Ids.Now().AddDays(-7));

        Assert.Equal(0, stats!.Upcoming);
    }

    [Fact]
    public async Task Today_from_the_client_counts_this_mornings_visit()
    {
        // Two hours ago and finished. Midnight UTC may be after it in some
        // zones; the viewer's own start of day decides.
        await AddVisitAsync("ax1", TimeSpan.FromHours(-2), AppointmentStatuses.Confirmed,
            length: TimeSpan.FromHours(1));

        var early = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", Ids.Now().AddHours(-3));
        var late = await _dashboard.GetVetStatsAsync(DrRuiz, "v1", Ids.Now().AddMinutes(-30));

        Assert.Equal(1, early!.Upcoming);
        Assert.Equal(0, late!.Upcoming);
    }

    [Fact]
    public void Today_defaults_to_midnight_utc_and_clamps_both_ways()
    {
        var now = Ids.Now();

        Assert.Equal(new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero), DashboardService.Today(null));
        Assert.True(DashboardService.Today(now.AddDays(-30)) >= now.AddHours(-26));
        Assert.True(DashboardService.Today(now.AddDays(30)) <= Ids.Now());
    }

    // ── The caretaker's cards ────────────────────────────────────────────

    [Fact]
    public async Task A_caretaker_sees_its_totals_and_what_its_completed_bookings_were_worth()
    {
        var stats = await _dashboard.GetCaretakerStatsAsync(Elena, "c4", null);

        Assert.NotNull(stats);
        Assert.Equal(3, stats.Total);         // b2, b5, b10
        Assert.Equal(1, stats.Completed);     // b10
        Assert.Equal(7000, stats.EarnedCents);
        Assert.Equal(0, stats.Upcoming);
    }

    [Fact]
    public async Task A_boarding_that_is_still_running_is_upcoming()
    {
        // Started yesterday, ends tomorrow.
        await AddBookingAsync("bx1", TimeSpan.FromDays(-1), TimeSpan.FromDays(2), BookingStatuses.InProgress);
        await AddBookingAsync("bx2", TimeSpan.FromDays(3), TimeSpan.FromHours(4), BookingStatuses.Accepted);
        await AddBookingAsync("bx3", TimeSpan.FromDays(3), TimeSpan.FromHours(4), BookingStatuses.Declined);

        var stats = await _dashboard.GetCaretakerStatsAsync(Elena, "c4", null);

        Assert.Equal(2, stats!.Upcoming);
        Assert.Equal(5, stats.Total);
    }

    [Fact]
    public async Task A_caretakers_figures_are_the_caretakers_alone()
    {
        Assert.Null(await _dashboard.GetCaretakerStatsAsync(Maya, "c4", null));
        Assert.Null(await _dashboard.GetCaretakerStatsAsync("u7", "c4", null));
    }

    // ── The owner's cards ────────────────────────────────────────────────

    [Fact]
    public async Task An_owner_sees_bookings_and_visits_together_and_what_they_paid()
    {
        var stats = await _dashboard.GetOwnerStatsAsync(Maya, null);

        Assert.Equal(6, stats.Requests);      // b1, b7, b17 + a3, a4, a8 — not the declined b14
        Assert.Equal(2, stats.Completed);     // b17, a8
        Assert.Equal(0, stats.Upcoming);
        Assert.Equal(10281 + 6226 + 6551, stats.SpentCents);
    }

    [Fact]
    public async Task Spending_is_net_of_refunds_and_ignores_money_that_never_moved()
    {
        await ExecAsync(
            """
            UPDATE payments SET status = 'partially_refunded', "amountRefundedCents" = 500 WHERE id = 'pay_seed_o1';
            UPDATE payments SET status = 'refunded', "amountRefundedCents" = "amountCents" WHERE id = 'pay_seed_o2';
            UPDATE payments SET status = 'failed' WHERE id = 'pay_seed_o3';
            """);

        var stats = await _dashboard.GetOwnerStatsAsync(Maya, null);

        Assert.Equal(10281 - 500, stats.SpentCents);
    }

    [Fact]
    public async Task Booked_care_is_not_spending()
    {
        // Bookings and vet visits are not charged through Leash. A completed
        // $500 boarding is a request and a completion, and not a cent spent.
        await AddBookingAsync("bx1", TimeSpan.FromDays(-20), TimeSpan.FromDays(3),
            BookingStatuses.Completed, priceCents: 50000);

        var stats = await _dashboard.GetOwnerStatsAsync(Maya, null);

        Assert.Equal(7, stats.Requests);
        Assert.Equal(3, stats.Completed);
        Assert.Equal(23058, stats.SpentCents);
    }

    [Fact]
    public async Task An_owners_upcoming_counts_both_kinds()
    {
        await AddVisitAsync("ax1", TimeSpan.FromDays(2), AppointmentStatuses.Confirmed);
        await AddBookingAsync("bx1", TimeSpan.FromDays(4), TimeSpan.FromHours(3), BookingStatuses.Requested);

        Assert.Equal(2, (await _dashboard.GetOwnerStatsAsync(Maya, null)).Upcoming);
    }

    [Fact]
    public async Task Nobody_elses_spending_is_yours()
    {
        // Priya (u3) has the fourth paid order; Daniel has none.
        Assert.Equal(0, (await _dashboard.GetOwnerStatsAsync(Stranger, null)).SpentCents);
        Assert.Equal(19483, (await _dashboard.GetOwnerStatsAsync("u3", null)).SpentCents);
    }

    // ── The calendar's window ────────────────────────────────────────────

    [Fact]
    public async Task A_window_holds_what_overlaps_it_soonest_first()
    {
        var from = new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero);

        var page = await _appointments.ListVetScheduleAsync(
            DrRuiz, "v1", new ScheduleWindow(from, to, []), null, 100);

        // a1 (June 20) is outside; a8 (June 30, 16:00Z) ends before July.
        Assert.Equal(["a3", "a4"], page!.Items.Select(a => a.Id).ToArray());
    }

    [Fact]
    public async Task A_window_can_keep_only_some_statuses()
    {
        var from = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        var page = await _appointments.ListVetScheduleAsync(
            DrRuiz, "v1",
            new ScheduleWindow(from, null, [AppointmentStatuses.Requested, AppointmentStatuses.Confirmed]),
            null, 100);

        Assert.Equal(["a3", "a4"], page!.Items.Select(a => a.Id).ToArray());
    }

    [Fact]
    public async Task A_window_pages_forward_without_skipping_rows_that_share_a_start()
    {
        // Four visits at one instant, two more after. Walk two at a time.
        var start = TimeSpan.FromDays(10);
        foreach (var id in new[] { "ax1", "ax2", "ax3", "ax4" })
            await AddVisitAsync(id, start, AppointmentStatuses.Confirmed);
        await AddVisitAsync("ax5", start.Add(TimeSpan.FromHours(1)), AppointmentStatuses.Confirmed);
        await AddVisitAsync("ax6", start.Add(TimeSpan.FromHours(2)), AppointmentStatuses.Requested);

        var window = new ScheduleWindow(Ids.Now(), null, []);
        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _appointments.ListVetScheduleAsync(DrRuiz, "v1", window, cursor, 2);
            seen.AddRange(page!.Items.Select(a => a.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(["ax1", "ax2", "ax3", "ax4", "ax5", "ax6"], seen);
    }

    [Fact]
    public async Task A_clinics_window_is_the_clinics_alone()
        => Assert.Null(await _appointments.ListVetScheduleAsync(
            Stranger, "v1", new ScheduleWindow(Ids.Now(), null, []), null, 10));

    [Fact]
    public async Task A_caretakers_window_includes_a_stay_that_began_before_it()
    {
        // b5: Pepper boards with Elena from July 18 to July 21. A window from
        // July 20 still holds it — the dashboard marks every night.
        var from = new DateTimeOffset(2026, 7, 20, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 7, 21, 0, 0, 0, TimeSpan.Zero);

        var page = await _bookings.ListCaretakerScheduleAsync(
            Elena, "c4", new ScheduleWindow(from, to, []), null, 100);

        Assert.Equal(["b5"], page!.Items.Select(b => b.Id).ToArray());
        Assert.Null(await _bookings.ListCaretakerScheduleAsync(
            Maya, "c4", new ScheduleWindow(from, to, []), null, 100));
    }

    [Fact]
    public async Task An_owners_window_holds_their_own_rows_only()
    {
        var from = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var to = new DateTimeOffset(2026, 8, 1, 0, 0, 0, TimeSpan.Zero);
        var window = new ScheduleWindow(from, to, []);

        var bookings = await _bookings.ListMyScheduleAsync(Maya, window, null, 100);
        var visits = await _appointments.ListMyScheduleAsync(Maya, window, null, 100);

        Assert.Equal(["b17", "b14", "b7", "b1"], bookings.Items.Select(b => b.Id).ToArray());
        Assert.Equal(["a8", "a3", "a4"], visits.Items.Select(a => a.Id).ToArray());
        Assert.All(bookings.Items, b => Assert.Equal(Maya, b.OwnerId));
    }

    // ── Rescheduling ─────────────────────────────────────────────────────

    private static RescheduleAppointmentRequest InDays(int days, int minutes = 30)
    {
        var start = Ids.Now().AddDays(days);
        return new RescheduleAppointmentRequest(start, start.AddMinutes(minutes));
    }

    [Fact]
    public async Task The_vet_moves_a_confirmed_visit_and_it_stays_confirmed()
    {
        var to = InDays(3);

        var (moved, failure) = await _appointments.RescheduleAsync(DrRuiz, "a3", to);

        Assert.Null(failure);
        Assert.Equal(to.StartDateTime, moved!.StartDateTime);
        Assert.Equal(to.EndDateTime, moved.EndDateTime);
        Assert.Equal(AppointmentStatuses.Confirmed, moved.Status);

        var (reread, _) = await _appointments.GetAsync(Maya, "a3");
        Assert.Equal(to.StartDateTime, reread!.StartDateTime);
    }

    [Fact]
    public async Task A_request_can_be_moved_before_it_is_answered()
    {
        var (moved, failure) = await _appointments.RescheduleAsync(DrRuiz, "a4", InDays(2));

        Assert.Null(failure);
        Assert.Equal(AppointmentStatuses.Requested, moved!.Status);
    }

    [Fact]
    public async Task The_owner_is_told_in_the_app_and_by_email()
    {
        await _appointments.RescheduleAsync(DrRuiz, "a3", InDays(3));

        var page = await _core.Get<INotificationService>().ListMineAsync(Maya, null, 10);
        var notice = Assert.Single(page.Items);
        Assert.Equal(NotificationKinds.AppointmentRescheduled, notice.Kind);
        Assert.Equal("/appointments/a3", notice.Href);
        Assert.Contains("Annual wellness exam", notice.Body);

        Assert.Equal(1, await ScalarAsync<int>(
            "SELECT count(*)::int FROM notification_outbox WHERE channel = 'email'"));

        // Nobody else hears about it — the vet made the move.
        Assert.Empty((await _core.Get<INotificationService>().ListMineAsync(DrRuiz, null, 10)).Items);
    }

    [Fact]
    public async Task Only_the_vet_can_reschedule()
    {
        var (_, failure) = await _appointments.RescheduleAsync(Maya, "a3", InDays(3));
        Assert.Equal(AppointmentFailure.WrongActor, failure);
    }

    [Fact]
    public async Task A_stranger_learns_nothing()
    {
        var (_, failure) = await _appointments.RescheduleAsync(Stranger, "a3", InDays(3));
        Assert.Equal(AppointmentFailure.NotParticipant, failure);

        // Another clinic is a stranger too.
        (_, failure) = await _appointments.RescheduleAsync("u18", "a3", InDays(3));
        Assert.Equal(AppointmentFailure.NotParticipant, failure);
    }

    [Theory]
    [InlineData("a1")] // completed
    [InlineData("a8")] // completed
    public async Task A_finished_visit_cannot_be_moved(string id)
    {
        var (_, failure) = await _appointments.RescheduleAsync(DrRuiz, id, InDays(3));
        Assert.Equal(AppointmentFailure.NotReschedulable, failure);
    }

    [Theory]
    [InlineData(AppointmentStatuses.InProgress)]
    [InlineData(AppointmentStatuses.Declined)]
    [InlineData(AppointmentStatuses.Cancelled)]
    public async Task Legality_comes_before_authority(string status)
    {
        // Even the owner, who could never reschedule, is told the visit
        // cannot move rather than that they may not move it — as with status
        // moves, so the wrong verb does not probe the state.
        await ExecAsync("UPDATE vet_appointments SET status = @status WHERE id = 'a3'", new { status });

        Assert.Equal(AppointmentFailure.NotReschedulable,
            (await _appointments.RescheduleAsync(DrRuiz, "a3", InDays(3))).Failure);
        Assert.Equal(AppointmentFailure.NotReschedulable,
            (await _appointments.RescheduleAsync(Maya, "a3", InDays(3))).Failure);
    }

    [Fact]
    public async Task The_new_time_must_be_in_the_future()
    {
        var past = Ids.Now().AddHours(-1);
        var (_, failure) = await _appointments.RescheduleAsync(
            DrRuiz, "a3", new RescheduleAppointmentRequest(past, past.AddMinutes(30)));

        Assert.Equal(AppointmentFailure.RescheduleInPast, failure);
    }

    [Fact]
    public async Task The_new_time_must_end_after_it_starts()
    {
        var start = Ids.Now().AddDays(2);
        var (_, failure) = await _appointments.RescheduleAsync(
            DrRuiz, "a3", new RescheduleAppointmentRequest(start, start));

        Assert.Equal(AppointmentFailure.BadDates, failure);
    }

    [Fact]
    public async Task Moving_a_visit_to_the_time_it_has_tells_nobody()
    {
        var to = InDays(3);
        await _appointments.RescheduleAsync(DrRuiz, "a3", to);
        var (again, failure) = await _appointments.RescheduleAsync(DrRuiz, "a3", to);

        Assert.Null(failure);
        Assert.Equal(to.StartDateTime, again!.StartDateTime);
        Assert.Single((await _core.Get<INotificationService>().ListMineAsync(Maya, null, 10)).Items);
    }

    [Fact]
    public async Task The_fee_the_pet_and_the_reason_do_not_move()
    {
        var before = (await _appointments.GetAsync(Maya, "a3")).Appointment!;
        var (after, _) = await _appointments.RescheduleAsync(DrRuiz, "a3", InDays(3));

        Assert.Equal(before.Fee, after!.Fee);
        Assert.Equal(before.PetId, after.PetId);
        Assert.Equal(before.Reason, after.Reason);
        Assert.Equal(before.Mode, after.Mode);
    }

    [Fact]
    public async Task The_write_is_conditional_on_the_status_it_can_move_from()
    {
        // The race the service cannot see: a cancellation lands between its
        // read and its write. The conditional UPDATE refuses rather than
        // leaving a cancelled visit at a new time.
        await ExecAsync("UPDATE vet_appointments SET status = 'cancelled' WHERE id = 'a3'");
        var to = InDays(3);

        var moved = await _core.Get<IAppointmentRepository>().RescheduleAsync(
            "a3", to.StartDateTime, to.EndDateTime,
            [AppointmentStatuses.Requested, AppointmentStatuses.Confirmed]);

        Assert.Null(moved);
        Assert.Equal("2026-07-12", (await ScalarAsync<DateTime>(
            """SELECT "startDateTime" FROM vet_appointments WHERE id = 'a3'""")).ToString("yyyy-MM-dd"));
    }
}
