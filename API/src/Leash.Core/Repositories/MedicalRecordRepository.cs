using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>medical_records</c>.
/// </summary>
public sealed class MedicalRecordRepository(NpgsqlDataSource db) : IMedicalRecordRepository
{
    private const string Columns = """
        id AS "Id", "petId" AS "PetId", "appointmentId" AS "AppointmentId",
        "vetId" AS "VetId", "authorUserId" AS "AuthorUserId", type AS "Type",
        title AS "Title", details AS "Details", "occurredAt" AS "OccurredAt",
        "nextDueAt" AS "NextDueAt", "medicationName" AS "MedicationName",
        dosage AS "Dosage", "refillsLeft" AS "RefillsLeft",
        "expiresAt" AS "ExpiresAt", "productSlugs" AS "ProductSlugs",
        "createdAt" AS "CreatedAt"
        """;

    /// <summary>
    /// <b>The</b> definition of an active prescription (REQUIREMENTS.md P7, P8).
    ///
    /// Written once, as a SQL fragment, and interpolated into the two queries
    /// that need it. It is a <c>const</c> rather than a helper method so that
    /// there is no way to call one of those queries with a subtly different
    /// version of the rule — the only thing a caller can vary is the pet and the
    /// instant.
    ///
    /// Read it as three independent conditions:
    ///   • it is a prescription at all;
    ///   • it has not expired — and no expiry set means it never does;
    ///   • its refills are not used up — and no limit set means they never are.
    ///
    /// <c>IS DISTINCT FROM 0</c> rather than <c>&lt;&gt; 0</c> on the last one,
    /// because <c>NULL &lt;&gt; 0</c> is NULL, which would silently drop every
    /// prescription the vet put no refill limit on.
    /// </summary>
    private const string ActivePrescription = """
        type = 'prescription'
          AND ("expiresAt" IS NULL OR "expiresAt" > @asOf)
          AND "refillsLeft" IS DISTINCT FROM 0
        """;

    public async Task<IReadOnlyList<MedicalRecordEntity>> ListForPetAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<MedicalRecordEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM medical_records
                 WHERE "petId" = @petId
                 ORDER BY "occurredAt" DESC, id DESC
                 """,
                new { petId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<MedicalRecordEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<MedicalRecordEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM medical_records WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<MedicalRecordEntity> CreateAsync(
        MedicalRecordEntity record,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<MedicalRecordEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO medical_records (
                     id, "petId", "appointmentId", "vetId", "authorUserId", type,
                     title, details, "occurredAt", "nextDueAt", "medicationName",
                     dosage, "refillsLeft", "expiresAt", "productSlugs", "createdAt")
                 VALUES (
                     @Id, @PetId, @AppointmentId, @VetId, @AuthorUserId, @Type,
                     @Title, @Details, @OccurredAt, @NextDueAt, @MedicationName,
                     @Dosage, @RefillsLeft, @ExpiresAt, @ProductSlugs, @CreatedAt)
                 RETURNING {Columns}
                 """,
                record, session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> DeleteAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.ExecuteAsync(
            new CommandDefinition(
                "DELETE FROM medical_records WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));

        return rows > 0;
    }

    public async Task<IReadOnlyList<MedicalRecordEntity>> ListActivePrescriptionsAsync(
        string petId, DateTimeOffset asOf,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<MedicalRecordEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM medical_records
                 WHERE "petId" = @petId
                   AND {ActivePrescription}
                 ORDER BY "occurredAt" DESC, id DESC
                 """,
                new { petId, asOf }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<string>> ListAuthorizedProductSlugsAsync(
        string petId, DateTimeOffset asOf,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var slugs = await session.Connection.QueryAsync<string>(
            new CommandDefinition(
                $"""
                 SELECT DISTINCT unnest("productSlugs") AS slug
                 FROM medical_records
                 WHERE "petId" = @petId
                   AND {ActivePrescription}
                 """,
                new { petId, asOf }, session.Transaction, cancellationToken: ct));

        return slugs.Order(StringComparer.Ordinal).ToList();
    }
}
