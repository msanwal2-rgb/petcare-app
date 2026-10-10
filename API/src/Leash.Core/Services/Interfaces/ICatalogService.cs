using Leash.Core.Models.Dtos;
using Leash.Core.Repositories.Interfaces;

namespace Leash.Core.Services.Interfaces;

public interface ICatalogService
{
    /// <summary>Distinct brands across the active catalogue. Powers the store's brand filter.</summary>
    Task<IReadOnlyList<string>> ListBrandsAsync(CancellationToken ct = default);

    /// <summary>
    /// The catalogue grid: filtered, sorted and keyset-paginated in PostgreSQL
    /// (REQUIREMENTS.md S2). Public — browsing the store needs no account.
    /// </summary>
    Task<ProductPage> SearchAsync(ProductSearchFilter filter, CancellationToken ct = default);

    /// <summary>One product page. Withdrawn products still resolve, for old orders' links.</summary>
    Task<ProductDto?> GetBySlugAsync(string slug, CancellationToken ct = default);

    /// <summary>
    /// Products suited to one particular pet. Owner-only — the answer is derived
    /// from the animal's allergy list. Null when the caller does not own it.
    /// </summary>
    Task<IReadOnlyList<ProductDto>?> RecommendForPetAsync(
        string callerId, string petId, CancellationToken ct = default);
}
