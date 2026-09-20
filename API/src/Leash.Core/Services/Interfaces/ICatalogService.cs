namespace Leash.Core.Services.Interfaces;

public interface ICatalogService
{
    /// <summary>Distinct brands across the active catalogue. Powers the store's brand filter.</summary>
    Task<IReadOnlyList<string>> ListBrandsAsync(CancellationToken ct = default);
}
