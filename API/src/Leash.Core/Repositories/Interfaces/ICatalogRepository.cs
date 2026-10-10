using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// What a catalogue search asks for (REQUIREMENTS.md S2). Every field optional;
/// prices are integer cents, as the store's contract has always been.
/// </summary>
public sealed record ProductSearchFilter(
    string? Q = null,
    string? Category = null,
    string? Species = null,
    string? LifeStage = null,
    string? Brand = null,
    int? MinPriceCents = null,
    int? MaxPriceCents = null,
    string Sort = "featured",
    string? Cursor = null,
    int Limit = 24);

/// <summary>
/// <c>products</c>: the catalogue, and its stock.
///
/// M1 carried what the proof slice needed and M3 the per-pet recommendations.
/// M6 adds search with keyset pagination, the reads a quote needs, and the two
/// stock writes — which are here rather than on an order repository because
/// stock is a property of the product, and both a sale and a cancellation have
/// to agree on how it moves.
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

    /// <summary>
    /// Search, filtered, sorted and paginated in one statement. Active products
    /// only — a withdrawn product is reachable by slug for an old order's link,
    /// but it is not for sale and not in the grid.
    /// </summary>
    Task<(IReadOnlyList<ProductEntity> Rows, string? NextCursor)> SearchAsync(
        ProductSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>By slug, active or not — the product page has to render for an old order's link.</summary>
    Task<ProductEntity?> GetBySlugAsync(
        string slug, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Every product named, in no particular order. Missing ids are simply absent.</summary>
    Task<IReadOnlyList<ProductEntity>> GetByIdsAsync(
        IReadOnlyCollection<string> ids,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Take <paramref name="quantity"/> units, <b>only if there are that many</b>.
    /// Returns false when there are not, having changed nothing.
    ///
    /// This is the oversell guard (REQUIREMENTS.md S12), and it is one statement
    /// on purpose: <c>UPDATE … SET stock = stock - q WHERE stock &gt;= q</c>.
    /// Two checkouts racing for the last unit both reach it; PostgreSQL makes
    /// the second wait on the first's row lock and then re-evaluates the
    /// <c>WHERE</c> against the committed value, so exactly one matches. A
    /// read-then-write in two statements would let both pass the read.
    /// </summary>
    Task<bool> TryTakeStockAsync(
        string productId, int quantity,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Put units back — a cancelled checkout, or goods that physically came back.</summary>
    Task ReturnStockAsync(
        string productId, int quantity,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
