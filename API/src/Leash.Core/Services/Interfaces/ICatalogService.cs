using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

public interface ICatalogService
{
    /// <summary>Distinct brands across the active catalogue. Powers the store's brand filter.</summary>
    Task<IReadOnlyList<string>> ListBrandsAsync(CancellationToken ct = default);

    /// <summary>
    /// Products suited to one particular pet. Owner-only — the answer is derived
    /// from the animal's allergy list. Null when the caller does not own it.
    /// </summary>
    Task<IReadOnlyList<ProductDto>?> RecommendForPetAsync(
        string callerId, string petId, CancellationToken ct = default);
}
