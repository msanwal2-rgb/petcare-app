using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>products</c> row. M3 reads it for per-pet recommendations; M6 owns
/// search, filtering and the money rules.
/// </summary>
public class ProductEntity
{
    public string Id { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string[] Species { get; set; } = [];
    public string[] LifeStage { get; set; } = [];
    public string SizeLabel { get; set; } = "";
    public double WeightLbs { get; set; }
    public int PriceCents { get; set; }
    public int? CompareAtPriceCents { get; set; }
    public string ImageUrl { get; set; } = "";
    public string[] Ingredients { get; set; } = [];
    public string[] Allergens { get; set; } = [];
    public bool RequiresPrescription { get; set; }
    public int StockQty { get; set; }
    public bool Active { get; set; }
    public double Rating { get; set; }
    public int ReviewCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public ProductDto ToDto() => new(
        Id, Slug, Name, Brand, Description, Category, Species, LifeStage,
        SizeLabel, WeightLbs, PriceCents, CompareAtPriceCents, ImageUrl,
        Ingredients, Allergens, RequiresPrescription, StockQty, Active,
        Rating, ReviewCount, CreatedAt);
}

/// <summary>
/// The <c>vet_appointments</c> row, read-only in M3 for a pet's visit history.
/// M5 owns creation, the status machine and the actor rules.
/// </summary>
public class VetAppointmentEntity
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public string VetId { get; set; } = "";
    public string PetId { get; set; } = "";
    public string Mode { get; set; } = "";
    public string Reason { get; set; } = "";
    public string[] Symptoms { get; set; } = [];
    public DateTimeOffset StartDateTime { get; set; }
    public DateTimeOffset EndDateTime { get; set; }
    public string Status { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public int FeeCents { get; set; }

    /// <summary>
    /// The visit as <paramref name="viewerId"/> is entitled to see it: with the
    /// fee if they booked it, without it otherwise. The single division by 100
    /// for this DTO lives here.
    /// </summary>
    public AppointmentTimelineDto ToDto(string viewerId) => new(
        Id, OwnerId, VetId, PetId, Mode, Reason, Symptoms,
        StartDateTime, EndDateTime, Status, Notes, CreatedAt)
    {
        Fee = OwnerId == viewerId ? FeeCents / 100m : null,
    };
}
