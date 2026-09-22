using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>bookings</c> row.
///
/// <see cref="PriceTotalCents"/> is integer cents and is written <b>only</b> by
/// <see cref="Services.BookingService"/> from the caretaker's rate card. No
/// request body carries a price (REQUIREMENTS.md C5).
/// </summary>
public class BookingEntity
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";

    /// <summary>A <c>caretaker_profiles</c> id, not a user id.</summary>
    public string CaretakerId { get; set; } = "";

    /// <summary>A booking may cover several animals (REQUIREMENTS.md C6).</summary>
    public string[] PetIds { get; set; } = [];

    public string ServiceType { get; set; } = "";
    public DateTimeOffset StartDateTime { get; set; }
    public DateTimeOffset EndDateTime { get; set; }
    public string Notes { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public int PriceTotalCents { get; set; }

    /// <summary>The single division by 100 for a booking's money.</summary>
    public BookingDto ToDto() => new(
        Id, OwnerId, CaretakerId, PetIds, ServiceType, StartDateTime, EndDateTime,
        Notes, Status, PriceTotalCents / 100m, CreatedAt);
}

public class MessageEntity
{
    public string Id { get; set; } = "";
    public string BookingId { get; set; } = "";
    public string FromUserId { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }

    public MessageDto ToDto() => new(Id, BookingId, FromUserId, Body, CreatedAt, ReadAt);
}

/// <summary>
/// The <c>reviews</c> row.
///
/// <c>bookingId</c> holds a booking id or a vet appointment id depending on
/// <see cref="Kind"/>. The column name is historical; the DTO calls it
/// <c>subjectId</c>, which is what it means.
/// </summary>
public class ReviewEntity
{
    public string Id { get; set; } = "";
    public string BookingId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string FromUserId { get; set; } = "";
    public string ToUserId { get; set; } = "";
    public double Rating { get; set; }
    public string Comment { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    public ReviewDto ToDto() => new(
        Id, BookingId, Kind, FromUserId, ToUserId, Rating, Comment, CreatedAt);
}
