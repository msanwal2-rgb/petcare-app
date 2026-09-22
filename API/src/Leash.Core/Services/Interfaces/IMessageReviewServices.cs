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
}

public interface IReviewService
{
    /// <summary>Both directions of one booking, or the one review of one visit.</summary>
    Task<IReadOnlyList<ReviewDto>> ListForSubjectAsync(
        string subjectId, CancellationToken ct = default);

    /// <summary>
    /// Reviews about a user, optionally narrowed to <c>booking</c> or
    /// <c>vet_appointment</c>. Public — a reputation nobody can read is not one.
    /// </summary>
    Task<IReadOnlyList<ReviewDto>> ListForUserAsync(
        string userId, string? kind, CancellationToken ct = default);

    Task<(ReviewDto? Review, ReviewFailure? Failure)> CreateAsync(
        string callerId, string bookingId, CreateReviewRequest input,
        CancellationToken ct = default);
}
