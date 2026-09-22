using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class CatalogRepository(NpgsqlDataSource db) : ICatalogRepository
{
    private const string ProductColumns = """
        id AS "Id", slug AS "Slug", name AS "Name", brand AS "Brand",
        description AS "Description", category AS "Category",
        species AS "Species", "lifeStage" AS "LifeStage",
        "sizeLabel" AS "SizeLabel", "weightLbs" AS "WeightLbs",
        "priceCents" AS "PriceCents", "compareAtPriceCents" AS "CompareAtPriceCents",
        "imageUrl" AS "ImageUrl", ingredients AS "Ingredients",
        allergens AS "Allergens", "requiresPrescription" AS "RequiresPrescription",
        "stockQty" AS "StockQty", active AS "Active", rating AS "Rating",
        "reviewCount" AS "ReviewCount", "createdAt" AS "CreatedAt"
        """;

    public async Task<IReadOnlyList<string>> ListBrandsAsync(
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        var brands = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            SELECT DISTINCT brand
            FROM products
            WHERE active = true
            ORDER BY brand ASC
            """,
            transaction: session.Transaction, cancellationToken: ct));

        return brands.ToList();
    }

    public async Task<IReadOnlyList<ProductEntity>> ListRecommendationCandidatesAsync(
        string species, string lifeStage, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // "Featured" order: what is well reviewed, not what is newest. Same
        // ordering the store grid leads with, so a recommendation and a browse
        // do not disagree about which of two products is the better one.
        var rows = await session.Connection.QueryAsync<ProductEntity>(
            new CommandDefinition(
                $"""
                 SELECT {ProductColumns} FROM products
                 WHERE active = true
                   AND "requiresPrescription" = false
                   AND "stockQty" > 0
                   AND @species = ANY(species)
                   AND "lifeStage" && ARRAY[@lifeStage, 'all']::text[]
                 ORDER BY rating DESC, "reviewCount" DESC, id ASC
                 LIMIT @limit
                 """,
                new { species, lifeStage, limit },
                session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }
}
