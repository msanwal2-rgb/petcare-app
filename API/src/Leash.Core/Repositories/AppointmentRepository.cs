using System.Text;
using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper over <c>vet_appointments</c>.</summary>
public sealed class AppointmentRepository(NpgsqlDataSource db) : IAppointmentRepository
{
    private const string Columns = """
        id AS "Id", "ownerId" AS "OwnerId", "vetId" AS "VetId", "petId" AS "PetId",
        mode AS "Mode", reason AS "Reason", symptoms AS "Symptoms",
        "startDateTime" AS "StartDateTime", "endDateTime" AS "EndDateTime",
        status AS "Status", notes AS "Notes", "createdAt" AS "CreatedAt",
        "baseFeeCents" AS "BaseFeeCents", "discountPct" AS "DiscountPct",
        priority AS "Priority", "feeCents" AS "FeeCents"
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

    public async Task<VetAppointmentEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM vet_appointments WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByOwnerAsync(
        string ownerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListAsync("\"ownerId\"", ownerId, cursor, limit, scope, ct);

    public Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByVetAsync(
        string vetId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListAsync("\"vetId\"", vetId, cursor, limit, scope, ct);

    /// <summary>
    /// Newest first, keyset-paginated on <c>(startDateTime, id)</c>.
    ///
    /// Sorted by when the visit <i>is</i>, not when it was booked — which is
    /// what both audiences want: an owner looking at "my appointments" and a
    /// clinic looking at its schedule are both asking about the calendar.
    /// (Bookings sort by <c>createdAt</c>, because a caretaker's queue is a
    /// queue of requests to answer.) The id tie-break is load-bearing rather
    /// than tidy: the seed writes appointments sharing a start time, and a
    /// cursor on the timestamp alone would skip every row on the boundary.
    ///
    /// <paramref name="column"/> is one of two compile-time literals from the
    /// two callers above, never anything a request supplies — the one place in
    /// this file where SQL is assembled from a string rather than a parameter.
    /// </summary>
    private async Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListAsync(
        string column, string value, string? cursor, int limit,
        ITransactionScope? scope, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 100);

        var (cursorStart, cursorId) = Cursor.DecodeTimestamp(cursor);

        var where = new StringBuilder($"WHERE {column} = @value");
        if (cursorId is not null)
            where.Append(""" AND ("startDateTime", id) < (@cursorStart, @cursorId)""");

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM vet_appointments
                 {where}
                 ORDER BY "startDateTime" DESC, id DESC
                 LIMIT @limitPlusOne
                 """,
                new { value, cursorStart, cursorId, limitPlusOne = limit + 1 },
                session.Transaction, cancellationToken: ct))).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            nextCursor = Cursor.Encode(rows[^1].StartDateTime, rows[^1].Id);
        }

        return (rows, nextCursor);
    }

    public Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByOwnerInWindowAsync(
        string ownerId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListWindowAsync("\"ownerId\"", ownerId, window, cursor, limit, scope, ct);

    public Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByVetInWindowAsync(
        string vetId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListWindowAsync("\"vetId\"", vetId, window, cursor, limit, scope, ct);

    private async Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListWindowAsync(
        string column, string value, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 100);
        var (where, parameters) = ScheduleWindowSql.Build(column, value, window, cursor, limit);

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM vet_appointments
                 {where}
                 {ScheduleWindowSql.OrderBy}
                 """,
                parameters, session.Transaction, cancellationToken: ct))).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            nextCursor = Cursor.Encode(rows[^1].StartDateTime, rows[^1].Id);
        }

        return (rows, nextCursor);
    }

    public async Task<VetAppointmentEntity?> RescheduleAsync(
        string id, DateTimeOffset startDateTime, DateTimeOffset endDateTime,
        IReadOnlyCollection<string> fromStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"""
                 UPDATE vet_appointments
                 SET "startDateTime" = @startDateTime, "endDateTime" = @endDateTime
                 WHERE id = @id AND status = ANY(@fromStatuses)
                 RETURNING {Columns}
                 """,
                new { id, startDateTime, endDateTime, fromStatuses = fromStatuses.ToArray() },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<VetAppointmentEntity> CreateAsync(
        VetAppointmentEntity appointment,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO vet_appointments (
                     id, "ownerId", "vetId", "petId", mode, reason, symptoms,
                     "startDateTime", "endDateTime", status, notes, "createdAt",
                     "baseFeeCents", "discountPct", priority, "feeCents")
                 VALUES (
                     @Id, @OwnerId, @VetId, @PetId, @Mode, @Reason, @Symptoms,
                     @StartDateTime, @EndDateTime, @Status, @Notes, @CreatedAt,
                     @BaseFeeCents, @DiscountPct, @Priority, @FeeCents)
                 RETURNING {Columns}
                 """,
                appointment, session.Transaction, cancellationToken: ct));
    }

    public async Task<VetAppointmentEntity?> UpdateStatusAsync(
        string id, string status,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VetAppointmentEntity>(
            new CommandDefinition(
                $"UPDATE vet_appointments SET status = @status WHERE id = @id RETURNING {Columns}",
                new { id, status }, session.Transaction, cancellationToken: ct));
    }

    public async Task<RequestCounts> CountRequestsAsync(
        string vetId, IReadOnlyCollection<string> answered, string waiting,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Both counts in one round trip. ::int because count(*) is bigint.
        return await session.Connection.QuerySingleAsync<RequestCounts>(
            new CommandDefinition(
                """
                SELECT
                    count(*) FILTER (WHERE status = ANY(@answered))::int AS "Answered",
                    count(*) FILTER (WHERE status = @waiting)::int        AS "Waiting"
                FROM vet_appointments
                WHERE "vetId" = @vetId
                """,
                new { vetId, answered = answered.ToArray(), waiting },
                session.Transaction, cancellationToken: ct));
    }
}
