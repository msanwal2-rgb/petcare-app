using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

public sealed class CatalogService(ICatalogRepository catalog) : ICatalogService
{
    public Task<IReadOnlyList<string>> ListBrandsAsync(CancellationToken ct = default)
        => catalog.ListBrandsAsync(ct: ct);
}
