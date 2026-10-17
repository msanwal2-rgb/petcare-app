using System.Text;
using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>adoption_listings</c> and <c>adoption_applications</c>, and
/// the one statement in the application that moves an animal between
/// households (<see cref="TransferPetAsync"/>).
/// </summary>
public sealed class AdoptionRepository(NpgsqlDataSource db) : IAdoptionRepository
{
    private const string ListingColumns = """
        l.id AS "Id", l."shelterId" AS "ShelterId", l."petId" AS "PetId", l.status AS "Status",
        l."feeCents" AS "FeeCents", l.currency AS "Currency", l.headline AS "Headline",
        l.story AS "Story", l."goodWithKids" AS "GoodWithKids", l."goodWithDogs" AS "GoodWithDogs",
        l."goodWithCats" AS "GoodWithCats", l."houseTrained" AS "HouseTrained",
        l."energyLevel" AS "EnergyLevel", l."specialNeeds" AS "SpecialNeeds",
        l."specialNeedsNotes" AS "SpecialNeedsNotes", l."spayedNeutered" AS "SpayedNeutered",
        l.microchipped AS "Microchipped", l.city AS "City", l.state AS "State",
        l.lat AS "Lat", l.lng AS "Lng", l."intakeAt" AS "IntakeAt",
        l."publishedAt" AS "PublishedAt", l."closedAt" AS "ClosedAt",
        l."createdAt" AS "CreatedAt", l."updatedAt" AS "UpdatedAt"
        """;

    private const string PetColumns = """
        p.id AS "Id", p."ownerId" AS "OwnerId", p."ownedSince" AS "OwnedSince",
        p.name AS "Name", p.species AS "Species", p.breed AS "Breed", p.sex AS "Sex",
        p.dob AS "Dob", p."weightLbs" AS "WeightLbs", p."photoUrl" AS "PhotoUrl",
        p.vaccinated AS "Vaccinated", p.allergies AS "Allergies",
        p.medications AS "Medications", p."behaviorNotes" AS "BehaviorNotes",
        p."feedingInstructions" AS "FeedingInstructions",
        p."vetName" AS "VetName", p."vetPhone" AS "VetPhone"
        """;

    private const string ApplicationColumns = """
        a.id AS "Id", a."listingId" AS "ListingId", a."shelterId" AS "ShelterId",
        a."petId" AS "PetId", a."petName" AS "PetName", a."petPhotoUrl" AS "PetPhotoUrl",
        a."applicantId" AS "ApplicantId", a.status AS "Status", a."feeCents" AS "FeeCents",
        a."householdAdults" AS "HouseholdAdults", a."householdChildren" AS "HouseholdChildren",
        a."hasOtherPets" AS "HasOtherPets", a."otherPetsNotes" AS "OtherPetsNotes",
        a."homeType" AS "HomeType", a."fencedYard" AS "FencedYard", a."ownsHome" AS "OwnsHome",
        a."hoursAlonePerDay" AS "HoursAlonePerDay", a.experience AS "Experience",
        a.message AS "Message", a."decisionNote" AS "DecisionNote",
        a."decidedAt" AS "DecidedAt", a."completedAt" AS "CompletedAt",
        a."createdAt" AS "CreatedAt", a."updatedAt" AS "UpdatedAt"
        """;

    /// <summary>Keyset conditions on <c>(createdAt, id)</c> for the two application lists.</summary>
    private const string BeforeCursor = """AND (a."createdAt", a.id) < (@cursorAt, @cursorId)""";
    private const string AfterCursor = """AND (a."createdAt", a.id) > (@cursorAt, @cursorId)""";

    private const string UserColumns = """
        u.id AS "Id", u.name AS "Name", u.email AS "Email", u.phone AS "Phone",
        u."avatarUrl" AS "AvatarUrl", u.roles AS "Roles",
        u."addressCity" AS "AddressCity", u."addressState" AS "AddressState",
        u.lat AS "Lat", u.lng AS "Lng", u.verified AS "Verified",
        u."createdAt" AS "CreatedAt", u."staffRoles" AS "StaffRoles", u.status AS "Status"
        """;

    /// <summary>Miles to where the <b>animal</b> is, which for a fostered one is not the shelter.</summary>
    private const string DistanceMiles = """
        (3959 * acos(least(1, greatest(-1,
            cos(radians(@lat)) * cos(radians(l.lat))
              * cos(radians(l.lng) - radians(@lng))
            + sin(radians(@lat)) * sin(radians(l.lat))
        ))))
        """;

    private const string ListingFrom = """
        FROM adoption_listings l
        JOIN pets p ON p.id = l."petId"
        JOIN shelter_profiles s ON s.id = l."shelterId"
        """;

    // ── Listings ─────────────────────────────────────────────────────────

    /// <summary>
    /// The directory, <b>longest-waiting first</b> whatever else is asked: one
    /// that leads with new arrivals is one where the animals who need it most
    /// are never seen. The radius filters in the statement, so it cannot shrink
    /// a page after the fact and <c>Total</c> counts what the filters describe.
    /// </summary>
    public async Task<(IReadOnlyList<ListingRow> Rows, string? NextCursor, int Total)> SearchListingsAsync(
        ListingSearchQuery query, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var hasOrigin = query.Lat is not null && query.Lng is not null;
        var limit = Math.Clamp(query.Limit, 1, 100);

        // Only what is on offer: a draft is the shelter's business and an
        // adopted animal nobody's.
        var where = new StringBuilder("WHERE l.status = 'available'");

        if (query.ShelterId is not null) where.Append("""  AND l."shelterId" = @shelterId """);
        if (query.EnergyLevel is not null) where.Append("""  AND l."energyLevel" = @energyLevel """);
        if (query.MaxFeeCents is not null) where.Append("""  AND l."feeCents" <= @maxFeeCents """);

        // A definite yes. "unknown" is not good enough for somebody asking
        // because they have a toddler.
        if (query.GoodWithKids == TriStates.Yes) where.Append("""  AND l."goodWithKids" = 'yes' """);
        if (query.GoodWithDogs == TriStates.Yes) where.Append("""  AND l."goodWithDogs" = 'yes' """);
        if (query.GoodWithCats == TriStates.Yes) where.Append("""  AND l."goodWithCats" = 'yes' """);

        if (query.Species is not null) where.Append("  AND p.species = @species ");
        if (query.Q is not null)
        {
            where.Append("""
                  AND (l.headline ILIKE @q OR l.story ILIKE @q OR p.name ILIKE @q OR p.breed ILIKE @q)
                """);
        }
        if (hasOrigin && query.RadiusMiles is not null) where.Append($"  AND {DistanceMiles} <= @radiusMiles ");

        var counted = where.ToString();

        var (cursorAt, cursorId) = Cursor.DecodeTimestamp(query.Cursor);
        if (cursorId is not null) where.Append("""  AND (l."intakeAt", l.id) > (@cursorAt, @cursorId) """);

        var distanceSelect = hasOrigin ? DistanceMiles : "NULL::float8";

        var args = new
        {
            lat = query.Lat, lng = query.Lng, radiusMiles = query.RadiusMiles,
            shelterId = query.ShelterId, energyLevel = query.EnergyLevel,
            maxFeeCents = query.MaxFeeCents, species = query.Species,
            q = query.Q is null ? null : $"%{query.Q.Trim()}%",
            cursorAt, cursorId, limitPlusOne = limit + 1,
        };

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        var rows = (await session.Connection.QueryAsync<AdoptionListingEntity, PetEntity, ListingRow, ListingRow>(
            new CommandDefinition($"""
                SELECT {ListingColumns}, {PetColumns},
                       s.name AS "ShelterName", {distanceSelect} AS "DistanceMiles"
                {ListingFrom}
                {where}
                ORDER BY l."intakeAt" ASC, l.id ASC
                LIMIT @limitPlusOne
                """, args, session.Transaction, cancellationToken: ct),
            (listing, pet, extra) => new ListingRow
            {
                Listing = listing, Pet = pet,
                ShelterName = extra.ShelterName, DistanceMiles = extra.DistanceMiles,
            },
            splitOn: "Id,ShelterName")).ToList();

        var total = await session.Connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT count(*)::int {ListingFrom} {counted}",
            args, session.Transaction, cancellationToken: ct));

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            next = Cursor.Encode(rows[^1].Listing.IntakeAt, rows[^1].Listing.Id);
        }

        return (rows, next, total);
    }

    public async Task<ListingRow?> GetListingRowAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<AdoptionListingEntity, PetEntity, ListingRow, ListingRow>(
            new CommandDefinition($"""
                SELECT {ListingColumns}, {PetColumns},
                       s.name AS "ShelterName", NULL::float8 AS "DistanceMiles"
                {ListingFrom}
                WHERE l.id = @id
                """, new { id }, session.Transaction, cancellationToken: ct),
            (listing, pet, extra) => new ListingRow { Listing = listing, Pet = pet, ShelterName = extra.ShelterName },
            splitOn: "Id,ShelterName");

        return rows.SingleOrDefault();
    }

    public async Task<AdoptionListingEntity?> GetListingAsync(
        string id, ITransactionScope? scope = null, bool forUpdate = false, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AdoptionListingEntity>(new CommandDefinition(
            $"SELECT {ListingColumns} FROM adoption_listings l WHERE l.id = @id {(forUpdate ? "FOR UPDATE" : "")}",
            new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> PetIsListedAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """SELECT EXISTS (SELECT 1 FROM adoption_listings WHERE "petId" = @petId)""",
            new { petId }, session.Transaction, cancellationToken: ct));
    }

    public async Task CreateListingAsync(
        AdoptionListingEntity listing, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO adoption_listings (
                id, "shelterId", "petId", status, "feeCents", currency, headline, story,
                "goodWithKids", "goodWithDogs", "goodWithCats", "houseTrained", "energyLevel",
                "specialNeeds", "specialNeedsNotes", "spayedNeutered", microchipped,
                city, state, lat, lng, "intakeAt", "publishedAt", "closedAt", "createdAt", "updatedAt")
            VALUES (
                @Id, @ShelterId, @PetId, @Status, @FeeCents, @Currency, @Headline, @Story,
                @GoodWithKids, @GoodWithDogs, @GoodWithCats, @HouseTrained, @EnergyLevel,
                @SpecialNeeds, @SpecialNeedsNotes, @SpayedNeutered, @Microchipped,
                @City, @State, @Lat, @Lng, @IntakeAt, @PublishedAt, @ClosedAt, @CreatedAt, @UpdatedAt)
            """,
            listing, session.Transaction, cancellationToken: ct));
    }

    public async Task UpdateListingAsync(
        string id, ListingPatch patch, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // `status` and `petId` are absent: a listing moves through its own
        // endpoint, and it is about one animal for life.
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE adoption_listings SET
                "feeCents"          = COALESCE(@FeeCents::int, "feeCents"),
                headline            = COALESCE(@Headline::text, headline),
                story               = COALESCE(@Story::text, story),
                "goodWithKids"      = COALESCE(@GoodWithKids::text, "goodWithKids"),
                "goodWithDogs"      = COALESCE(@GoodWithDogs::text, "goodWithDogs"),
                "goodWithCats"      = COALESCE(@GoodWithCats::text, "goodWithCats"),
                "houseTrained"      = COALESCE(@HouseTrained::text, "houseTrained"),
                "energyLevel"       = COALESCE(@EnergyLevel::text, "energyLevel"),
                "specialNeeds"      = COALESCE(@SpecialNeeds::boolean, "specialNeeds"),
                "specialNeedsNotes" = COALESCE(@SpecialNeedsNotes::text, "specialNeedsNotes"),
                "spayedNeutered"    = COALESCE(@SpayedNeutered::boolean, "spayedNeutered"),
                microchipped        = COALESCE(@Microchipped::boolean, microchipped),
                city                = COALESCE(@City::text, city),
                state               = COALESCE(@State::text, state),
                lat                 = COALESCE(@Lat::float8, lat),
                lng                 = COALESCE(@Lng::float8, lng),
                "intakeAt"          = COALESCE(@IntakeAt::timestamptz, "intakeAt"),
                "updatedAt"         = @now
            WHERE id = @id
            """,
            new
            {
                id, now, patch.FeeCents, patch.Headline, patch.Story, patch.GoodWithKids,
                patch.GoodWithDogs, patch.GoodWithCats, patch.HouseTrained, patch.EnergyLevel,
                patch.SpecialNeeds, patch.SpecialNeedsNotes, patch.SpayedNeutered,
                patch.Microchipped, patch.City, patch.State, patch.Lat, patch.Lng, patch.IntakeAt,
            },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> SetListingStatusAsync(
        string id, string from, string to, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var closes = to is ListingStatuses.Adopted or ListingStatuses.Withdrawn;
        var reopens = to == ListingStatuses.Available;

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var changed = await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE adoption_listings SET
                status        = @to,
                "publishedAt" = CASE WHEN @reopens AND "publishedAt" IS NULL THEN @now ELSE "publishedAt" END,
                "closedAt"    = CASE WHEN @closes THEN @now WHEN @reopens THEN NULL ELSE "closedAt" END,
                "updatedAt"   = @now
            WHERE id = @id AND status = @from
            """,
            new { id, from, to, now, closes, reopens }, session.Transaction, cancellationToken: ct));

        return changed == 1;
    }

    // ── Applications ─────────────────────────────────────────────────────

    public async Task CreateApplicationAsync(
        AdoptionApplicationEntity application, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO adoption_applications (
                id, "listingId", "shelterId", "petId", "petName", "petPhotoUrl", "applicantId",
                status, "feeCents", "householdAdults", "householdChildren", "hasOtherPets",
                "otherPetsNotes", "homeType", "fencedYard", "ownsHome", "hoursAlonePerDay",
                experience, message, "decisionNote", "decidedAt", "completedAt", "createdAt", "updatedAt")
            VALUES (
                @Id, @ListingId, @ShelterId, @PetId, @PetName, @PetPhotoUrl, @ApplicantId,
                @Status, @FeeCents, @HouseholdAdults, @HouseholdChildren, @HasOtherPets,
                @OtherPetsNotes, @HomeType, @FencedYard, @OwnsHome, @HoursAlonePerDay,
                @Experience, @Message, @DecisionNote, @DecidedAt, @CompletedAt, @CreatedAt, @UpdatedAt)
            """,
            application, session.Transaction, cancellationToken: ct));
    }

    public async Task<AdoptionApplicationEntity?> GetApplicationAsync(
        string id, ITransactionScope? scope = null, bool forUpdate = false, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AdoptionApplicationEntity>(new CommandDefinition(
            $"SELECT {ApplicationColumns} FROM adoption_applications a WHERE a.id = @id {(forUpdate ? "FOR UPDATE" : "")}",
            new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> HasOpenApplicationAsync(
        string listingId, string applicantId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """
            SELECT EXISTS (SELECT 1 FROM adoption_applications
                           WHERE "listingId" = @listingId AND "applicantId" = @applicantId
                             AND status = ANY(@open))
            """,
            new { listingId, applicantId, open = ApplicationStatuses.Open },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<string?> FindApprovedRivalAsync(
        string listingId, string exceptId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """
            SELECT id FROM adoption_applications
            WHERE "listingId" = @listingId AND status = 'approved' AND id <> @exceptId
            LIMIT 1
            """,
            new { listingId, exceptId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<AdoptionApplicationEntity?> SetApplicationStatusAsync(
        string id, string from, string to, string? note, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AdoptionApplicationEntity>(new CommandDefinition(
            $"""
             WITH a AS (
                 UPDATE adoption_applications SET
                     status         = @to,
                     "decisionNote" = COALESCE(@note::text, "decisionNote"),
                     "decidedAt"    = @now,
                     "updatedAt"    = @now
                 WHERE id = @id AND status = @from
                 RETURNING *)
             SELECT {ApplicationColumns} FROM a
             """,
            new { id, from, to, note, now }, session.Transaction, cancellationToken: ct));
    }

    public async Task<(IReadOnlyList<AdoptionApplicationEntity> Rows, string? NextCursor)> ListByApplicantAsync(
        string applicantId, string? cursor, int limit, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 100);
        var (cursorAt, cursorId) = Cursor.DecodeTimestamp(cursor);

        await using var session = await DbSession.OpenAsync(db, null, ct);
        var rows = (await session.Connection.QueryAsync<AdoptionApplicationEntity>(new CommandDefinition(
            $"""
             SELECT {ApplicationColumns} FROM adoption_applications a
             WHERE a."applicantId" = @applicantId
               {(cursorId is null ? "" : BeforeCursor)}
             ORDER BY a."createdAt" DESC, a.id DESC
             LIMIT @limitPlusOne
             """,
            new { applicantId, cursorAt, cursorId, limitPlusOne = limit + 1 },
            cancellationToken: ct))).ToList();

        return Page(rows, limit, r => Cursor.Encode(r.CreatedAt, r.Id));
    }

    /// <summary>Oldest first: it is a queue, and somebody has been waiting.</summary>
    public async Task<(IReadOnlyList<QueueRow> Rows, string? NextCursor)> ListQueueAsync(
        string shelterId, string? status, string? cursor, int limit, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 100);
        var (cursorAt, cursorId) = Cursor.DecodeTimestamp(cursor);

        await using var session = await DbSession.OpenAsync(db, null, ct);
        var rows = (await session.Connection.QueryAsync<AdoptionApplicationEntity, UserEntity, QueueRow, QueueRow>(
            new CommandDefinition($"""
                SELECT {ApplicationColumns}, {UserColumns}, pay.status AS "PaymentStatus"
                FROM adoption_applications a
                JOIN users u ON u.id = a."applicantId"
                LEFT JOIN payments pay ON pay."adoptionApplicationId" = a.id
                WHERE a."shelterId" = @shelterId
                  {(status is null ? "" : "AND a.status = @status")}
                  {(cursorId is null ? "" : AfterCursor)}
                ORDER BY a."createdAt" ASC, a.id ASC
                LIMIT @limitPlusOne
                """,
                new { shelterId, status, cursorAt, cursorId, limitPlusOne = limit + 1 },
                cancellationToken: ct),
            // An unpaid application's last segment is a single NULL, which Dapper
            // hands over as a null object rather than one with a null property.
            (application, user, extra) => new QueueRow
            {
                Application = application, Applicant = user, PaymentStatus = extra?.PaymentStatus,
            },
            splitOn: "Id,PaymentStatus")).ToList();

        return Page(rows, limit, r => Cursor.Encode(r.Application.CreatedAt, r.Application.Id));
    }

    // ── The transfer ─────────────────────────────────────────────────────

    /// <summary>
    /// Conditional on the shelter still owning the animal: the preconditions
    /// were read before this ran, and two concurrent completions can both have
    /// passed them. Under READ COMMITTED the second UPDATE waits on the first's
    /// row lock, re-reads the row, finds the owner changed and matches nothing.
    ///
    /// Moving <c>ownedSince</c> in the same statement is what severs every
    /// caretaker and vet the previous household engaged — atomically, with no
    /// list of grants to walk. The health record does not move at all: it is
    /// keyed on the pet, so it follows the animal by standing still.
    /// </summary>
    public async Task<bool> TransferPetAsync(
        string petId, string fromOwnerId, string toOwnerId, DateTimeOffset now,
        ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var moved = await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE pets SET "ownerId" = @toOwnerId, "ownedSince" = @now
            WHERE id = @petId AND "ownerId" = @fromOwnerId
            """,
            new { petId, fromOwnerId, toOwnerId, now }, session.Transaction, cancellationToken: ct));

        return moved == 1;
    }

    public async Task<(string[] BookingIds, string[] AppointmentIds)> ListLiveEngagementsAsync(
        string petId, string[] liveBookingStatuses, string[] liveAppointmentStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var bookings = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            SELECT id FROM bookings WHERE @petId = ANY("petIds") AND status = ANY(@statuses)
            ORDER BY "startDateTime", id
            """,
            new { petId, statuses = liveBookingStatuses }, session.Transaction, cancellationToken: ct));

        var appointments = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            SELECT id FROM vet_appointments WHERE "petId" = @petId AND status = ANY(@statuses)
            ORDER BY "startDateTime", id
            """,
            new { petId, statuses = liveAppointmentStatuses }, session.Transaction, cancellationToken: ct));

        return ([.. bookings], [.. appointments]);
    }

    public async Task CompleteApplicationAsync(
        string id, DateTimeOffset now, ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE adoption_applications
            SET status = 'completed', "completedAt" = @now, "updatedAt" = @now
            WHERE id = @id
            """,
            new { id, now }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<string>> CloseRivalsAsync(
        string listingId, string exceptId, string note, DateTimeOffset now,
        ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var closed = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            UPDATE adoption_applications
            SET status = 'rejected', "decisionNote" = @note, "decidedAt" = @now, "updatedAt" = @now
            WHERE "listingId" = @listingId AND id <> @exceptId AND status = ANY(@open)
            RETURNING "applicantId"
            """,
            new { listingId, exceptId, note, now, open = ApplicationStatuses.Open },
            session.Transaction, cancellationToken: ct));

        return [.. closed];
    }

    public async Task ReverseApplicationAsync(
        string id, string reason, DateTimeOffset now, ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE adoption_applications
            SET status = 'rejected', "decisionNote" = @reason, "completedAt" = NULL, "updatedAt" = @now
            WHERE id = @id
            """,
            new { id, reason, now }, session.Transaction, cancellationToken: ct));
    }

    private static (IReadOnlyList<T> Rows, string? NextCursor) Page<T>(
        List<T> rows, int limit, Func<T, string> cursorOf)
    {
        if (rows.Count <= limit) return (rows, null);
        rows.RemoveAt(rows.Count - 1);
        return (rows, cursorOf(rows[^1]));
    }
}
