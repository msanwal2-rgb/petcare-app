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
