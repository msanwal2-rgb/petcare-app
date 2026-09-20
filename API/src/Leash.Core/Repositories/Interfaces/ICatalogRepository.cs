using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Store catalogue facets. M1 carries only what the M0 proof slice needs; the
/// products, search and filtering arrive with M6.
/// </summary>
public interface ICatalogRepository
{
    Task<IReadOnlyList<string>> ListBrandsAsync(
        ITransactionScope? scope = null, CancellationToken ct = default);
}
