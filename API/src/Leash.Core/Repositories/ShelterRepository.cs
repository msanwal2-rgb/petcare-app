using System.Globalization;
using System.Text;
using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>shelter_profiles</c>. Shaped like <see cref="VetRepository"/>:
/// the search filters, distances, sorts and pages in one statement.
/// </summary>
public sealed class ShelterRepository(NpgsqlDataSource db) : IShelterRepository
{
    private const string ProfileColumns = """
        s.id AS "Id", s."userId" AS "UserId", s.name AS "Name", s.bio AS "Bio",
        s.kind AS "Kind", s."registrationNumber" AS "RegistrationNumber",
        s."registrationState" AS "RegistrationState",
        s."verificationStatus" AS "VerificationStatus",
        s."acceptedSpecies" AS "AcceptedSpecies", s."websiteUrl" AS "WebsiteUrl",
        s.phone AS "Phone", s.email AS "Email", s."addressLine" AS "AddressLine",
        s.city AS "City", s.state AS "State", s.lat AS "Lat", s.lng AS "Lng",
        s."adoptionPolicy" AS "AdoptionPolicy", s."responseRatePct" AS "ResponseRatePct",
        s."createdAt" AS "CreatedAt"
        """;

    private const string UserColumns = """
        u.id AS "Id", u.name AS "Name", u.email AS "Email", u.phone AS "Phone",
        u."avatarUrl" AS "AvatarUrl", u.roles AS "Roles",
        u."addressCity" AS "AddressCity", u."addressState" AS "AddressState",
        u.lat AS "Lat", u.lng AS "Lng", u.verified AS "Verified",
        u."createdAt" AS "CreatedAt", u."staffRoles" AS "StaffRoles", u.status AS "Status"
        """;

    /// <summary>
    /// Every profile with its count of animals available right now — one
    /// correlated count rather than a query per shelter, because the number is
    /// on every card and the N+1 would be the page.
    /// </summary>
    private const string WithCounts = """
        (SELECT sp.*,
                (SELECT count(*)::int FROM adoption_listings l
                  WHERE l."shelterId" = sp.id AND l.status = 'available') AS avail
           FROM shelter_profiles sp) s
        """;

    /// <summary>Great-circle miles to the shelter, clamped as in <see cref="VetRepository"/>.</summary>
    private const string DistanceMiles = """
        (3959 * acos(least(1, greatest(-1,
            cos(radians(@lat)) * cos(radians(s.lat))
              * cos(radians(s.lng) - radians(@lng))
            + sin(radians(@lat)) * sin(radians(s.lat))
        ))))
        """;

    /// <summary>
    /// Nearest first when the adopter said where they are; otherwise the
    /// shelters with animals to show, then the most responsive. Both orders end
    /// in <c>id</c>, which is what makes the cursor total.
    /// </summary>
    public async Task<(IReadOnlyList<ShelterRow> Rows, string? NextCursor)> SearchAsync(
        ShelterSearchQuery query, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var hasOrigin = query.Lat is not null && query.Lng is not null;
        var limit = Math.Clamp(query.Limit, 1, 100);

        var where = new StringBuilder("WHERE u.status = 'active'");
        if (query.Species is not null) where.Append("""  AND s."acceptedSpecies" && ARRAY[@species]::text[] """);
        if (query.Kind is not null) where.Append("  AND s.kind = @kind ");
        if (query.VerifiedOnly) where.Append("""  AND s."verificationStatus" = 'verified' """);
        if (query.WithAvailable) where.Append("  AND s.avail > 0 ");
        if (hasOrigin && query.RadiusMiles is not null) where.Append($"  AND {DistanceMiles} <= @radiusMiles ");

        double? cursorDistance = null;
        int? cursorAvail = null, cursorRate = null;
        string? cursorId = null;

        if (hasOrigin)
        {
            (cursorDistance, cursorId) = Cursor.DecodeNumber(query.Cursor);
            if (cursorId is not null)
                where.Append($"  AND ({DistanceMiles}, s.id) > (@cursorDistance, @cursorId) ");
        }
        else if (Cursor.DecodeParts(query.Cursor, 3) is [var a, var r, var id]
                 && int.TryParse(a, NumberStyles.Integer, CultureInfo.InvariantCulture, out var avail)
                 && int.TryParse(r, NumberStyles.Integer, CultureInfo.InvariantCulture, out var rate))
        {
            (cursorAvail, cursorRate, cursorId) = (avail, rate, id);

            // Two descending keys and an ascending tie-break: a row value
            // comparison cannot mix directions, so it is spelled out.
            where.Append("""
                  AND (s.avail < @cursorAvail
                       OR (s.avail = @cursorAvail AND (s."responseRatePct" < @cursorRate
                           OR (s."responseRatePct" = @cursorRate AND s.id > @cursorId))))
                """);
        }

        var orderBy = hasOrigin
            ? $"ORDER BY {DistanceMiles} ASC, s.id ASC"
            : """ORDER BY s.avail DESC, s."responseRatePct" DESC, s.id ASC""";

        var distanceSelect = hasOrigin ? DistanceMiles : "NULL::float8";

        var sql = $"""
            SELECT {ProfileColumns}, {UserColumns},
                   s.avail AS "AvailableCount", {distanceSelect} AS "DistanceMiles"
            FROM {WithCounts}
            JOIN users u ON u.id = s."userId"
            {where}
            {orderBy}
            LIMIT @limitPlusOne
            """;

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<ShelterProfileEntity, UserEntity, ShelterRow, ShelterRow>(
            new CommandDefinition(sql,
                new
                {
                    lat = query.Lat, lng = query.Lng, radiusMiles = query.RadiusMiles,
                    species = query.Species, kind = query.Kind,
                    cursorDistance, cursorAvail, cursorRate, cursorId,
                    limitPlusOne = limit + 1,
                },
                session.Transaction, cancellationToken: ct),
            (profile, user, extra) => new ShelterRow
            {
                Profile = profile,
                User = user,
                AvailableCount = extra.AvailableCount,
                DistanceMiles = extra.DistanceMiles,
            },
            splitOn: "Id,AvailableCount")).ToList();

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            next = hasOrigin
                ? Cursor.Encode(last.DistanceMiles ?? 0, last.Profile.Id)
                : Cursor.EncodeParts(
                    last.AvailableCount.ToString(CultureInfo.InvariantCulture),
                    last.Profile.ResponseRatePct.ToString(CultureInfo.InvariantCulture),
                    last.Profile.Id);
        }

        return (rows, next);
    }

    public async Task<ShelterRow?> GetRowAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<ShelterProfileEntity, UserEntity, ShelterRow, ShelterRow>(
            new CommandDefinition($"""
                SELECT {ProfileColumns}, {UserColumns},
                       s.avail AS "AvailableCount", NULL::float8 AS "DistanceMiles"
                FROM {WithCounts}
                JOIN users u ON u.id = s."userId"
                WHERE s.id = @id
                """, new { id }, session.Transaction, cancellationToken: ct),
            (profile, user, extra) => new ShelterRow
            {
                Profile = profile, User = user, AvailableCount = extra.AvailableCount,
            },
            splitOn: "Id,AvailableCount");

        return rows.SingleOrDefault();
    }

    public Task<ShelterProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
        => OneAsync("s.id = @key", id, scope, ct);

    public Task<ShelterProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
        => OneAsync("""s."userId" = @key""", userId, scope, ct);

    private async Task<ShelterProfileEntity?> OneAsync(
        string predicate, string key, ITransactionScope? scope, CancellationToken ct)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<ShelterProfileEntity>(
            new CommandDefinition(
                $"SELECT {ProfileColumns} FROM shelter_profiles s WHERE {predicate}",
                new { key }, session.Transaction, cancellationToken: ct));
    }

    public async Task<ShelterProfileEntity> CreateAsync(
        ShelterProfileEntity profile, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        // A data-modifying CTE, so the row comes back through the same aliased
        // column list every read uses.
        return await session.Connection.QuerySingleAsync<ShelterProfileEntity>(new CommandDefinition(
            $"""
            WITH s AS (
            INSERT INTO shelter_profiles (
                id, "userId", name, bio, kind, "registrationNumber", "registrationState",
                "verificationStatus", "acceptedSpecies", "websiteUrl", phone, email,
                "addressLine", city, state, lat, lng, "adoptionPolicy", "responseRatePct", "createdAt")
            VALUES (
                @Id, @UserId, @Name, @Bio, @Kind, @RegistrationNumber, @RegistrationState,
                @VerificationStatus, @AcceptedSpecies, @WebsiteUrl, @Phone, @Email,
                @AddressLine, @City, @State, @Lat, @Lng, @AdoptionPolicy, @ResponseRatePct, @CreatedAt)
            RETURNING *)
            SELECT {ProfileColumns} FROM s
            """,
            profile, session.Transaction, cancellationToken: ct));
    }

    public async Task<ShelterProfileEntity?> UpdateAsync(
        string id, ShelterPatch patch, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // COALESCE with explicit casts, as in VetRepository.UpdateAsync. The two
        // derived columns are absent: there is nothing here that can reach them.
        return await session.Connection.QuerySingleOrDefaultAsync<ShelterProfileEntity>(new CommandDefinition(
            $"""
            WITH s AS (
            UPDATE shelter_profiles SET
                name                 = COALESCE(@Name::text, name),
                bio                  = COALESCE(@Bio::text, bio),
                kind                 = COALESCE(@Kind::text, kind),
                "registrationNumber" = COALESCE(@RegistrationNumber::text, "registrationNumber"),
                "registrationState"  = COALESCE(@RegistrationState::text, "registrationState"),
                "acceptedSpecies"    = COALESCE(@AcceptedSpecies::text[], "acceptedSpecies"),
                "websiteUrl"         = COALESCE(@WebsiteUrl::text, "websiteUrl"),
                phone                = COALESCE(@Phone::text, phone),
                email                = COALESCE(@Email::text, email),
                "addressLine"        = COALESCE(@AddressLine::text, "addressLine"),
                city                 = COALESCE(@City::text, city),
                state                = COALESCE(@State::text, state),
                lat                  = COALESCE(@Lat::float8, lat),
                lng                  = COALESCE(@Lng::float8, lng),
                "adoptionPolicy"     = COALESCE(@AdoptionPolicy::text, "adoptionPolicy")
            WHERE id = @id
            RETURNING *)
            SELECT {ProfileColumns} FROM s
            """,
            new
            {
                id, patch.Name, patch.Bio, patch.Kind, patch.RegistrationNumber,
                patch.RegistrationState, patch.AcceptedSpecies, patch.WebsiteUrl, patch.Phone,
                patch.Email, patch.AddressLine, patch.City, patch.State, patch.Lat, patch.Lng,
                patch.AdoptionPolicy,
            },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<(int Answered, int Waiting)> CountApplicationsAsync(
        string shelterId, string[] answered, string waiting,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var row = await session.Connection.QuerySingleAsync<CountRow>(new CommandDefinition(
            """
            SELECT count(*) FILTER (WHERE status = ANY(@answered))::int AS "Answered",
                   count(*) FILTER (WHERE status = @waiting)::int       AS "Waiting"
            FROM adoption_applications WHERE "shelterId" = @shelterId
            """,
            new { shelterId, answered, waiting }, session.Transaction, cancellationToken: ct));

        return (row.Answered, row.Waiting);
    }

    public async Task SetResponseRateAsync(
        string shelterId, int responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE shelter_profiles SET "responseRatePct" = @responseRatePct WHERE id = @shelterId""",
            new { shelterId, responseRatePct }, session.Transaction, cancellationToken: ct));
    }

    private sealed class CountRow
    {
        public int Answered { get; set; }
        public int Waiting { get; set; }
    }
}
