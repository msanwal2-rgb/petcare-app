using System.Globalization;
using System.Text;
using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>caretaker_profiles</c>, <c>pricing_entries</c> and
/// <c>availability_days</c>.
/// </summary>
public sealed class CaretakerRepository(NpgsqlDataSource db) : ICaretakerRepository
{
    private const string ProfileColumns = """
        c.id AS "Id", c."userId" AS "UserId", c.bio AS "Bio",
        c."servicesOffered" AS "ServicesOffered",
        c."serviceRadiusMiles" AS "ServiceRadiusMiles",
        c."acceptedSpecies" AS "AcceptedSpecies",
        c."fencedYard" AS "FencedYard", c."hasOtherPets" AS "HasOtherPets",
        c."smokeFree" AS "SmokeFree", c.certifications AS "Certifications",
        c."backgroundCheckStatus" AS "BackgroundCheckStatus",
        c.rating AS "Rating", c."reviewCount" AS "ReviewCount",
        c."responseRatePct" AS "ResponseRatePct"
        """;

    /// <summary>
    /// The same columns without the <c>c.</c> alias, for the statements that
    /// have no join to disambiguate. Written out rather than derived from
    /// <see cref="ProfileColumns"/> by string replacement — a <c>Replace("c.",
    /// "")</c> would also eat those two characters anywhere else they appeared,
    /// which is a silent corruption waiting for a column named like one.
    /// </summary>
    private const string ProfileColumnsBare = """
        id AS "Id", "userId" AS "UserId", bio AS "Bio",
        "servicesOffered" AS "ServicesOffered",
        "serviceRadiusMiles" AS "ServiceRadiusMiles",
        "acceptedSpecies" AS "AcceptedSpecies",
        "fencedYard" AS "FencedYard", "hasOtherPets" AS "HasOtherPets",
        "smokeFree" AS "SmokeFree", certifications AS "Certifications",
        "backgroundCheckStatus" AS "BackgroundCheckStatus",
        rating AS "Rating", "reviewCount" AS "ReviewCount",
        "responseRatePct" AS "ResponseRatePct"
        """;

    private const string UserColumns = """
        u.id AS "Id", u.name AS "Name", u.email AS "Email", u.phone AS "Phone",
        u."avatarUrl" AS "AvatarUrl", u.roles AS "Roles",
        u."addressCity" AS "AddressCity", u."addressState" AS "AddressState",
        u.lat AS "Lat", u.lng AS "Lng", u.verified AS "Verified",
        u."createdAt" AS "CreatedAt", u."staffRoles" AS "StaffRoles", u.status AS "Status"
        """;

    /// <summary>
    /// Great-circle miles between the searched point and the caretaker's city.
    ///
    /// Spelled out rather than reached for with PostGIS, which this schema does
    /// not have and does not need: the answer is a "miles away" badge on a card,
    /// not a routing decision. <c>least/greatest</c> clamp the cosine into
    /// [-1, 1] — floating-point drift can push it a hair outside, and
    /// <c>acos</c> of 1.0000000002 is NaN, which would silently drop the row
    /// from an ordered result.
    /// </summary>
    private const string DistanceMiles = """
        (3959 * acos(least(1, greatest(-1,
            cos(radians(@lat)) * cos(radians(u.lat))
              * cos(radians(u.lng) - radians(@lng))
            + sin(radians(@lat)) * sin(radians(u.lat))
        ))))
        """;

    /// <summary>
    /// Search, filtered, distanced, sorted and paginated in one statement.
    ///
    /// ── The ordering, and why the cursor works ──
    ///
    /// With a location: nearest first. Without one: best rated first. Both are
    /// tie-broken by <c>id</c>, which is what makes the cursor total — two
    /// caretakers with identical ratings still have a strict order, so no row
    /// can be skipped or repeated across a page boundary.
    ///
    /// The cursor is keyset, not offset. <c>OFFSET 200</c> makes the database
    /// find and discard two hundred rows to return twenty, and it duplicates or
    /// drops rows when the underlying set changes between pages — which it does,
    /// because reputation moves. Comparing against the last row's sort key has
    /// neither problem.
    /// </summary>
    public async Task<(IReadOnlyList<CaretakerSearchRow> Rows, string? NextCursor)> SearchAsync(
        CaretakerSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var hasOrigin = filter.Lat is not null && filter.Lng is not null;
        var limit = Math.Clamp(filter.Limit, 1, 100);

        var where = new StringBuilder("WHERE u.status = 'active'");

        // Overlap rather than containment: "offers any of these" is the
        // question, and && uses the array index.
        if (filter.ServiceType is not null)
            where.Append("""  AND c."servicesOffered" && ARRAY[@serviceType]::text[] """);

        if (filter.Species is not null)
            where.Append("""  AND c."acceptedSpecies" && ARRAY[@species]::text[] """);

        // A caretaker with no rate card at all cannot be priced, so a price
        // filter excludes them rather than treating them as free.
        if (filter.MinPrice is not null)
            where.Append("  AND p.\"maxRate\" >= @minRateCents ");
        if (filter.MaxPrice is not null)
            where.Append("  AND p.\"minRate\" <= @maxRateCents ");

        if (filter.StartDate is not null)
        {
            // Available on or after that date, with at least one real slot. An
            // empty slot array is a day they marked as not working.
            where.Append("""
                 AND EXISTS (
                     SELECT 1 FROM availability_days a
                     WHERE a."caretakerId" = c.id
                       AND a.date >= @startDate
                       AND jsonb_array_length(a.slots) > 0
                 )
                """);
        }

        if (hasOrigin && filter.RadiusMiles is not null)
            where.Append($"  AND {DistanceMiles} <= @radiusMiles ");

        var (cursorSort, cursorId) = DecodeCursor(filter.Cursor);
        if (cursorId is not null)
        {
            // Strictly after the last row in the previous page, in the same
            // order the ORDER BY uses. The row-value comparison is what makes
            // the tie-break participate rather than being decorative.
            where.Append(hasOrigin
                ? $"  AND ({DistanceMiles}, c.id) > (@cursorSort, @cursorId) "
                : "  AND (c.rating, c.id) < (@cursorSort, @cursorId) ");
        }

        var orderBy = hasOrigin
            ? $"ORDER BY {DistanceMiles} ASC, c.id ASC"
            : "ORDER BY c.rating DESC, c.id DESC";

        var distanceSelect = hasOrigin ? $"{DistanceMiles} AS \"DistanceMiles\"" : "NULL::float8 AS \"DistanceMiles\"";

        var sql = $"""
            WITH price AS (
                SELECT "caretakerId",
                       min("rateCents") AS "minRate",
                       max("rateCents") AS "maxRate"
                FROM pricing_entries
                GROUP BY "caretakerId"
            )
            SELECT {ProfileColumns},
                   {UserColumns},
                   COALESCE(p."minRate", 0) AS "MinRateCents",
                   COALESCE(p."maxRate", 0) AS "MaxRateCents",
                   {distanceSelect}
            FROM caretaker_profiles c
            JOIN users u ON u.id = c."userId"
            LEFT JOIN price p ON p."caretakerId" = c.id
            {where}
            {orderBy}
            LIMIT @limitPlusOne
            """;

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // One more than asked for: if it comes back, there is another page, and
        // the extra row is discarded. A COUNT(*) to answer the same question
        // would double the work of every search.
        var rows = (await session.Connection.QueryAsync<
                CaretakerProfileEntity, UserEntity, CaretakerSearchRow, CaretakerSearchRow>(
            new CommandDefinition(sql,
                new
                {
                    lat = filter.Lat,
                    lng = filter.Lng,
                    radiusMiles = filter.RadiusMiles,
                    serviceType = filter.ServiceType,
                    species = filter.Species,
                    startDate = filter.StartDate,
                    minRateCents = ToCents(filter.MinPrice),
                    maxRateCents = ToCents(filter.MaxPrice),
                    cursorSort,
                    cursorId,
                    limitPlusOne = limit + 1,
                },
                session.Transaction, cancellationToken: ct),
            (profile, user, row) =>
            {
                row.Profile = profile;
                row.User = user;
                return row;
            },
            splitOn: "Id,MinRateCents")).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            var sortValue = hasOrigin ? last.DistanceMiles ?? 0 : last.Profile.Rating;
            nextCursor = EncodeCursor(sortValue, last.Profile.Id);
        }

        return (rows, nextCursor);
    }

    public async Task<CaretakerProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<CaretakerProfileEntity>(
            new CommandDefinition(
                $"SELECT {ProfileColumns} FROM caretaker_profiles c WHERE c.id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<CaretakerProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<CaretakerProfileEntity>(
            new CommandDefinition(
                $"""SELECT {ProfileColumns} FROM caretaker_profiles c WHERE c."userId" = @userId""",
                new { userId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<PricingEntryEntity>> ListPricingAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<PricingEntryEntity>(
            new CommandDefinition(
                """
                SELECT id AS "Id", "caretakerId" AS "CaretakerId",
                       "serviceType" AS "ServiceType", unit AS "Unit",
                       "rateCents" AS "RateCents"
                FROM pricing_entries WHERE "caretakerId" = @caretakerId
                ORDER BY "serviceType" ASC
                """,
                new { caretakerId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<AvailabilityDayEntity>> ListAvailabilityAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<AvailabilityDayEntity>(
            new CommandDefinition(
                """
                SELECT id AS "Id", "caretakerId" AS "CaretakerId",
                       date AS "Date", slots AS "Slots"
                FROM availability_days WHERE "caretakerId" = @caretakerId
                ORDER BY date ASC
                """,
                new { caretakerId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<PricingEntryEntity?> GetPricingForServiceAsync(
        string caretakerId, string serviceType,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PricingEntryEntity>(
            new CommandDefinition(
                """
                SELECT id AS "Id", "caretakerId" AS "CaretakerId",
                       "serviceType" AS "ServiceType", unit AS "Unit",
                       "rateCents" AS "RateCents"
                FROM pricing_entries
                WHERE "caretakerId" = @caretakerId AND "serviceType" = @serviceType
                """,
                new { caretakerId, serviceType },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<CaretakerProfileEntity> CreateAsync(
        CaretakerProfileEntity profile,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<CaretakerProfileEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO caretaker_profiles (
                     id, "userId", bio, "servicesOffered", "serviceRadiusMiles",
                     "acceptedSpecies", "fencedYard", "hasOtherPets", "smokeFree",
                     certifications, "backgroundCheckStatus", rating, "reviewCount",
                     "responseRatePct")
                 VALUES (
                     @Id, @UserId, @Bio, @ServicesOffered, @ServiceRadiusMiles,
                     @AcceptedSpecies, @FencedYard, @HasOtherPets, @SmokeFree,
                     @Certifications, @BackgroundCheckStatus, @Rating, @ReviewCount,
                     @ResponseRatePct)
                 RETURNING {ProfileColumnsBare}
                 """,
                profile, session.Transaction, cancellationToken: ct));
    }

    public async Task<CaretakerProfileEntity?> UpdateAsync(
        string id, CaretakerPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // COALESCE with explicit casts, as in PetRepository: an omitted property
        // arrives as an untyped NULL and PostgreSQL will not guess its type.
        return await session.Connection.QuerySingleOrDefaultAsync<CaretakerProfileEntity>(
            new CommandDefinition(
                $"""
                 UPDATE caretaker_profiles SET
                     bio                     = COALESCE(@Bio::text, bio),
                     "servicesOffered"       = COALESCE(@ServicesOffered::text[], "servicesOffered"),
                     "serviceRadiusMiles"    = COALESCE(@ServiceRadiusMiles::int, "serviceRadiusMiles"),
                     "acceptedSpecies"       = COALESCE(@AcceptedSpecies::text[], "acceptedSpecies"),
                     "fencedYard"            = COALESCE(@FencedYard::boolean, "fencedYard"),
                     "hasOtherPets"          = COALESCE(@HasOtherPets::boolean, "hasOtherPets"),
                     "smokeFree"             = COALESCE(@SmokeFree::boolean, "smokeFree"),
                     certifications          = COALESCE(@Certifications::text[], certifications),
                     "backgroundCheckStatus" = COALESCE(@BackgroundCheckStatus::text, "backgroundCheckStatus")
                 WHERE id = @id
                 RETURNING {ProfileColumnsBare}
                 """,
                new
                {
                    id, patch.Bio, patch.ServicesOffered, patch.ServiceRadiusMiles,
                    patch.AcceptedSpecies, patch.FencedYard, patch.HasOtherPets,
                    patch.SmokeFree, patch.Certifications, patch.BackgroundCheckStatus,
                },
                session.Transaction, cancellationToken: ct));
    }

    public async Task ReplacePricingAsync(
        string caretakerId, IReadOnlyList<PricingEntryEntity> pricing,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """DELETE FROM pricing_entries WHERE "caretakerId" = @caretakerId""",
            new { caretakerId }, session.Transaction, cancellationToken: ct));

        if (pricing.Count == 0) return;

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO pricing_entries (id, "caretakerId", "serviceType", unit, "rateCents")
            VALUES (@Id, @CaretakerId, @ServiceType, @Unit, @RateCents)
            """,
            pricing, session.Transaction, cancellationToken: ct));
    }

    public async Task ReplaceAvailabilityAsync(
        string caretakerId, IReadOnlyList<AvailabilityDayEntity> availability,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """DELETE FROM availability_days WHERE "caretakerId" = @caretakerId""",
            new { caretakerId }, session.Transaction, cancellationToken: ct));

        if (availability.Count == 0) return;

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO availability_days (id, "caretakerId", date, slots)
            VALUES (@Id, @CaretakerId, @Date, @Slots)
            """,
            availability, session.Transaction, cancellationToken: ct));
    }

    public async Task SetReputationAsync(
        string caretakerId, double? rating, int? reviewCount, int? responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE caretaker_profiles SET
                rating            = COALESCE(@rating::float8, rating),
                "reviewCount"     = COALESCE(@reviewCount::int, "reviewCount"),
                "responseRatePct" = COALESCE(@responseRatePct::int, "responseRatePct")
            WHERE id = @caretakerId
            """,
            new { caretakerId, rating, reviewCount, responseRatePct },
            session.Transaction, cancellationToken: ct));
    }

    private static int? ToCents(decimal? usd)
        => usd is null ? null : (int)Math.Round(usd.Value * 100m, MidpointRounding.AwayFromZero);

    /// <summary>
    /// The cursor: the last row's sort value and its id, base64url-encoded.
    ///
    /// Encoded rather than sent as two query parameters so that it reads as one
    /// opaque token. A client that took it apart would be coupled to the sort
    /// order, and the sort order changes with the filter.
    /// </summary>
    private static string EncodeCursor(double sortValue, string id)
    {
        var raw = $"{sortValue.ToString("R", CultureInfo.InvariantCulture)}|{id}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(raw))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// <summary>
    /// Decode, treating anything malformed as "start from the beginning".
    ///
    /// A cursor is not a credential — it names a position in a public result
    /// set. Rejecting a garbled one with a 400 gives a caller a way to probe,
    /// and gives an honest client a dead end when a bookmark ages out.
    /// </summary>
    private static (double? Sort, string? Id) DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return (null, null);

        try
        {
            var padded = cursor.Replace('-', '+').Replace('_', '/')
                .PadRight((cursor.Length + 3) / 4 * 4, '=');
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(padded));

            var split = raw.IndexOf('|');
            if (split <= 0) return (null, null);

            return double.TryParse(
                raw[..split], NumberStyles.Float, CultureInfo.InvariantCulture, out var sort)
                ? (sort, raw[(split + 1)..])
                : (null, null);
        }
        catch (FormatException)
        {
            return (null, null);
        }
    }
}
