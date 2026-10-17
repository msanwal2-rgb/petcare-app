using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Email;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/notifications.test.ts</c>, plus what the reference had
/// no suite for because it had the defects: the outbox (N6), escaping (N5) and
/// marking read only what was seen (N7).
///
/// ── Departures from the reference suite ──
///
///  1. <b>"clears everything when given no id" is inverted.</b> That test
///     pinned the behaviour N7 calls a defect. Here an empty list marks
///     nothing, and a notification that arrives after the panel was read stays
///     unread.
///  2. <b>The status machines are driven by real callers.</b> The reference
///     called its machines actor-less; here the actor is derived from the
///     caller, so Liam (c1) accepts and Dr Ruiz (v1) confirms.
///  3. <b>Atomicity is tested.</b> The reference notified after its write
///     committed. Here the notice is in the move's transaction, so a refused
///     move announces nothing.
///
/// ── Fixtures ──
///
/// u1 (Maya) owns booking b1 (requested, caretaker c1 = u7) and appointments
/// a3 (confirmed) and a4 (requested), both with vet v1 = u17; and order o3
/// (processing). u3 (Priya) owns o4 (shipped). u21 is ops.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class NotificationServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Maya = "u1";
    private const string Stranger = "u2";
    private const string Priya = "u3";
    private const string Liam = "u7";
    private const string DrRuiz = "u17";
    private const string Ops = "u21";

    private CoreHost _core = null!;
    private INotifier _notifier = null!;
    private INotificationService _notifications = null!;
    private INotificationOutbox _outbox = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _notifier = _core.Get<INotifier>();
        _notifications = _core.Get<INotificationService>();
        _outbox = _core.Get<INotificationOutbox>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static NotifyInput Notice(string title, string href = "/a", string kind = NotificationKinds.OrderShipped)
        => new(kind, title, "", href);

    private async Task<string[]> KindsAsync(string userId)
        => [.. (await _notifications.ListMineAsync(userId, null)).Items.Select(n => n.Kind)];

    private async Task<int> UnreadAsync(string userId)
        => (await _notifications.ListMineAsync(userId, null)).Unread;

    // ── Recording a notification ─────────────────────────────────────────

    [Fact]
    public async Task Stores_it_unread_against_the_right_person()
    {
        var n = await _notifier.NotifyAsync(Maya, Notice("On its way", "/store/orders/o1"));

        Assert.StartsWith("n_", n!.Id);
        Assert.Null(n.ReadAt);
        Assert.Equal(1, await UnreadAsync(Maya));
        Assert.Equal(0, await UnreadAsync(Stranger));
    }

    [Fact]
    public async Task Lists_newest_first()
    {
        await _notifier.NotifyAsync(Maya, Notice("First"));
        await _notifier.NotifyAsync(Maya, Notice("Second"));

        var titles = (await _notifications.ListMineAsync(Maya, null)).Items.Select(n => n.Title).ToArray();
        Assert.Equal("Second", titles[0]);
    }

    [Fact]
    public async Task Lists_newest_first_even_within_one_millisecond()
    {
        // The trap ARCHITECTURE.md §9 item 11 names: ids are random, and the
        // fulfilment job writes several notices in one instant. Written here
        // inside one transaction so they share a clock read's millisecond as
        // often as the machine allows; seq is what keeps them in order.
        await using (var scope = await _core.Get<IUnitOfWork>().BeginAsync())
        {
            for (var i = 1; i <= 5; i++)
                await _notifier.NotifyAsync(Maya, Notice($"#{i}"), scope);
            await scope.CommitAsync();
        }

        var titles = (await _notifications.ListMineAsync(Maya, null)).Items.Select(n => n.Title);
        Assert.Equal(["#5", "#4", "#3", "#2", "#1"], titles);
    }

    [Fact]
    public async Task Does_not_throw_when_the_recipient_does_not_exist()
    {
        // A failure to notify must never roll back the thing being notified about.
        Assert.Null(await _notifier.NotifyAsync("ghost", Notice("Nowhere", "/x")));
    }

    [Fact]
    public async Task A_missing_recipient_does_not_poison_the_callers_transaction()
    {
        // Inside a scope an error would abort everything the caller wrote. The
        // existence check is in the INSERT, so a ghost is just zero rows.
        await using var scope = await _core.Get<IUnitOfWork>().BeginAsync();

        Assert.Null(await _notifier.NotifyAsync("ghost", Notice("Nowhere"), scope));
        Assert.NotNull(await _notifier.NotifyAsync(Maya, Notice("Still fine"), scope));
        await scope.CommitAsync();

        Assert.Equal(1, await UnreadAsync(Maya));
    }

    [Fact]
    public async Task Pages_with_a_cursor_without_repeating_or_skipping()
    {
        for (var i = 1; i <= 7; i++) await _notifier.NotifyAsync(Maya, Notice($"#{i}"));

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _notifications.ListMineAsync(Maya, cursor, limit: 3);
            seen.AddRange(page.Items.Select(n => n.Title));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(["#7", "#6", "#5", "#4", "#3", "#2", "#1"], seen);
    }

    [Fact]
    public async Task The_unread_count_covers_more_than_the_page()
    {
        for (var i = 1; i <= 4; i++) await _notifier.NotifyAsync(Maya, Notice($"#{i}"));

        var page = await _notifications.ListMineAsync(Maya, null, limit: 2);
        Assert.Equal(2, page.Items.Length);
        Assert.Equal(4, page.Unread);
    }

    // ── Marking read (N7) ────────────────────────────────────────────────

    [Fact]
    public async Task Clears_exactly_the_ones_it_is_given()
    {
        var a = await _notifier.NotifyAsync(Maya, Notice("A"));
        var b = await _notifier.NotifyAsync(Maya, Notice("B"));

        var result = await _notifications.MarkReadAsync(Maya, [a!.Id, b!.Id]);

        Assert.Equal(0, result.Unread);
    }

    [Fact]
    public async Task Clears_just_the_one_when_given_one_id()
    {
        var first = await _notifier.NotifyAsync(Maya, Notice("A"));
        await _notifier.NotifyAsync(Maya, Notice("B"));

        await _notifications.MarkReadAsync(Maya, [first!.Id]);

        Assert.Equal(1, await UnreadAsync(Maya));
    }

    [Fact]
    public async Task An_empty_list_marks_nothing()
    {
        // The reference read "no id" as "everything" — the defect N7 names.
        await _notifier.NotifyAsync(Maya, Notice("A"));

        Assert.Equal(1, (await _notifications.MarkReadAsync(Maya, [])).Unread);
    }

    [Fact]
    public async Task One_that_arrived_after_the_panel_was_read_stays_unread()
    {
        await _notifier.NotifyAsync(Maya, Notice("Seen"));
        var shown = (await _notifications.ListMineAsync(Maya, null)).Items.Select(n => n.Id).ToArray();

        // Arrives while the panel is open.
        await _notifier.NotifyAsync(Maya, Notice("Not seen yet"));

        var result = await _notifications.MarkReadAsync(Maya, shown);
        Assert.Equal(1, result.Unread);
    }

    [Fact]
    public async Task Refuses_to_clear_somebody_elses()
    {
        var theirs = await _notifier.NotifyAsync(Stranger, Notice("A"));

        await _notifications.MarkReadAsync(Maya, [theirs!.Id]);

        Assert.Equal(1, await UnreadAsync(Stranger));
    }

    // ── What the status machines announce ────────────────────────────────

    [Fact]
    public async Task Tells_the_owner_when_a_caretaker_accepts()
    {
        await _core.Get<IBookingService>().UpdateStatusAsync(Liam, "b1", BookingStatuses.Accepted);
        Assert.Contains(NotificationKinds.BookingAccepted, await KindsAsync(Maya));
    }

    [Fact]
    public async Task Tells_the_owner_when_a_caretaker_declines()
    {
        await _core.Get<IBookingService>().UpdateStatusAsync(Liam, "b1", BookingStatuses.Declined);
        Assert.Contains(NotificationKinds.BookingDeclined, await KindsAsync(Maya));
    }

    [Fact]
    public async Task Says_nothing_when_a_booking_is_merely_cancelled()
    {
        // Whoever cancelled already knows; the other side sees it on the booking.
        await _core.Get<IBookingService>().UpdateStatusAsync(Maya, "b1", BookingStatuses.Cancelled);
        Assert.Empty(await KindsAsync(Maya));
        Assert.Empty(await KindsAsync(Liam));
    }

    [Fact]
    public async Task Says_nothing_about_a_move_that_was_refused()
    {
        // The owner may not accept their own booking (C8). The notice is in the
        // move's transaction, so a refusal leaves no bell behind.
        var (_, failure) = await _core.Get<IBookingService>()
            .UpdateStatusAsync(Maya, "b1", BookingStatuses.Accepted);

        Assert.Equal(BookingFailure.WrongActor, failure);
        Assert.Empty(await KindsAsync(Maya));
    }

    [Fact]
    public async Task A_double_tapped_accept_announces_once()
    {
        var bookings = _core.Get<IBookingService>();
        await bookings.UpdateStatusAsync(Liam, "b1", BookingStatuses.Accepted);
        await bookings.UpdateStatusAsync(Liam, "b1", BookingStatuses.Accepted);

        Assert.Single(await KindsAsync(Maya));
    }

    [Fact]
    public async Task Tells_the_owner_when_a_vet_confirms()
    {
        await _core.Get<IAppointmentService>().UpdateStatusAsync(DrRuiz, "a4", AppointmentStatuses.Confirmed);
        Assert.Contains(NotificationKinds.AppointmentConfirmed, await KindsAsync(Maya));
    }

    [Fact]
    public async Task Tells_the_owner_when_a_vet_declines()
    {
        await _core.Get<IAppointmentService>().UpdateStatusAsync(DrRuiz, "a4", AppointmentStatuses.Declined);
        Assert.Contains(NotificationKinds.AppointmentDeclined, await KindsAsync(Maya));
    }

    [Fact]
    public async Task Tells_the_owner_when_a_visit_summary_is_ready()
    {
        // The summary is the only way to complete a visit (STATUS.md §5), so it
        // is the path that must announce it.
        var appointments = _core.Get<IAppointmentService>();
        await appointments.UpdateStatusAsync(DrRuiz, "a3", AppointmentStatuses.InProgress);
        Assert.Empty(await KindsAsync(Maya)); // the owner is in the room

        var (_, failure) = await appointments.CompleteWithSummaryAsync(DrRuiz, "a3", Summary());
        Assert.Null(failure);

        var feed = await _notifications.ListMineAsync(Maya, null);
        var ready = Assert.Single(feed.Items);
        Assert.Equal(NotificationKinds.AppointmentCompleted, ready.Kind);
        Assert.Equal("/appointments/a3", ready.Href);
        Assert.StartsWith("Annual wellness exam", ready.Body);
    }

    [Fact]
    public async Task Announces_the_delivery_milestones_and_nothing_else()
    {
        var lifecycle = _core.Get<IOrderLifecycle>();

        // o3 belongs to u1 and is `processing`.
        await lifecycle.MoveAsync("o3", OrderStatuses.Packed);
        Assert.Empty(await KindsAsync(Maya)); // packing is warehouse noise

        await lifecycle.MoveAsync("o3", OrderStatuses.Shipped);
        await lifecycle.MoveAsync("o3", OrderStatuses.OutForDelivery);
        await lifecycle.MoveAsync("o3", OrderStatuses.Delivered);

        Assert.Equal(
            [NotificationKinds.OrderDelivered, NotificationKinds.OrderOutForDelivery, NotificationKinds.OrderShipped],
            await KindsAsync(Maya));
    }

    [Fact]
    public async Task Links_each_one_at_the_thing_it_is_about()
    {
        var lifecycle = _core.Get<IOrderLifecycle>();
        await lifecycle.MoveAsync("o3", OrderStatuses.Packed);
        await lifecycle.MoveAsync("o3", OrderStatuses.Shipped);

        var shipped = (await _notifications.ListMineAsync(Maya, null)).Items[0];
        Assert.Equal("/store/orders/o3", shipped.Href);
    }

    [Fact]
    public async Task Notifies_the_customer_not_whoever_moved_the_order()
    {
        // o4 is Priya's (u3); ops advancing it must not notify ops.
        await _core.Get<IOrderService>().UpdateStatusAsync(
            Ops, "o4", new UpdateOrderStatusRequest(OrderStatuses.OutForDelivery, null, null, null));

        Assert.Contains(NotificationKinds.OrderOutForDelivery, await KindsAsync(Priya));
        Assert.Empty(await KindsAsync(Ops));
    }

    // ── The outbox (N3, N6) ──────────────────────────────────────────────

    private async Task<(string Channel, string Status, int Attempts)[]> OutboxAsync()
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        var rows = await conn.QueryAsync<(string, string, int)>(
            "SELECT channel, status, attempts FROM notification_outbox ORDER BY \"createdAt\", id");
        return [.. rows];
    }

    [Fact]
    public async Task Each_notification_owes_one_email_and_no_push()
    {
        // Push is the seam N3 asks for, built and switched off — so nothing
        // queues up for a channel that cannot deliver.
        await _notifier.NotifyAsync(Maya, Notice("On its way"));

        var row = Assert.Single(await OutboxAsync());
        Assert.Equal((NotificationChannels.Email, OutboxStatuses.Pending, 0), row);
    }

    [Fact]
    public async Task Nothing_is_emailed_until_the_outbox_is_drained()
    {
        // N6: the request that raised the notice does not send mail.
        await _notifier.NotifyAsync(Maya, Notice("On its way"));
        Assert.Empty(_core.Mailer.Sent);

        var report = await _outbox.DrainAsync(Ids.Now());

        Assert.Equal(1, report.Sent);
        var mail = Assert.Single(_core.Mailer.Sent);
        Assert.Equal("maya.chen@example.com", mail.To);
        Assert.Equal("On its way", mail.Subject);
        Assert.Contains("Hi Maya,", mail.Text);
        Assert.Equal(OutboxStatuses.Sent, (await OutboxAsync())[0].Status);
    }

    [Fact]
    public async Task A_drained_row_is_not_sent_twice()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way"));
        await _outbox.DrainAsync(Ids.Now());
        await _outbox.DrainAsync(Ids.Now().AddHours(1));

        Assert.Single(_core.Mailer.Sent);
    }

    [Fact]
    public async Task Two_drains_racing_deliver_each_email_once()
    {
        for (var i = 0; i < 10; i++) await _notifier.NotifyAsync(Maya, Notice($"#{i}"));

        var now = Ids.Now();
        var reports = await Task.WhenAll(
            _outbox.DrainAsync(now, batchSize: 10),
            _outbox.DrainAsync(now, batchSize: 10));

        Assert.Equal(10, reports.Sum(r => r.Sent));
        Assert.Equal(10, _core.Mailer.Sent.Count);
        Assert.Equal(10, _core.Mailer.Sent.Select(m => m.IdempotencyKey).Distinct().Count());
    }

    [Fact]
    public async Task The_email_links_to_the_thing_it_is_about()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way", "/store/orders/o3"));
        await _outbox.DrainAsync(Ids.Now());

        var mail = Assert.Single(_core.Mailer.Sent);
        Assert.Contains($"{CoreHost.TestOrigin}/store/orders/o3", mail.Html);
        Assert.Contains($"{CoreHost.TestOrigin}/store/orders/o3", mail.Text);
    }

    [Fact]
    public async Task Escapes_everything_user_controlled_in_the_html()
    {
        // N5. The reason is what the owner typed when booking; the confirmation
        // quotes it back. Unescaped, this is a working link inside a genuine
        // email from us.
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
        {
            await conn.ExecuteAsync(
                """UPDATE vet_appointments SET reason = '<a href="https://evil.example">Reschedule</a>' WHERE id = 'a4'""");
            await conn.ExecuteAsync(
                """UPDATE users SET name = '<b>Maya</b> Chen' WHERE id = 'u1'""");
        }

        await _core.Get<IAppointmentService>().UpdateStatusAsync(DrRuiz, "a4", AppointmentStatuses.Confirmed);
        await _outbox.DrainAsync(Ids.Now());

        var mail = Assert.Single(_core.Mailer.Sent);
        Assert.DoesNotContain("<a href=\"https://evil.example\"", mail.Html);
        Assert.Contains("&lt;a href=&quot;https://evil.example&quot;&gt;", mail.Html);
        Assert.DoesNotContain("<b>Maya</b>", mail.Html);
        Assert.Contains("&lt;b&gt;Maya&lt;/b&gt;", mail.Html);

        // Plain text is text: nothing to escape, and nothing escaped.
        Assert.Contains("<a href=\"https://evil.example\">Reschedule</a>", mail.Text);
    }

    [Fact]
    public async Task Escapes_the_title_too()
    {
        await _notifier.NotifyAsync(Maya, new NotifyInput(
            NotificationKinds.OrderShipped, "Fish & <chips>", "Body \"quoted\"", "/a"));
        await _outbox.DrainAsync(Ids.Now());

        var html = Assert.Single(_core.Mailer.Sent).Html;
        Assert.Contains("Fish &amp; &lt;chips&gt;", html);
        Assert.Contains("Body &quot;quoted&quot;", html);
    }

    [Fact]
    public async Task A_failed_send_is_retried_with_backoff_then_abandoned()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way"));
        _core.Mailer.FailWith = "Resend is down";

        var now = Ids.Now();
        var first = await _outbox.DrainAsync(now);
        Assert.Equal(1, first.Retried);

        // Not due again until the first backoff has passed.
        Assert.Equal(0, (await _outbox.DrainAsync(now.AddSeconds(30))).Claimed);

        // Walk through every remaining attempt.
        var at = now;
        for (var attempt = 1; attempt < NotificationOutbox.MaxAttempts; attempt++)
        {
            at += NotificationOutbox.Backoff[attempt - 1];
            await _outbox.DrainAsync(at);
        }

        var row = (await OutboxAsync())[0];
        Assert.Equal(OutboxStatuses.Failed, row.Status);
        Assert.Equal(NotificationOutbox.MaxAttempts, row.Attempts);
        Assert.Empty(_core.Mailer.Sent);
    }

    [Fact]
    public async Task A_send_that_recovers_is_delivered_on_the_retry()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way"));
        _core.Mailer.FailWith = "Resend is down";
        var now = Ids.Now();
        await _outbox.DrainAsync(now);

        _core.Mailer.FailWith = null;
        await _outbox.DrainAsync(now + NotificationOutbox.Backoff[0]);

        Assert.Single(_core.Mailer.Sent);
        Assert.Equal(OutboxStatuses.Sent, (await OutboxAsync())[0].Status);
    }

    [Fact]
    public async Task A_row_held_by_a_dead_drain_is_reclaimed_after_its_lease()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way"));

        // Simulate a drain that claimed the row and died before recording it.
        var now = Ids.Now();
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
            await conn.ExecuteAsync(
                """UPDATE notification_outbox SET "lockedAt" = @now, attempts = 1""", new { now });

        Assert.Equal(0, (await _outbox.DrainAsync(now.AddMinutes(1))).Claimed);
        Assert.Equal(1, (await _outbox.DrainAsync(now + NotificationOutbox.Lease + TimeSpan.FromSeconds(1))).Sent);
    }

    [Fact]
    public async Task A_suspended_account_is_not_emailed()
    {
        await _notifier.NotifyAsync(Maya, Notice("On its way"));
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
            await conn.ExecuteAsync("UPDATE users SET status = 'suspended' WHERE id = 'u1'");

        var report = await _outbox.DrainAsync(Ids.Now());

        Assert.Equal(1, report.Skipped);
        Assert.Empty(_core.Mailer.Sent);
    }

    [Fact]
    public async Task A_refused_move_owes_no_email()
    {
        await _core.Get<IBookingService>().UpdateStatusAsync(Maya, "b1", BookingStatuses.Accepted);
        Assert.Empty(await OutboxAsync());
    }

    private static VisitSummaryRequest Summary() => new(
    [
        new MedicalRecordRequest(
            Type: MedicalRecordTypes.VisitNote,
            Title: "Healthy",
            Details: "Booster given.",
            OccurredAt: default,
            AppointmentId: null,
            NextDueAt: null,
            MedicationName: null,
            Dosage: null,
            RefillsLeft: null,
            ExpiresAt: null,
            ProductSlugs: null),
    ]);
}
