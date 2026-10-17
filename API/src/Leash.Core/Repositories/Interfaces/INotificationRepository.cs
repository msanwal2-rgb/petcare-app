using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>Notifications and their outbox.</summary>
public interface INotificationRepository
{
    /// <summary>
    /// Insert a notification, or nothing when the recipient does not exist.
    ///
    /// The existence check is part of the statement (<c>INSERT … SELECT …
    /// WHERE EXISTS</c>) rather than left to the foreign key, so a missing user
    /// is a null result and not an error — which matters inside a caller's
    /// transaction, where an error would abort everything the caller wrote.
    /// </summary>
    Task<NotificationEntity?> InsertAsync(
        NotificationEntity notification, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>One pending outbox row per channel for the notification.</summary>
    Task EnqueueAsync(
        string notificationId, IReadOnlyCollection<string> channels, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The caller's notifications, newest first, keyset-paged on
    /// <c>(createdAt, seq)</c>. Reads <paramref name="limit"/> + 1 rows so the
    /// caller can tell whether there is another page.
    /// </summary>
    Task<IReadOnlyList<NotificationEntity>> ListForUserAsync(
        string userId, DateTimeOffset? beforeAt, long? beforeSeq, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<int> CountUnreadAsync(string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Stamp <c>readAt</c> on those of <paramref name="ids"/> that belong to
    /// <paramref name="userId"/> and are still unread. Somebody else's id
    /// matches nothing. Returns how many changed.
    /// </summary>
    Task<int> MarkReadAsync(
        string userId, IReadOnlyCollection<string> ids, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);

    // ── Outbox ───────────────────────────────────────────────────────────

    /// <summary>
    /// Claim up to <paramref name="limit"/> due deliveries: pending, past their
    /// <c>nextAttemptAt</c>, and either unlocked or holding a lease older than
    /// <paramref name="leaseExpiredBefore"/>. Claiming stamps <c>lockedAt</c>
    /// and counts the attempt. <c>FOR UPDATE SKIP LOCKED</c>, so two drains
    /// running at once take disjoint rows.
    /// </summary>
    Task<IReadOnlyList<OutboxDeliveryEntity>> ClaimDueAsync(
        DateTimeOffset now, DateTimeOffset leaseExpiredBefore, int limit, CancellationToken ct = default);

    /// <summary>
    /// Record the outcome of a delivery. Conditional on the lease still being
    /// the one this drain took (<paramref name="lockedAt"/>), so a drain that
    /// stalled past its lease cannot overwrite the outcome of the drain that
    /// reclaimed the row. Returns false when the lease had been lost.
    /// </summary>
    Task<bool> CompleteAsync(
        string id, DateTimeOffset lockedAt, string status, DateTimeOffset? sentAt, string? error,
        CancellationToken ct = default);

    /// <summary>Release the lease and schedule another attempt. Conditional on the lease, as above.</summary>
    Task<bool> RescheduleAsync(
        string id, DateTimeOffset lockedAt, DateTimeOffset nextAttemptAt, string error,
        CancellationToken ct = default);
}
