using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// Booking-scoped messaging. Every method answers null when the caller is not
/// one of the two parties, which the controller turns into 404.
/// </summary>
public interface IMessageService
{
    Task<IReadOnlyList<MessageDto>?> ListAsync(
        string callerId, string bookingId, CancellationToken ct = default);

    Task<MessageDto?> SendAsync(
        string callerId, string bookingId, string body, CancellationToken ct = default);

    /// <summary>
    /// Mark the other party's messages read. An explicit action, never a
    /// side effect of reading the thread — REQUIREMENTS.md C10.
    /// </summary>
    Task<int?> MarkReadAsync(
        string callerId, string bookingId, CancellationToken ct = default);
}

/// <summary>Why a review was refused.</summary>
public enum ReviewFailure
{
    NotFound,

    /// <summary>The booking has not been completed, so there is nothing to review. 409.</summary>
    NotCompleted,

    /// <summary>The caller had nothing to do with it. 403.</summary>
    NotParticipant,

    /// <summary>Aimed at somebody outside the booking. 403.</summary>
    WrongRecipient,

    /// <summary>One per person per booking. 409.</summary>
    AlreadyReviewed,

    /// <summary>
    /// A vet appointment reviewed in the wrong direction — a clinician rating
    /// the client. <b>403, and it is not an oversight.</b> A booking is
    /// reviewed both ways because both parties took a risk on each other; a
    /// consultation is not, because a patient record that carries the
    /// clinician's opinion of the patient's owner is a different and much worse
    /// product. This is why <c>Review.kind</c> exists.
    /// </summary>
    OneDirectionOnly,
}

public interface IReviewService
{
    /// <summary>
    /// Both directions of one booking, or the one review of one visit.
    ///
    /// <paramref name="kind"/> is required rather than inferred. The column
    /// holding the subject is named <c>"bookingId"</c> and holds either sort of
    /// id, so a query without it is asking "reviews of the thing with this id",
    /// which is a question with two possible meanings — REQUIREMENTS.md §12
    /// lists the reference implementation's version of this as a defect.
    /// </summary>
    Task<IReadOnlyList<ReviewDto>> ListForSubjectAsync(
        string subjectId, string kind, CancellationToken ct = default);

    /// <summary>
    /// Reviews about a user, optionally narrowed to <c>booking</c> or
    /// <c>vet_appointment</c>. Public — a reputation nobody can read is not one.
    /// </summary>
    Task<IReadOnlyList<ReviewDto>> ListForUserAsync(
        string userId, string? kind, CancellationToken ct = default);

    /// <summary>
    /// Review a completed booking. Either party, about the other, once each.
    /// </summary>
    Task<(ReviewDto? Review, ReviewFailure? Failure)> CreateAsync(
        string callerId, string bookingId, CreateReviewRequest input,
        CancellationToken ct = default);

    /// <summary>
    /// Review a completed vet appointment. <b>One direction only</b>
    /// (REQUIREMENTS.md V10): the owner reviews the vet, and the vet has no
    /// counterpart to post.
    /// </summary>
    Task<(ReviewDto? Review, ReviewFailure? Failure)> CreateForAppointmentAsync(
        string callerId, string appointmentId, CreateReviewRequest input,
        CancellationToken ct = default);
}
