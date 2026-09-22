using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>pets</c>. The SQL lives here and nowhere else.
/// </summary>
public sealed class PetRepository(NpgsqlDataSource db) : IPetRepository
{
    /// <summary>
    /// Spelled out, never <c>SELECT *</c>. <c>ownedSince</c> is included
    /// deliberately — the entity carries it for the authorization predicates —
    /// and just as deliberately absent from <see cref="Models.Dtos.PetDto"/>.
    /// </summary>
    private const string Columns = """
        id AS "Id", "ownerId" AS "OwnerId", "ownedSince" AS "OwnedSince",
        name AS "Name", species AS "Species", breed AS "Breed", sex AS "Sex",
        dob AS "Dob", "weightLbs" AS "WeightLbs", "photoUrl" AS "PhotoUrl",
        vaccinated AS "Vaccinated", allergies AS "Allergies",
        medications AS "Medications", "behaviorNotes" AS "BehaviorNotes",
        "feedingInstructions" AS "FeedingInstructions",
        "vetName" AS "VetName", "vetPhone" AS "VetPhone"
        """;

    public async Task<PetEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PetEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM pets WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<PetEntity>> ListByOwnerAsync(
        string ownerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<PetEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM pets
                 WHERE "ownerId" = @ownerId
                 ORDER BY name ASC, id ASC
                 """,
                new { ownerId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<PetEntity>> GetManyAsync(
        IReadOnlyCollection<string> ids,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        // No round trip for an empty list. `= ANY('{}')` is a correct and empty
        // answer, but asking the database to confirm it is pure latency.
        if (ids.Count == 0) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<PetEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM pets
                 WHERE id = ANY(@ids)
                 ORDER BY name ASC, id ASC
                 """,
                new { ids = ids.ToArray() }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<PetEntity> CreateAsync(
        PetEntity pet, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<PetEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO pets (
                     id, "ownerId", "ownedSince", name, species, breed, sex, dob,
                     "weightLbs", "photoUrl", vaccinated, allergies, medications,
                     "behaviorNotes", "feedingInstructions", "vetName", "vetPhone")
                 VALUES (
                     @Id, @OwnerId, @OwnedSince, @Name, @Species, @Breed, @Sex, @Dob,
                     @WeightLbs, @PhotoUrl, @Vaccinated, @Allergies, @Medications,
                     @BehaviorNotes, @FeedingInstructions, @VetName, @VetPhone)
                 RETURNING {Columns}
                 """,
                pet, session.Transaction, cancellationToken: ct));
    }

    /// <summary>
    /// A partial update expressed once, in SQL, rather than as a hand-built
    /// column list per call.
    ///
    /// <c>COALESCE(@x, column)</c> writes the parameter when it was sent and
    /// re-writes the existing value when it was not. That is what makes a patch
    /// of one field leave the other thirteen alone without the repository
    /// branching on which of 2^14 combinations arrived.
    ///
    /// The trade this makes: a column can never be patched <i>to</i> NULL,
    /// because NULL is how "absent" is spelled. Every column here is NOT NULL,
    /// so there is nothing to express that way — but a nullable column added
    /// later cannot join this statement without a second mechanism.
    /// </summary>
    public async Task<PetEntity?> UpdateAsync(
        string id, PetPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PetEntity>(
            new CommandDefinition(
                $"""
                 UPDATE pets SET
                     name                  = COALESCE(@Name::text, name),
                     species               = COALESCE(@Species::text, species),
                     breed                 = COALESCE(@Breed::text, breed),
                     sex                   = COALESCE(@Sex::text, sex),
                     dob                   = COALESCE(@Dob::date, dob),
                     "weightLbs"           = COALESCE(@WeightLbs::int, "weightLbs"),
                     "photoUrl"            = COALESCE(@PhotoUrl::text, "photoUrl"),
                     vaccinated            = COALESCE(@Vaccinated::boolean, vaccinated),
                     allergies             = COALESCE(@Allergies::text[], allergies),
                     medications           = COALESCE(@Medications::text[], medications),
                     "behaviorNotes"       = COALESCE(@BehaviorNotes::text, "behaviorNotes"),
                     "feedingInstructions" = COALESCE(@FeedingInstructions::text, "feedingInstructions"),
                     "vetName"             = COALESCE(@VetName::text, "vetName"),
                     "vetPhone"            = COALESCE(@VetPhone::text, "vetPhone")
                 WHERE id = @id
                 RETURNING {Columns}
                 """,
                // The `::type` casts above are load-bearing, not tidiness. Dapper
                // sends an absent property as an untyped NULL, and PostgreSQL
                // answers "could not determine data type of parameter" rather
                // than guessing — so a patch that omits `allergies` fails
                // outright without them.
                new
                {
                    id,
                    patch.Name, patch.Species, patch.Breed, patch.Sex, patch.Dob,
                    patch.WeightLbs, patch.PhotoUrl, patch.Vaccinated,
                    patch.Allergies, patch.Medications, patch.BehaviorNotes,
                    patch.FeedingInstructions, patch.VetName, patch.VetPhone,
                },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> DeleteAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.ExecuteAsync(
            new CommandDefinition(
                "DELETE FROM pets WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));

        return rows > 0;
    }

    public async Task<PetHistoryCounts> CountHistoryAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<PetHistoryCounts>(
            new CommandDefinition(
                // ::int on both, because count(*) is bigint and the properties
                // are int — Dapper would otherwise fail to materialise the row.
                """
                SELECT
                    (SELECT count(*) FROM medical_records  WHERE "petId" = @id)::int AS "MedicalRecords",
                    (SELECT count(*) FROM vet_appointments WHERE "petId" = @id)::int AS "Appointments"
                """,
                new { id }, session.Transaction, cancellationToken: ct));
    }
}
