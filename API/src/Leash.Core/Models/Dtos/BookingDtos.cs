namespace Leash.Core.Models.Dtos;

/// <summary>
/// One booking. <see cref="PriceTotal"/> is USD, because the existing contract
/// makes it so — the column is integer cents and the division happens once, in
/// <see cref="Entities.BookingEntity.ToDto"/>.
/// </summary>
public sealed record BookingDto(
    string Id,
    string OwnerId,
    string CaretakerId,
    string[] PetIds,
    string ServiceType,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string Notes,
    string Status,
    decimal PriceTotal,
    DateTimeOffset CreatedAt)
{
    /// <summary>
    /// How to reach a guest owner (STATUS §3-G), on the caretaker's single
    /// read only, and only while the owner has no account — a guest cannot
    /// read messages. Absent from the JSON otherwise.
    /// </summary>
    [System.Text.Json.Serialization.JsonIgnore(
        Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public GuestContactDto? GuestContact { get; init; }
}

/// <summary>A guest owner's name, email and phone, for the caretaker or clinic they booked.</summary>
public sealed record GuestContactDto(string Name, string Email, string Phone);

/// <summary>
/// A booking request.
///
/// <b>There is no price on it, and there is no owner on it.</b> The owner comes
/// from the authenticated caller; the price is computed server-side from the
/// caretaker's own rate card and the requested duration (REQUIREMENTS.md C5).
/// The running total the booking form shows is an estimate for the customer,
/// not an input — if the two ever disagree, the rate card is right.
/// </summary>
public sealed record CreateBookingRequest(
    string CaretakerId,
    string[] PetIds,
    string ServiceType,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string? Notes,

    // The browser's offset from UTC in minutes (UTC−6 is −360), so the
    // caretaker's published local hours can be read against these instants
    // (STATUS §3-G). Absent means UTC.
    int? UtcOffsetMinutes = null);

/// <summary>A status move. The actor is derived from the caller, never sent.</summary>
public sealed record UpdateBookingStatusRequest(string Status);

/// <summary>One message in a booking's thread.</summary>
public sealed record MessageDto(
    string Id,
    string BookingId,
    string FromUserId,
    string Body,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ReadAt);

public sealed record CreateMessageRequest(string Body);

/// <summary>
/// A review.
///
/// <see cref="SubjectId"/> on the wire, <c>bookingId</c> in the column. The
/// column name is historical — it holds a booking id or an appointment id
/// depending on <see cref="Kind"/> — and the DTO says what it actually means.
/// </summary>
public sealed record ReviewDto(
    string Id,
    string SubjectId,
    string Kind,
    string FromUserId,
    string ToUserId,
    double Rating,
    string Comment,
    DateTimeOffset CreatedAt);

/// <summary>
/// A new review.
///
/// No <c>fromUserId</c>: the author is the caller. <see cref="ToUserId"/> is
/// still sent and still checked against the subject, because a booking has two
/// valid recipients and the client has to say which direction it means.
/// </summary>
public sealed record CreateReviewRequest(
    string ToUserId, double Rating, string? Comment);

/// <summary>A page of bookings plus the cursor for the next one.</summary>
public sealed record BookingPage(BookingDto[] Items, string? NextCursor);
