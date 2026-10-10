using System.Text;
using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>vet_profiles</c> and <c>vet_availability_days</c>.
///
/// Reads as a near-copy of <see cref="CaretakerRepository"/> on purpose: the
/// two are the same kind of thing, so somebody who has read one can check the
/// other by diffing it. The differences are all real — distance is measured to
/// the <b>clinic</b> rather than to the person's home, there is no rate card,
/// and the filters are the clinical ones.
/// </summary>
public sealed class VetRepository(NpgsqlDataSource db) : IVetRepository
{
    private const string ProfileColumns = """
        v.id AS "Id", v."userId" AS "UserId", v."clinicName" AS "ClinicName",
        v.bio AS "Bio", v.specialties AS "Specialties",
        v."licenseNumber" AS "LicenseNumber", v."licenseState" AS "LicenseState",
        v."verificationStatus" AS "VerificationStatus",
        v."yearsExperience" AS "YearsExperience",
        v."acceptedSpecies" AS "AcceptedSpecies", v."consultModes" AS "ConsultModes",
        v."consultFeeCents" AS "ConsultFeeCents",
        v."emergencyAvailable" AS "EmergencyAvailable",
        v."clinicCity" AS "ClinicCity", v."clinicState" AS "ClinicState",
        v."clinicPhone" AS "ClinicPhone",
        v.lat AS "Lat", v.lng AS "Lng", v.rating AS "Rating",
        v."reviewCount" AS "ReviewCount", v."responseRatePct" AS "ResponseRatePct"
        """;

    /// <summary>
    /// The same columns without the <c>v.</c> alias, for the statements with no
    /// join to disambiguate. Written out rather than derived by string
    /// replacement — a <c>Replace("v.", "")</c> would also eat those two
    /// characters anywhere else they appeared.
    /// </summary>
    private const string ProfileColumnsBare = """
        id AS "Id", "userId" AS "UserId", "clinicName" AS "ClinicName",
        bio AS "Bio", specialties AS "Specialties",
        "licenseNumber" AS "LicenseNumber", "licenseState" AS "LicenseState",
        "verificationStatus" AS "VerificationStatus",
        "yearsExperience" AS "YearsExperience",
        "acceptedSpecies" AS "AcceptedSpecies", "consultModes" AS "ConsultModes",
        "consultFeeCents" AS "ConsultFeeCents",
        "emergencyAvailable" AS "EmergencyAvailable",
        "clinicCity" AS "ClinicCity", "clinicState" AS "ClinicState",
        "clinicPhone" AS "ClinicPhone",
        lat AS "Lat", lng AS "Lng", rating AS "Rating",
        "reviewCount" AS "ReviewCount", "responseRatePct" AS "ResponseRatePct"
        """;

    private const string UserColumns = """
        u.id AS "Id", u.name AS "Name", u.email AS "Email", u.phone AS "Phone",
        u."avatarUrl" AS "AvatarUrl", u.roles AS "Roles",
        u."addressCity" AS "AddressCity", u."addressState" AS "AddressState",
        u.lat AS "Lat", u.lng AS "Lng", u.verified AS "Verified",
        u."createdAt" AS "CreatedAt", u."staffRoles" AS "StaffRoles", u.status AS "Status"
        """;

    /// <summary>
    /// Great-circle miles from the searched point to the <b>clinic</b>
    /// (<c>v.lat</c>/<c>v.lng</c>), not to the vet's home address. That is the
    /// address an owner actually has to drive to, and for a vet who does home
    /// visits it is still the one the practice is registered at.
    ///
    /// <c>least/greatest</c> clamp the cosine into [-1, 1]: floating-point drift
    /// can push it a hair outside, and <c>acos(1.0000000002)</c> is NaN, which
    /// would silently drop the row from an ordered result.
    /// </summary>
    private const string DistanceMiles = """
        (3959 * acos(least(1, greatest(-1,
            cos(radians(@lat)) * cos(radians(v.lat))
              * cos(radians(v.lng) - radians(@lng))
            + sin(radians(@lat)) * sin(radians(v.lat))
        ))))
        """;

    /// <summary>
    /// Search, filtered, distanced, sorted and paginated in one statement.
    ///
    /// With a location: nearest first. Without one: best rated first. Both are
    /// tie-broken by <c>id</c>, which is what makes the cursor total — two
    /// clinics with identical ratings still have a strict order, so no row can
    /// be skipped or repeated across a page boundary. See
    /// <see cref="Cursor"/> for why it is keyset rather than offset.
    /// </summary>
    public async Task<(IReadOnlyList<VetSearchRow> Rows, string? NextCursor)> SearchAsync(
        VetSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var hasOrigin = filter.Lat is not null && filter.Lng is not null;
        var limit = Math.Clamp(filter.Limit, 1, 100);

        var where = new StringBuilder("WHERE u.status = 'active'");

        // Overlap rather than containment: "lists any of these" is the question,
        // and && uses the array index.
        if (filter.Specialty is not null)
            where.Append("""  AND v.specialties && ARRAY[@specialty]::text[] """);

        if (filter.Species is not null)
            where.Append("""  AND v."acceptedSpecies" && ARRAY[@species]::text[] """);

        if (filter.Mode is not null)
            where.Append("""  AND v."consultModes" && ARRAY[@mode]::text[] """);

        // One-way: asking for emergency cover narrows the list, while not asking
        // does not exclude the clinics that offer it.
        if (filter.EmergencyOnly)
            where.Append("""  AND v."emergencyAvailable" """);

        if (hasOrigin && filter.RadiusMiles is not null)
            where.Append($"  AND {DistanceMiles} <= @radiusMiles ");

        var (cursorSort, cursorId) = Cursor.DecodeNumber(filter.Cursor);
        if (cursorId is not null)
        {
            // Strictly after the last row of the previous page, in the same
            // order the ORDER BY uses. The row-value comparison is what makes
            // the tie-break participate rather than being decorative.
            where.Append(hasOrigin
                ? $"  AND ({DistanceMiles}, v.id) > (@cursorSort, @cursorId) "
                : "  AND (v.rating, v.id) < (@cursorSort, @cursorId) ");
        }

        var orderBy = hasOrigin
            ? $"ORDER BY {DistanceMiles} ASC, v.id ASC"
            : "ORDER BY v.rating DESC, v.id DESC";

        var distanceSelect = hasOrigin
            ? $"{DistanceMiles} AS \"DistanceMiles\""
            : "NULL::float8 AS \"DistanceMiles\"";

        var sql = $"""
            SELECT {ProfileColumns},
                   {UserColumns},
                   {distanceSelect}
            FROM vet_profiles v
            JOIN users u ON u.id = v."userId"
            {where}
            {orderBy}
            LIMIT @limitPlusOne
            """;

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // One more than asked for: if it comes back there is another page, and
        // the extra row is discarded. A COUNT(*) to answer the same question
        // would double the work of every search.
        var rows = (await session.Connection.QueryAsync<
                VetProfileEntity, UserEntity, VetSearchRow, VetSearchRow>(
            new CommandDefinition(sql,
                new
                {
                    lat = filter.Lat,
                    lng = filter.Lng,
                    radiusMiles = filter.RadiusMiles,
                    specialty = filter.Specialty,
                    species = filter.Species,
                    mode = filter.Mode,
                    cursorSort,
                    cursorId,
                    limitPlusOne = limit + 1,
                },
                session.Transaction, cancellationToken: ct),
            // `row` is null on an unlocated search, and that is Dapper rather
            // than a bug: a split segment whose every column is NULL
            // materialises as null, and this one has a single column that is
            // literally `NULL::float8` when no origin was given. The caretaker
            // search never hits it because its third segment carries a
            // COALESCE'd price. Constructing the row here rather than mutating
            // the one Dapper may or may not have made keeps that from mattering.
            (profile, user, row) => new VetSearchRow
            {
                Profile = profile,
                User = user,
                DistanceMiles = row?.DistanceMiles,
            },
            splitOn: "Id,DistanceMiles")).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            var sortValue = hasOrigin ? last.DistanceMiles ?? 0 : last.Profile.Rating;
            nextCursor = Cursor.Encode(sortValue, last.Profile.Id);
        }

        return (rows, nextCursor);
    }

    public async Task<VetProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VetProfileEntity>(
            new CommandDefinition(
                $"SELECT {ProfileColumns} FROM vet_profiles v WHERE v.id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<VetProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VetProfileEntity>(
            new CommandDefinition(
                $"""SELECT {ProfileColumns} FROM vet_profiles v WHERE v."userId" = @userId""",
                new { userId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<VetAvailabilityDayEntity>> ListAvailabilityAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<VetAvailabilityDayEntity>(
            new CommandDefinition(
                """
                SELECT id AS "Id", "vetId" AS "VetId", date AS "Date", slots AS "Slots"
                FROM vet_availability_days WHERE "vetId" = @vetId
                ORDER BY date ASC
                """,
                new { vetId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<VetProfileEntity> CreateAsync(
        VetProfileEntity profile,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<VetProfileEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO vet_profiles (
                     id, "userId", "clinicName", bio, specialties, "licenseNumber",
                     "licenseState", "verificationStatus", "yearsExperience",
                     "acceptedSpecies", "consultModes", "consultFeeCents",
                     "emergencyAvailable", "clinicCity", "clinicState", "clinicPhone", lat, lng,
                     rating, "reviewCount", "responseRatePct")
                 VALUES (
                     @Id, @UserId, @ClinicName, @Bio, @Specialties, @LicenseNumber,
                     @LicenseState, @VerificationStatus, @YearsExperience,
                     @AcceptedSpecies, @ConsultModes, @ConsultFeeCents,
                     @EmergencyAvailable, @ClinicCity, @ClinicState, @ClinicPhone, @Lat, @Lng,
                     @Rating, @ReviewCount, @ResponseRatePct)
                 RETURNING {ProfileColumnsBare}
                 """,
                profile, session.Transaction, cancellationToken: ct));
    }

    public async Task<VetProfileEntity?> UpdateAsync(
        string id, VetPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // COALESCE with explicit casts: an omitted property arrives as an
        // untyped NULL and PostgreSQL answers "could not determine data type of
        // parameter" rather than guessing (ARCHITECTURE.md section 9).
        //
        // `verificationStatus` is absent by design — REQUIREMENTS.md V11 makes
        // it staff's to set, and a vet patching their own profile must not be
        // able to reach it.
        return await session.Connection.QuerySingleOrDefaultAsync<VetProfileEntity>(
            new CommandDefinition(
                $"""
                 UPDATE vet_profiles SET
                     bio                   = COALESCE(@Bio::text, bio),
                     specialties           = COALESCE(@Specialties::text[], specialties),
                     "licenseNumber"       = COALESCE(@LicenseNumber::text, "licenseNumber"),
                     "licenseState"        = COALESCE(@LicenseState::text, "licenseState"),
                     "yearsExperience"     = COALESCE(@YearsExperience::int, "yearsExperience"),
                     "acceptedSpecies"     = COALESCE(@AcceptedSpecies::text[], "acceptedSpecies"),
                     "consultModes"        = COALESCE(@ConsultModes::text[], "consultModes"),
                     "consultFeeCents"     = COALESCE(@ConsultFeeCents::int, "consultFeeCents"),
                     "emergencyAvailable"  = COALESCE(@EmergencyAvailable::boolean, "emergencyAvailable"),
                     "clinicName"          = COALESCE(@ClinicName::text, "clinicName"),
                     "clinicCity"          = COALESCE(@ClinicCity::text, "clinicCity"),
                     "clinicState"         = COALESCE(@ClinicState::text, "clinicState"),
                     "clinicPhone"         = COALESCE(@ClinicPhone::text, "clinicPhone"),
                     lat                   = COALESCE(@Lat::float8, lat),
                     lng                   = COALESCE(@Lng::float8, lng)
                 WHERE id = @id
                 RETURNING {ProfileColumnsBare}
                 """,
                new
                {
                    id, patch.Bio, patch.Specialties, patch.LicenseNumber,
                    patch.LicenseState, patch.YearsExperience, patch.AcceptedSpecies,
                    patch.ConsultModes, patch.ConsultFeeCents, patch.EmergencyAvailable,
                    patch.ClinicName, patch.ClinicCity, patch.ClinicState,
                    patch.Lat, patch.Lng, patch.ClinicPhone,
                },
                session.Transaction, cancellationToken: ct));
    }

    public async Task ReplaceAvailabilityAsync(
        string vetId, IReadOnlyList<VetAvailabilityDayEntity> availability,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """DELETE FROM vet_availability_days WHERE "vetId" = @vetId""",
            new { vetId }, session.Transaction, cancellationToken: ct));

        if (availability.Count == 0) return;

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO vet_availability_days (id, "vetId", date, slots)
            VALUES (@Id, @VetId, @Date, @Slots)
            """,
            availability, session.Transaction, cancellationToken: ct));
    }

    public async Task SetReputationAsync(
        string vetId, double? rating, int? reviewCount, int? responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE vet_profiles SET
                rating            = COALESCE(@rating::float8, rating),
                "reviewCount"     = COALESCE(@reviewCount::int, "reviewCount"),
                "responseRatePct" = COALESCE(@responseRatePct::int, "responseRatePct")
            WHERE id = @vetId
            """,
            new { vetId, rating, reviewCount, responseRatePct },
            session.Transaction, cancellationToken: ct));
    }
}
