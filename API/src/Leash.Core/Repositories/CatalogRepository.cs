using System.Globalization;
using System.Text;
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

    /// <summary>
    /// Search, filtered, sorted and keyset-paginated in one statement.
    ///
    /// ── The keysets ──
    ///
    /// Every sort ends in <c>id</c>, which is what makes it total — two
    /// products at the same price still have a strict order, so none can be
    /// skipped or repeated across a page boundary. "Featured" and "rating" are
    /// the same ordering in the reference (rating, then review count) and so
    /// share a key here; a separate "rating" that sorted on rating alone would
    /// put a 5.0 with one review above a 4.9 with four hundred.
    ///
    /// The cursor carries the sort name as its first part. One minted under
    /// "price ascending" and replayed under "newest" is the wrong shape for that
    /// keyset, and decodes as "start again" rather than as a nonsense position.
    ///
    /// ── The text search ──
    ///
    /// <c>ILIKE</c> over name, brand and description, with <c>%</c>,
    /// <c>_</c> and the escape character itself escaped — otherwise a search
    /// for "100%" matches everything and a search for "a_b" matches "axb". At
    /// twenty-five products this is a sequential scan and fine; at twenty-five
    /// thousand it wants a <c>pg_trgm</c> index, which is a schema change and
    /// not this milestone's.
    /// </summary>
    public async Task<(IReadOnlyList<ProductEntity> Rows, string? NextCursor)> SearchAsync(
        ProductSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var limit = Math.Clamp(filter.Limit, 1, 100);
        var sort = Models.Enums.ProductSorts.IsValid(filter.Sort)
            ? filter.Sort
            : Models.Enums.ProductSorts.Featured;

        var where = new StringBuilder("WHERE active = true");

        if (filter.Category is not null) where.Append(" AND category = @category");
        if (filter.Brand is not null) where.Append(" AND brand = @brand");
        if (filter.Species is not null) where.Append(" AND @species = ANY(species)");

        // "all" on a product means it suits every stage, so it always matches.
        if (filter.LifeStage is not null)
            where.Append(""" AND "lifeStage" && ARRAY[@lifeStage, 'all']::text[]""");

        if (filter.MinPriceCents is not null) where.Append(""" AND "priceCents" >= @minPriceCents""");
        if (filter.MaxPriceCents is not null) where.Append(""" AND "priceCents" <= @maxPriceCents""");

        string? pattern = null;
        if (!string.IsNullOrWhiteSpace(filter.Q))
        {
            pattern = "%" + filter.Q.Trim()
                .Replace(@"\", @"\\").Replace("%", @"\%").Replace("_", @"\_") + "%";
            where.Append("""
                 AND (name ILIKE @pattern ESCAPE '\'
                      OR brand ILIKE @pattern ESCAPE '\'
                      OR description ILIKE @pattern ESCAPE '\')
                """);
        }

        // [sort, key1, key2, id]. key2 is "0" for the single-key orderings so
        // every cursor has the same shape.
        var parts = Cursor.DecodeParts(filter.Cursor, 4);
        if (parts is not null && parts[0] != sort) parts = null;

        double? cursorRating = null;
        int? cursorCount = null, cursorPrice = null;
        DateTimeOffset? cursorTime = null;
        string? cursorId = null;

        if (parts is not null)
        {
            var ok = sort switch
            {
                Models.Enums.ProductSorts.Featured or Models.Enums.ProductSorts.Rating =>
                    TryDouble(parts[1], out cursorRating) && TryInt(parts[2], out cursorCount),
                Models.Enums.ProductSorts.PriceAsc or Models.Enums.ProductSorts.PriceDesc =>
                    TryInt(parts[1], out cursorPrice),
                _ => TryTime(parts[1], out cursorTime),
            };
            if (ok) cursorId = parts[3];
        }

        if (cursorId is not null)
        {
            where.Append(sort switch
            {
                Models.Enums.ProductSorts.Featured or Models.Enums.ProductSorts.Rating =>
                    """ AND (rating, "reviewCount", id) < (@cursorRating, @cursorCount, @cursorId)""",
                Models.Enums.ProductSorts.PriceAsc =>
                    """ AND ("priceCents", id) > (@cursorPrice, @cursorId)""",
                Models.Enums.ProductSorts.PriceDesc =>
                    """ AND ("priceCents", id) < (@cursorPrice, @cursorId)""",
                _ =>
                    """ AND ("createdAt", id) < (@cursorTime, @cursorId)""",
            });
        }

        var orderBy = sort switch
        {
            Models.Enums.ProductSorts.Featured or Models.Enums.ProductSorts.Rating =>
                """ORDER BY rating DESC, "reviewCount" DESC, id DESC""",
            Models.Enums.ProductSorts.PriceAsc => """ORDER BY "priceCents" ASC, id ASC""",
            Models.Enums.ProductSorts.PriceDesc => """ORDER BY "priceCents" DESC, id DESC""",
            _ => """ORDER BY "createdAt" DESC, id DESC""",
        };

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // One more than asked for: if it comes back there is another page.
        var rows = (await session.Connection.QueryAsync<ProductEntity>(
            new CommandDefinition(
                $"""
                 SELECT {ProductColumns} FROM products
                 {where}
                 {orderBy}
                 LIMIT @limitPlusOne
                 """,
                new
                {
                    category = filter.Category,
                    brand = filter.Brand,
                    species = filter.Species,
                    lifeStage = filter.LifeStage,
                    minPriceCents = filter.MinPriceCents,
                    maxPriceCents = filter.MaxPriceCents,
                    pattern,
                    cursorRating,
                    cursorCount,
                    cursorPrice,
                    cursorTime,
                    cursorId,
                    limitPlusOne = limit + 1,
                },
                session.Transaction, cancellationToken: ct))).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];

            nextCursor = sort switch
            {
                Models.Enums.ProductSorts.Featured or Models.Enums.ProductSorts.Rating =>
                    Cursor.EncodeParts(
                        sort,
                        last.Rating.ToString("R", CultureInfo.InvariantCulture),
                        last.ReviewCount.ToString(CultureInfo.InvariantCulture),
                        last.Id),
                Models.Enums.ProductSorts.PriceAsc or Models.Enums.ProductSorts.PriceDesc =>
                    Cursor.EncodeParts(
                        sort, last.PriceCents.ToString(CultureInfo.InvariantCulture), "0", last.Id),
                _ =>
                    Cursor.EncodeParts(
                        sort,
                        last.CreatedAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
                        "0", last.Id),
            };
        }

        return (rows, nextCursor);
    }

    public async Task<ProductEntity?> GetBySlugAsync(
        string slug, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<ProductEntity>(
            new CommandDefinition(
                $"SELECT {ProductColumns} FROM products WHERE slug = @slug",
                new { slug }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<ProductEntity>> GetByIdsAsync(
        IReadOnlyCollection<string> ids,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        // Nothing to ask for is not worth a round trip.
        if (ids.Count == 0) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<ProductEntity>(
            new CommandDefinition(
                $"SELECT {ProductColumns} FROM products WHERE id = ANY(@ids)",
                new { ids = ids.ToArray() }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<bool> TryTakeStockAsync(
        string productId, int quantity,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var changed = await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE products SET "stockQty" = "stockQty" - @quantity
            WHERE id = @productId AND "stockQty" >= @quantity
            """,
            new { productId, quantity }, session.Transaction, cancellationToken: ct));

        return changed == 1;
    }

    public async Task ReturnStockAsync(
        string productId, int quantity,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE products SET "stockQty" = "stockQty" + @quantity WHERE id = @productId""",
            new { productId, quantity }, session.Transaction, cancellationToken: ct));
    }

    private static bool TryDouble(string s, out double? value)
    {
        var ok = double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v);
        value = ok ? v : null;
        return ok;
    }

    private static bool TryInt(string s, out int? value)
    {
        var ok = int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v);
        value = ok ? v : null;
        return ok;
    }

    private static bool TryTime(string s, out DateTimeOffset? value)
    {
        var ok = DateTimeOffset.TryParse(
            s, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var v);
        value = ok ? v : null;
        return ok;
    }
}
