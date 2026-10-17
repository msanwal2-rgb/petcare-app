using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// The one gate every notification passes through (REQUIREMENTS.md N1).
///
/// ── Why it is its own interface ──
///
/// Notifications are written by the status machines and never by a client. So
/// this is what <c>BookingService</c>, <c>AppointmentService</c> and
/// <c>OrderLifecycle</c> are handed, and <b>no controller is ever handed it</b> —
/// the same split as <see cref="IOrderLifecycle"/> and
/// <see cref="IOrderService"/>. The caller-scoped reads a controller needs are
/// on <see cref="INotificationService"/>.
/// </summary>
public interface INotifier
{
    /// <summary>
    /// Tell <paramref name="userId"/> something happened: the in-app row, and
    /// one outbox row for each enabled out-of-band channel.
    ///
    /// <b>Pass the announcing transaction as <paramref name="scope"/>.</b> Then
    /// the notification commits if and only if the status change does — no
    /// "accepted" bell for a booking whose acceptance rolled back, and no
    /// acceptance whose bell was lost to a crash between two commits. A
    /// recipient who does not exist yields null without failing the scope.
    ///
    /// Without a scope it runs in its own transaction and never throws: a
    /// failure is logged and answered with null, because a failure to notify
    /// must not fail the thing being notified about.
    /// </summary>
    Task<NotificationDto?> NotifyAsync(
        string userId, NotifyInput input, ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>The caller's own notifications — what the bell reads and clears.</summary>
public interface INotificationService
{
    /// <summary>Newest first, <paramref name="limit"/> to a page (default 30, at most 50).</summary>
    Task<NotificationFeed> ListMineAsync(
        string callerId, string? cursor, int limit = 30, CancellationToken ct = default);

    /// <summary>
    /// Mark exactly <paramref name="ids"/> read (N7) — those of them that are
    /// the caller's. Returns the caller's remaining unread count.
    /// </summary>
    Task<MarkNotificationsReadResult> MarkReadAsync(
        string callerId, IReadOnlyCollection<string> ids, CancellationToken ct = default);
}

/// <summary>
/// Drains <c>notification_outbox</c> (REQUIREMENTS.md N6). Called by the
/// API's hosted service on an interval; the tests call it directly with their
/// own clock.
/// </summary>
public interface INotificationOutbox
{
    Task<OutboxReport> DrainAsync(DateTimeOffset now, int batchSize = 25, CancellationToken ct = default);
}
