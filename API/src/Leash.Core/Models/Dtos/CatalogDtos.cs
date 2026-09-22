using System.Text.Json.Serialization;

namespace Leash.Core.Models.Dtos;

/// <summary>
/// A catalogue product.
///
/// <see cref="PriceCents"/> and <see cref="CompareAtPriceCents"/> stay in
/// integer cents on the wire, which is what the existing contract does for
/// products — unlike <c>Booking.priceTotal</c> and <c>VetAppointment.fee</c>,
/// which are USD decimals. ARCHITECTURE.md section 5: the API emits decimals
/// only where the contract already did, and divides by 100 in exactly one place.
/// </summary>
public sealed record ProductDto(
    string Id,
    string Slug,
    string Name,
    string Brand,
    string Description,
    string Category,
    string[] Species,
    string[] LifeStage,
    string SizeLabel,
    double WeightLbs,
    int PriceCents,
    int? CompareAtPriceCents,
    string ImageUrl,
    string[] Ingredients,
    string[] Allergens,
    bool RequiresPrescription,
    int StockQty,
    bool Active,
    double Rating,
    int ReviewCount,
    DateTimeOffset CreatedAt);

/// <summary>
/// A visit on a pet's timeline.
///
/// One type for two audiences. The person who booked the visit sees what it
/// cost; everyone else — a treating vet, a caretaker, an adopter reading the
/// history their animal arrived with — gets the same record with
/// <see cref="Fee"/> <b>absent from the JSON entirely</b>, not null. The
/// clinical content is the point; the fee belonged to whoever paid it, and a
/// shelter's discounted invoice is not the adopter's business.
///
/// The reference implementation modelled this as two TypeScript types
/// (<c>VetAppointment</c> and <c>ClinicalAppointment = Omit&lt;…, "fee"&gt;</c>).
/// One record with a conditionally-written property produces the same two wire
/// shapes without a second mapping that could drift.
/// </summary>
public sealed record AppointmentTimelineDto(
    string Id,
    string OwnerId,
    string VetId,
    string PetId,
    string Mode,
    string Reason,
    string[] Symptoms,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string Status,
    string Notes,
    DateTimeOffset CreatedAt)
{
    /// <summary>
    /// USD, and only for the booker. <c>WhenWritingNull</c> is what turns this
    /// into the "clinical" shape for everybody else.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public decimal? Fee { get; init; }
}
