using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class NotificationRepository(NpgsqlDataSource db) : INotificationRepository
{
    private const string Columns = """
        id AS "Id", "userId" AS "UserId", kind AS "Kind", title AS "Title",
        body AS "Body", href AS "Href", "readAt" AS "ReadAt",
        "createdAt" AS "CreatedAt", seq AS "Seq"
        """;

    public async Task<NotificationEntity?> InsertAsync(
        NotificationEntity n, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<NotificationEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO notifications (id, "userId", kind, title, body, href, "readAt", "createdAt")
                 SELECT @Id, @UserId, @Kind, @Title, @Body, @Href, NULL, @CreatedAt
                 WHERE EXISTS (SELECT 1 FROM users WHERE id = @UserId)
                 RETURNING {Columns}
                 """,
                n, session.Transaction, cancellationToken: ct));
    }

    public async Task EnqueueAsync(
        string notificationId, IReadOnlyCollection<string> channels, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (channels.Count == 0) return;

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Parallel arrays rather than one INSERT per channel: one round trip,
        // and the ids are still minted by Ids.New like every other row.
        var channelArray = channels.ToArray();
        var ids = channelArray.Select(_ => Ids.New("nd")).ToArray();

        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO notification_outbox
              (id, "notificationId", channel, status, attempts, "nextAttemptAt", "createdAt")
            SELECT d.id, @notificationId, d.channel, @pending, 0, @at, @at
            FROM unnest(@ids, @channels) AS d(id, channel)
            ON CONFLICT ("notificationId", channel) DO NOTHING
            """,
            new { notificationId, ids, channels = channelArray, at, pending = OutboxStatuses.Pending },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<NotificationEntity>> ListForUserAsync(
        string userId, DateTimeOffset? beforeAt, long? beforeSeq, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Row comparison on (createdAt, seq): strictly older than the last row
        // of the previous page, ties broken by seq. Ids would not do — they are
        // random, and a catch-up fulfilment run writes several in one instant.
        var rows = await session.Connection.QueryAsync<NotificationEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM notifications
                 WHERE "userId" = @userId
                   AND (@beforeAt::timestamptz IS NULL OR ("createdAt", seq) < (@beforeAt, @beforeSeq))
                 ORDER BY "createdAt" DESC, seq DESC
                 LIMIT @take
                 """,
                new { userId, beforeAt, beforeSeq = beforeSeq ?? 0, take = limit + 1 },
                session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<int> CountUnreadAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """SELECT count(*)::int FROM notifications WHERE "userId" = @userId AND "readAt" IS NULL""",
            new { userId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<int> MarkReadAsync(
        string userId, IReadOnlyCollection<string> ids, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (ids.Count == 0) return 0;

        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Scoped by userId as well as id — you can only clear your own.
        return await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE notifications SET "readAt" = @at
            WHERE "userId" = @userId AND id = ANY(@ids) AND "readAt" IS NULL
            """,
            new { userId, ids = ids.ToArray(), at }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<OutboxDeliveryEntity>> ClaimDueAsync(
        DateTimeOffset now, DateTimeOffset leaseExpiredBefore, int limit, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);

        // One statement: pick, lock, stamp, and return what delivery needs.
        // SKIP LOCKED makes concurrent drains take disjoint rows rather than
        // queue behind each other; the lease (lockedAt) is what lets a row whose
        // drain died be picked up again later.
        var rows = await conn.QueryAsync<OutboxDeliveryEntity>(new CommandDefinition(
            """
            WITH due AS (
              SELECT id FROM notification_outbox
              WHERE status = @pending
                AND "nextAttemptAt" <= @now
                AND ("lockedAt" IS NULL OR "lockedAt" < @leaseExpiredBefore)
              ORDER BY "nextAttemptAt", id
              LIMIT @limit
              FOR UPDATE SKIP LOCKED
            ), claimed AS (
              UPDATE notification_outbox o
              SET "lockedAt" = @now, attempts = o.attempts + 1
              FROM due WHERE o.id = due.id
              RETURNING o.id, o."notificationId", o.channel, o.attempts, o."lockedAt"
            )
            SELECT c.id AS "Id", c.channel AS "Channel", c.attempts AS "Attempts",
                   c."lockedAt" AS "LockedAt",
                   n.id AS "NotificationId", n.kind AS "Kind", n.title AS "Title",
                   n.body AS "Body", n.href AS "Href",
                   u.email AS "RecipientEmail", u.name AS "RecipientName",
                   u.status AS "RecipientStatus"
            FROM claimed c
            JOIN notifications n ON n.id = c."notificationId"
            JOIN users u ON u.id = n."userId"
            """,
            new { now, leaseExpiredBefore, limit, pending = OutboxStatuses.Pending },
            cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<bool> CompleteAsync(
        string id, DateTimeOffset lockedAt, string status, DateTimeOffset? sentAt, string? error,
        CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE notification_outbox
            SET status = @status, "sentAt" = @sentAt, "lastError" = @error, "lockedAt" = NULL
            WHERE id = @id AND "lockedAt" = @lockedAt AND status = @pending
            """,
            new { id, lockedAt, status, sentAt, error, pending = OutboxStatuses.Pending },
            cancellationToken: ct)) == 1;
    }

    public async Task<bool> RescheduleAsync(
        string id, DateTimeOffset lockedAt, DateTimeOffset nextAttemptAt, string error,
        CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE notification_outbox
            SET "nextAttemptAt" = @nextAttemptAt, "lastError" = @error, "lockedAt" = NULL
            WHERE id = @id AND "lockedAt" = @lockedAt AND status = @pending
            """,
            new { id, lockedAt, nextAttemptAt, error, pending = OutboxStatuses.Pending },
            cancellationToken: ct)) == 1;
    }
}
