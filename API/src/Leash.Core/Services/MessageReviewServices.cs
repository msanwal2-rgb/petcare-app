using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Booking-scoped messaging, between the two parties and nobody else
/// (REQUIREMENTS.md C9).
/// </summary>
public sealed class MessageService(
    IMessageRepository messages,
    IAccessService access,
    IUnitOfWork unitOfWork) : IMessageService
{
    public async Task<IReadOnlyList<MessageDto>?> ListAsync(
        string callerId, string bookingId, CancellationToken ct = default)
    {
        if (!await access.IsBookingParticipantAsync(callerId, bookingId, ct: ct)) return null;

        var rows = await messages.ListForBookingAsync(bookingId, ct: ct);
        return [.. rows.Select(m => m.ToDto())];
    }

    public async Task<MessageDto?> SendAsync(
        string callerId, string bookingId, string body, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        if (!await access.IsBookingParticipantAsync(callerId, bookingId, scope, ct))
            return null;

        var created = await messages.CreateAsync(new MessageEntity
        {
            Id = Ids.New("m"),
            BookingId = bookingId,
            FromUserId = callerId,
            Body = body,
            CreatedAt = Ids.Now(),
            ReadAt = null,
        }, scope, ct);

        await scope.CommitAsync(ct);
        return created.ToDto();
    }

    /// <summary>
    /// Mark the other party's messages read.
    ///
    /// <b>Its own endpoint, reached by POST</b> (REQUIREMENTS.md C10). The
    /// reference implementation did this inside the <c>GET</c> that returns the
    /// thread, which made an unread inbound message literally unreturnable: the
    /// read marked it, then serialised it as read, so no caller could ever
    /// observe one and no unread badge could ever be correct.
    ///
    /// Returns the number of messages that moved, or null when the caller is not
    /// a participant.
    /// </summary>
    public async Task<int?> MarkReadAsync(
        string callerId, string bookingId, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        if (!await access.IsBookingParticipantAsync(callerId, bookingId, scope, ct))
            return null;

        var moved = await messages.MarkReadAsync(bookingId, callerId, Ids.Now(), scope, ct);

        await scope.CommitAsync(ct);
        return moved;
    }
}

/// <summary>
/// Reviews. See <see cref="IReviewService"/>; the rule worth reading is in
/// <see cref="CreateAsync"/>.
/// </summary>
public sealed class ReviewService(
    IReviewRepository reviews,
    IBookingRepository bookings,
    ICaretakerRepository caretakers,
    IReputationService reputation,
    IUnitOfWork unitOfWork) : IReviewService
{
    public async Task<IReadOnlyList<ReviewDto>> ListForSubjectAsync(
        string subjectId, CancellationToken ct = default)
    {
        var rows = await reviews.ListForSubjectAsync(subjectId, ct: ct);
        return [.. rows.Select(r => r.ToDto())];
    }

    public async Task<IReadOnlyList<ReviewDto>> ListForUserAsync(
        string userId, string? kind, CancellationToken ct = default)
    {
        var rows = await reviews.ListForUserAsync(userId, kind, ct: ct);
        return [.. rows.Select(r => r.ToDto())];
    }

    /// <summary>
    /// Post a review of a booking.
    ///
    /// <b>Everything is re-derived from the subject rather than trusted from the
    /// request:</b> who took part, whether it finished, and who the review may
    /// be about. Before the reference project fixed this, any signed-in user
    /// could post unlimited reviews about anyone, for a booking they had nothing
    /// to do with and that had never happened.
    ///
    /// A booking is reviewable <b>both ways</b> once completed — the owner
    /// judges the caretaker and the caretaker judges the owner — and once only
    /// per direction (REQUIREMENTS.md C11). A review you can rewrite after the
    /// fact is a negotiating position, not a review.
    /// </summary>
    public async Task<(ReviewDto? Review, ReviewFailure? Failure)> CreateAsync(
        string callerId, string bookingId, CreateReviewRequest input,
        CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var booking = await bookings.GetByIdAsync(bookingId, scope, ct);
        if (booking is null) return (null, ReviewFailure.NotFound);

        // Only a booking that actually happened. `completed` is set by the
        // caretaker alone, which is what stops an owner manufacturing a
        // reviewable history for themselves.
        if (booking.Status != BookingStatuses.Completed)
            return (null, ReviewFailure.NotCompleted);

        var caretaker = await caretakers.GetByIdAsync(booking.CaretakerId, scope, ct);
        if (caretaker is null) return (null, ReviewFailure.NotFound);

        // The two directions this booking permits, derived from the booking.
        var permitted = new (string From, string To)[]
        {
            (booking.OwnerId, caretaker.UserId),
            (caretaker.UserId, booking.OwnerId),
        };

        var asAuthor = permitted.Where(p => p.From == callerId).ToArray();
        if (asAuthor.Length == 0) return (null, ReviewFailure.NotParticipant);

        if (!asAuthor.Any(p => p.To == input.ToUserId))
            return (null, ReviewFailure.WrongRecipient);

        var existing = await reviews.FindByAuthorAsync(bookingId, callerId, scope, ct);
        if (existing is not null) return (null, ReviewFailure.AlreadyReviewed);

        var created = await reviews.CreateAsync(new ReviewEntity
        {
            Id = Ids.New("r"),
            BookingId = bookingId,
            Kind = ReviewKinds.Booking,
            FromUserId = callerId,
            ToUserId = input.ToUserId,
            Rating = input.Rating,
            Comment = input.Comment ?? "",
            CreatedAt = Ids.Now(),
        }, scope, ct);

        // A no-op when the recipient is the owner — they have no caretaker
        // profile to score, which is correct rather than an error.
        await reputation.ApplyCaretakerRatingAsync(input.ToUserId, input.Rating, scope, ct);

        await scope.CommitAsync(ct);
        return (created.ToDto(), null);
    }
}
