using System.Globalization;
using System.Text;
using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class BookingRepository(NpgsqlDataSource db) : IBookingRepository
{
    private const string Columns = """
        id AS "Id", "ownerId" AS "OwnerId", "caretakerId" AS "CaretakerId",
        "petIds" AS "PetIds", "serviceType" AS "ServiceType",
        "startDateTime" AS "StartDateTime", "endDateTime" AS "EndDateTime",
        notes AS "Notes", status AS "Status", "createdAt" AS "CreatedAt",
        "priceTotalCents" AS "PriceTotalCents"
        """;

    public async Task<BookingEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<BookingEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM bookings WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByOwnerAsync(
        string ownerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListAsync("\"ownerId\"", ownerId, cursor, limit, scope, ct);

    public Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByCaretakerAsync(
        string caretakerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => ListAsync("\"caretakerId\"", caretakerId, cursor, limit, scope, ct);

    /// <summary>
    /// Newest first, keyset-paginated on <c>(createdAt, id)</c>.
    ///
    /// The id tie-break is load-bearing rather than tidy: the seed writes
    /// several bookings with the same <c>createdAt</c>, and a cursor on the
    /// timestamp alone would skip every row sharing the boundary value.
    ///
    /// <paramref name="column"/> is one of two compile-time literals from the
    /// two callers above, never anything a request supplies — the one place in
    /// this file where SQL is assembled from a string rather than a parameter.
    /// </summary>
    private async Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListAsync(
        string column, string value, string? cursor, int limit,
        ITransactionScope? scope, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 100);

        var (cursorCreatedAt, cursorId) = DecodeCursor(cursor);

        var where = new StringBuilder($"WHERE {column} = @value");
        if (cursorId is not null)
            where.Append(""" AND ("createdAt", id) < (@cursorCreatedAt, @cursorId)""");

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = (await session.Connection.QueryAsync<BookingEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM bookings
                 {where}
                 ORDER BY "createdAt" DESC, id DESC
                 LIMIT @limitPlusOne
                 """,
                new { value, cursorCreatedAt, cursorId, limitPlusOne = limit + 1 },
                session.Transaction, cancellationToken: ct))).ToList();

        string? nextCursor = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            nextCursor = EncodeCursor(rows[^1].CreatedAt, rows[^1].Id);
        }

        return (rows, nextCursor);
    }

    public async Task<BookingEntity> CreateAsync(
        BookingEntity booking, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<BookingEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO bookings (
                     id, "ownerId", "caretakerId", "petIds", "serviceType",
                     "startDateTime", "endDateTime", notes, status, "createdAt",
                     "priceTotalCents")
                 VALUES (
                     @Id, @OwnerId, @CaretakerId, @PetIds, @ServiceType,
                     @StartDateTime, @EndDateTime, @Notes, @Status, @CreatedAt,
                     @PriceTotalCents)
                 RETURNING {Columns}
                 """,
                booking, session.Transaction, cancellationToken: ct));
    }

    public async Task<BookingEntity?> UpdateStatusAsync(
        string id, string status,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<BookingEntity>(
            new CommandDefinition(
                $"UPDATE bookings SET status = @status WHERE id = @id RETURNING {Columns}",
                new { id, status }, session.Transaction, cancellationToken: ct));
    }

    public async Task<RequestCounts> CountRequestsAsync(
        string caretakerId, IReadOnlyCollection<string> answered, string waiting,
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
                FROM bookings
                WHERE "caretakerId" = @caretakerId
                """,
                new { caretakerId, answered = answered.ToArray(), waiting },
                session.Transaction, cancellationToken: ct));
    }

    private static string EncodeCursor(DateTimeOffset createdAt, string id)
    {
        var raw = $"{createdAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)}|{id}";
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(raw))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// <summary>Anything unparseable means "start from the beginning".</summary>
    private static (DateTimeOffset? CreatedAt, string? Id) DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return (null, null);

        try
        {
            var padded = cursor.Replace('-', '+').Replace('_', '/')
                .PadRight((cursor.Length + 3) / 4 * 4, '=');
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(padded));

            var split = raw.IndexOf('|');
            if (split <= 0) return (null, null);

            return DateTimeOffset.TryParse(
                raw[..split], CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var createdAt)
                ? (createdAt, raw[(split + 1)..])
                : (null, null);
        }
        catch (FormatException)
        {
            return (null, null);
        }
    }
}
