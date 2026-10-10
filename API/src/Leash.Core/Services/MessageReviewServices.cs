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
    IAppointmentRepository appointments,
    IVetRepository vets,
    IReputationService reputation,
    IUnitOfWork unitOfWork) : IReviewService
{
    public async Task<IReadOnlyList<ReviewDto>> ListForSubjectAsync(
        string subjectId, string kind, CancellationToken ct = default)
    {
        var rows = await reviews.ListForSubjectAsync(subjectId, kind, ct: ct);
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

        var existing = await reviews.FindByAuthorAsync(
            bookingId, ReviewKinds.Booking, callerId, scope, ct);

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

    /// <summary>
    /// Post a review of a vet appointment.
    ///
    /// Everything is re-derived from the appointment rather than trusted from
    /// the request, exactly as above — and then one thing is different.
    ///
    /// ── One direction, and it is a product decision ──
    ///
    /// The owner reviews the vet. The vet has no counterpart to post, and a
    /// clinician who tries gets <see cref="ReviewFailure.OneDirectionOnly"/>
    /// rather than a missing feature. A booking is reviewed both ways because
    /// two strangers each took a risk on the other; a consultation is not,
    /// because a rating of the client attached to their animal's record is a
    /// different and much worse product — and once it exists it is read by
    /// whoever treats the animal next.
    ///
    /// This is the whole reason <c>Review.kind</c> exists. One table serves
    /// both, the column that holds the subject is named <c>"bookingId"</c> for
    /// historical reasons, and <c>kind</c> is what keeps a clinic's reviews and
    /// a sitter's from ever being mistaken for each other — including when one
    /// person is both.
    /// </summary>
    public async Task<(ReviewDto? Review, ReviewFailure? Failure)> CreateForAppointmentAsync(
        string callerId, string appointmentId, CreateReviewRequest input,
        CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var appointment = await appointments.GetByIdAsync(appointmentId, scope, ct);
        if (appointment is null) return (null, ReviewFailure.NotFound);

        // Only a visit that actually happened. `completed` is set by the vet
        // alone, which is what stops an owner manufacturing a reviewable history.
        if (appointment.Status != AppointmentStatuses.Completed)
            return (null, ReviewFailure.NotCompleted);

        var vet = await vets.GetByIdAsync(appointment.VetId, scope, ct);
        if (vet is null) return (null, ReviewFailure.NotFound);

        // The vet is told "one direction only" rather than "not a participant",
        // because they *are* one — they are simply not the one who may write.
        if (callerId == vet.UserId) return (null, ReviewFailure.OneDirectionOnly);

        if (callerId != appointment.OwnerId) return (null, ReviewFailure.NotParticipant);

        // The owner may review the vet, and nobody else. There is no second
        // permitted pair to search, which is what "one-directional" means here.
        if (input.ToUserId != vet.UserId) return (null, ReviewFailure.WrongRecipient);

        var existing = await reviews.FindByAuthorAsync(
            appointmentId, ReviewKinds.VetAppointment, callerId, scope, ct);

        if (existing is not null) return (null, ReviewFailure.AlreadyReviewed);

        var created = await reviews.CreateAsync(new ReviewEntity
        {
            Id = Ids.New("r"),

            // The column is named for bookings and holds either subject. The
            // DTO calls it `subjectId`, which is what it actually means.
            BookingId = appointmentId,
            Kind = ReviewKinds.VetAppointment,
            FromUserId = callerId,
            ToUserId = input.ToUserId,
            Rating = input.Rating,
            Comment = input.Comment ?? "",
            CreatedAt = Ids.Now(),
        }, scope, ct);

        await reputation.ApplyVetRatingAsync(input.ToUserId, input.Rating, scope, ct);

        await scope.CommitAsync(ct);
        return (created.ToDto(), null);
    }
}
