using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper over <c>vet_appointments</c>. M3 reads; M5 will write.</summary>
public sealed class AppointmentRepository(NpgsqlDataSource db) : IAppointmentRepository
{
    private const string Columns = """
        id AS "Id", "ownerId" AS "OwnerId", "vetId" AS "VetId", "petId" AS "PetId",
        mode AS "Mode", reason AS "Reason", symptoms AS "Symptoms",
        "startDateTime" AS "StartDateTime", "endDateTime" AS "EndDateTime",
        status AS "Status", notes AS "Notes", "createdAt" AS "CreatedAt",
        "feeCents" AS "FeeCents"
        """;

    public async Task<IReadOnlyList<VetAppointmentEntity>> ListForPetAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM vet_appointments
                 WHERE "petId" = @petId
                 ORDER BY "startDateTime" DESC, id DESC
                 """,
                new { petId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }
}
