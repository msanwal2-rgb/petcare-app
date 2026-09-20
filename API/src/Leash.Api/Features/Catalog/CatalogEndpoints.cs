using Dapper;
using Npgsql;

namespace Leash.Api.Features.Catalog;

/// <summary>
/// Store catalogue facets.
///
/// <c>/brands</c> is its own resource rather than <c>/products/brands</c>
/// deliberately — the latter shares a path segment with the
/// <c>/products/{slug}</c> detail route, so a product slugged "brands" would
/// become unreachable. A facet is not a product.
/// </summary>
public static class CatalogEndpoints
{
    public static RouteGroupBuilder MapCatalog(this RouteGroupBuilder group)
    {
        // GET /api/v1/brands -> string[]
        // Powers the catalogue's brand filter. Public: no auth, no pet, no money.
        group.MapGet("/brands", async (NpgsqlDataSource db, CancellationToken ct) =>
        {
            await using var conn = await db.OpenConnectionAsync(ct);

            var brands = await conn.QueryAsync<string>(new CommandDefinition(
                """
                SELECT DISTINCT brand
                FROM products
                WHERE active = true
                ORDER BY brand ASC
                """,
                cancellationToken: ct));

            return Results.Ok(brands);
        })
        .WithName("ListBrands")
        .WithSummary("Distinct brands across the active catalogue.");

        return group;
    }
}
