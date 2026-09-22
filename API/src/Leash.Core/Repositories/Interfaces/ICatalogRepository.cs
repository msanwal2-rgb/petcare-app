using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Store catalogue reads. M1 carried only what the M0 proof slice needed; M3
/// adds the per-pet recommendation query. Search, filtering, sorting and
/// pagination arrive with M6.
/// </summary>
public interface ICatalogRepository
{
    Task<IReadOnlyList<string>> ListBrandsAsync(
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Candidate products for a pet: active, in stock, not prescription-only,
    /// right species, and matching either its life stage or the catalogue's
    /// <c>all</c> bucket.
    ///
    /// Deliberately <b>over-fetches</b>. The allergen match cannot run in this
    /// query — see <see cref="Services.CatalogService.HasAllergen"/> for why it
    /// is a loose substring comparison rather than an equality one — so it runs
    /// in the service over these rows, and asking for exactly <c>limit</c> here
    /// would return fewer than <c>limit</c> after filtering.
    /// </summary>
    Task<IReadOnlyList<ProductEntity>> ListRecommendationCandidatesAsync(
        string species, string lifeStage, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
