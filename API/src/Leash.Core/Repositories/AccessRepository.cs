using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over the five tables the authorization predicates read. Every query
/// here is a primary-key or unique-index lookup of one or two columns, or an
/// indexed existence check — see <see cref="IAccessRepository"/> for why they
/// are not borrowed from the feature repositories.
///
/// Note the quoted camelCase identifiers throughout. The schema came from
/// Prisma, so the columns really are <c>"ownerId"</c> and <c>"createdAt"</c>;
/// unquoted, PostgreSQL folds them to lowercase and the query fails to find
/// them (ARCHITECTURE.md section 9).
/// </summary>
public sealed class AccessRepository(NpgsqlDataSource db) : IAccessRepository
{
    public async Task<PetOwnershipEntity?> GetPetOwnershipAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PetOwnershipEntity>(
            new CommandDefinition(
                """
                SELECT "ownerId" AS "OwnerId", "ownedSince" AS "OwnedSince"
                FROM pets WHERE id = @petId
                """,
                new { petId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<BookingParticipantsEntity?> GetBookingParticipantsAsync(
        string bookingId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<BookingParticipantsEntity>(
            new CommandDefinition(
                """
                SELECT "ownerId" AS "OwnerId", "caretakerId" AS "CaretakerId"
                FROM bookings WHERE id = @bookingId
                """,
                new { bookingId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<AppointmentParticipantsEntity?> GetAppointmentParticipantsAsync(
        string appointmentId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AppointmentParticipantsEntity>(
            new CommandDefinition(
                """
                SELECT "ownerId" AS "OwnerId", "vetId" AS "VetId"
                FROM vet_appointments WHERE id = @appointmentId
                """,
                new { appointmentId }, session.Transaction, cancellationToken: ct));
    }

    public Task<string?> GetCaretakerProfileUserIdAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default)
        => ScalarAsync(
            """SELECT "userId" FROM caretaker_profiles WHERE id = @id""",
            caretakerId, scope, ct);

    public Task<string?> GetVetProfileUserIdAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default)
        => ScalarAsync(
            """SELECT "userId" FROM vet_profiles WHERE id = @id""",
            vetId, scope, ct);

    public Task<string?> GetShelterProfileUserIdAsync(
        string shelterId, ITransactionScope? scope = null, CancellationToken ct = default)
        => ScalarAsync(
            """SELECT "userId" FROM shelter_profiles WHERE id = @id""",
            shelterId, scope, ct);

    public Task<string?> GetCaretakerProfileIdForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
        => ScalarAsync(
            """SELECT id FROM caretaker_profiles WHERE "userId" = @id""",
            userId, scope, ct);

    public Task<string?> GetVetProfileIdForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
        => ScalarAsync(
            """SELECT id FROM vet_profiles WHERE "userId" = @id""",
            userId, scope, ct);

    /// <summary>
    /// <c>@petId = ANY("petIds")</c> rather than a join: <c>bookings."petIds"</c>
    /// is a <c>text[]</c>, one booking covering several animals. The column is
    /// nullable, and <c>= ANY(NULL)</c> is NULL rather than true — which is the
    /// answer this check wants from a booking that names no pets.
    /// </summary>
    public async Task<bool> HasQualifyingBookingAsync(
        string caretakerId, string petId, DateTimeOffset ownedSince,
        IReadOnlyCollection<string> disqualifyingStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var found = await session.Connection.ExecuteScalarAsync<int?>(
            new CommandDefinition(
                """
                SELECT 1 FROM bookings
                WHERE "caretakerId" = @caretakerId
                  AND @petId = ANY("petIds")
                  AND status <> ALL(@disqualifyingStatuses)
                  AND "createdAt" >= @ownedSince
                LIMIT 1
                """,
                new
                {
                    caretakerId,
                    petId,
                    ownedSince,
                    disqualifyingStatuses = disqualifyingStatuses.ToArray(),
                },
                session.Transaction, cancellationToken: ct));

        return found is not null;
    }

    public async Task<bool> HasQualifyingAppointmentAsync(
        string vetId, string petId, DateTimeOffset ownedSince,
        IReadOnlyCollection<string> disqualifyingStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var found = await session.Connection.ExecuteScalarAsync<int?>(
            new CommandDefinition(
                """
                SELECT 1 FROM vet_appointments
                WHERE "vetId" = @vetId
                  AND "petId" = @petId
                  AND status <> ALL(@disqualifyingStatuses)
                  AND "createdAt" >= @ownedSince
                LIMIT 1
                """,
                new
                {
                    vetId,
                    petId,
                    ownedSince,
                    disqualifyingStatuses = disqualifyingStatuses.ToArray(),
                },
                session.Transaction, cancellationToken: ct));

        return found is not null;
    }

    /// <summary>
    /// The five single-column lookups above, which differ only in their SQL and
    /// all take one <c>@id</c>. Written once so a reader checking them for a
    /// copy-paste slip — the wrong table, the wrong column — has one query each
    /// to read rather than five near-identical method bodies.
    /// </summary>
    private async Task<string?> ScalarAsync(
        string sql, string id, ITransactionScope? scope, CancellationToken ct)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<string?>(
            new CommandDefinition(
                sql, new { id }, session.Transaction, cancellationToken: ct));
    }
}
