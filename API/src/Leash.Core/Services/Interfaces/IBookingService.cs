using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>Which side of a booking somebody is on.</summary>
public enum BookingActor
{
    Owner,
    Caretaker,
}

/// <summary>Why a booking operation was refused.</summary>
public enum BookingFailure
{
    NotFound,

    /// <summary>The caller is neither the owner nor the caretaker. 404.</summary>
    NotParticipant,

    /// <summary>No such caretaker profile. 404.</summary>
    CaretakerNotFound,

    /// <summary>They do not offer that service, or have no rate for it. 409.</summary>
    ServiceNotOffered,

    /// <summary>The window ends at or before it starts. 400.</summary>
    BadDates,

    /// <summary>Too soon — the request does not clear the minimum lead time. 409.</summary>
    LeadTime,

    /// <summary>One of the pets is not the caller's. 403.</summary>
    NotYourPet,

    /// <summary>
    /// The move is not on the transition table at all (REQUIREMENTS.md §11.1).
    /// <b>409</b>, and checked before the actor.
    /// </summary>
    InvalidTransition,

    /// <summary>
    /// A legal move, by the wrong party. <b>403.</b> This is the one that stops
    /// an owner accepting their own booking (REQUIREMENTS.md C8).
    /// </summary>
    WrongActor,
}

/// <summary>
/// Bookings: requesting one, moving it through its lifecycle, and reading it.
///
/// Two rules carry most of the weight here, and they are <b>separate
/// questions</b>:
///
///  1. <b>Is the move legal?</b> The transition table in §11.1.
///  2. <b>Is this person allowed to make it?</b> The actor table.
///
/// Only the second is new relative to the reference implementation, which
/// checked legality alone — so an owner could accept their own request and then
/// mark it completed. That is not cosmetic: <c>completed</c> unlocks the review
/// form, and every status change feeds the caretaker's response rate, so the
/// owner of a booking could manufacture a caretaker's responsiveness score and
/// then review them for it.
/// </summary>
public interface IBookingService
{
    Task<(BookingDto? Booking, BookingFailure? Failure)> GetAsync(
        string callerId, string bookingId, CancellationToken ct = default);

    /// <summary>The caller's own bookings as an owner.</summary>
    Task<BookingPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>
    /// A caretaker's booking queue. The caller must own the caretaker profile;
    /// null when they do not.
    /// </summary>
    Task<BookingPage?> ListForCaretakerAsync(
        string callerId, string caretakerId, string? cursor, int limit,
        CancellationToken ct = default);

    Task<(BookingDto? Booking, BookingFailure? Failure)> CreateAsync(
        string callerId, CreateBookingRequest input, CancellationToken ct = default);

    Task<(BookingDto? Booking, BookingFailure? Failure)> UpdateStatusAsync(
        string callerId, string bookingId, string status, CancellationToken ct = default);
}
