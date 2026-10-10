using Leash.Api.Http;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// The store catalogue. Public: browsing the shelves needs no account, no pet
/// and no money.
///
/// <c>/brands</c> is its own resource rather than <c>/products/brands</c>
/// deliberately — the latter shares a path segment with the
/// <c>/products/{slug}</c> detail route, so a product slugged "brands" would
/// become unreachable. A facet is not a product.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class CatalogController(ICatalogService catalog) : ControllerBase
{
    [HttpGet("brands")]
    public async Task<IActionResult> ListBrands(CancellationToken ct)
        => Ok(await catalog.ListBrandsAsync(ct));

    /// <summary>
    /// Search, executed in PostgreSQL and returned one page at a time
    /// (REQUIREMENTS.md S2). <c>cursor</c> is opaque; it encodes the sort it was
    /// minted under, so one carried across a change of sort starts again rather
    /// than landing somewhere meaningless.
    ///
    /// An unrecognised <c>sort</c> falls back to "featured" rather than
    /// answering 400 — a stale bookmark should still show products.
    /// </summary>
    [HttpGet("products")]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] string? category,
        [FromQuery] string? species,
        [FromQuery] string? lifeStage,
        [FromQuery] string? brand,
        [FromQuery] int? minPriceCents,
        [FromQuery] int? maxPriceCents,
        [FromQuery] string? sort,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
        => Ok(await catalog.SearchAsync(
            new ProductSearchFilter(
                q, category, species, lifeStage, brand, minPriceCents, maxPriceCents,
                sort ?? "featured", cursor, limit ?? 24),
            ct));

    [HttpGet("products/{slug}")]
    public async Task<IActionResult> GetBySlug(string slug, CancellationToken ct)
    {
        var product = await catalog.GetBySlugAsync(slug, ct);
        return product is null ? ApiResults.NotFound($"Product {slug} not found") : Ok(product);
    }
}
