using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>Booking-scoped messages between the owner and the caretaker.</summary>
public interface IMessageRepository
{
    Task<IReadOnlyList<MessageEntity>> ListForBookingAsync(
        string bookingId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<MessageEntity> CreateAsync(
        MessageEntity message, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Stamp everything the reader did <b>not</b> send as read. Returns how many
    /// rows moved.
    ///
    /// This is reached only from an explicit <c>POST …/messages/read</c>
    /// (REQUIREMENTS.md C10). The reference implementation did it inside the
    /// <c>GET</c> that returns the thread, which made an unread inbound message
    /// literally unreturnable: the read marked it, then serialised it as read,
    /// so no caller could ever observe one.
    /// </summary>
    Task<int> MarkReadAsync(
        string bookingId, string readerId, DateTimeOffset readAt,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// <c>reviews</c>, shared by caretaker bookings and vet appointments.
///
/// <c>bookingId</c> holds whichever subject the review is about and <c>kind</c>
/// says which, so a vet's reviews and a caretaker's can never be confused even
/// when one person is both.
/// </summary>
public interface IReviewRepository
{
    /// <summary>
    /// The reviews of one subject. <paramref name="kind"/> is <b>not</b>
    /// optional: <c>"bookingId"</c> holds either sort of id, so a lookup
    /// without it is the defect REQUIREMENTS.md §12 records. Booking ids and
    /// appointment ids happen to be drawn from disjoint prefixes today, which
    /// makes this belt-and-braces — and is exactly the kind of accident that
    /// stops being true when somebody changes an id scheme.
    /// </summary>
    Task<IReadOnlyList<ReviewEntity>> ListForSubjectAsync(
        string subjectId, string kind,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Reviews <b>about</b> a user, optionally narrowed to one kind.</summary>
    Task<IReadOnlyList<ReviewEntity>> ListForUserAsync(
        string userId, string? kind,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// This author's existing review of this subject, if any. One per person per
    /// subject (REQUIREMENTS.md C11) — a review you can rewrite after the fact
    /// is a negotiating position, not a review.
    /// </summary>
    Task<ReviewEntity?> FindByAuthorAsync(
        string subjectId, string kind, string fromUserId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<ReviewEntity> CreateAsync(
        ReviewEntity review, ITransactionScope? scope = null, CancellationToken ct = default);
}
