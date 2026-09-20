using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Store catalogue facets.
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
    /// <summary>
    /// Distinct brands across the active catalogue. Public: no auth, no pet, no
    /// money.
    /// </summary>
    [HttpGet("brands")]
    public async Task<IActionResult> ListBrands(CancellationToken ct)
        => Ok(await catalog.ListBrandsAsync(ct));
}
