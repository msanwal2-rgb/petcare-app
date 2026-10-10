
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
