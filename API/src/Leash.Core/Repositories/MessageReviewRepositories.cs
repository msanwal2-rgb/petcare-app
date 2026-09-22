using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class MessageRepository(NpgsqlDataSource db) : IMessageRepository
{
    private const string Columns = """
        id AS "Id", "bookingId" AS "BookingId", "fromUserId" AS "FromUserId",
        body AS "Body", "createdAt" AS "CreatedAt", "readAt" AS "ReadAt"
        """;

    public async Task<IReadOnlyList<MessageEntity>> ListForBookingAsync(
        string bookingId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Oldest first: a conversation reads downward.
        var rows = await session.Connection.QueryAsync<MessageEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM messages
                 WHERE "bookingId" = @bookingId
                 ORDER BY "createdAt" ASC, id ASC
                 """,
                new { bookingId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<MessageEntity> CreateAsync(
        MessageEntity message, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<MessageEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO messages (id, "bookingId", "fromUserId", body, "createdAt", "readAt")
                 VALUES (@Id, @BookingId, @FromUserId, @Body, @CreatedAt, @ReadAt)
                 RETURNING {Columns}
                 """,
                message, session.Transaction, cancellationToken: ct));
    }

    public async Task<int> MarkReadAsync(
        string bookingId, string readerId, DateTimeOffset readAt,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Everything on this booking that the reader did not send and has not
        // already been marked. Not their own: you do not read your own message,
        // and stamping it would make "unread by them" unanswerable.
        return await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE messages SET "readAt" = @readAt
            WHERE "bookingId" = @bookingId
              AND "fromUserId" <> @readerId
              AND "readAt" IS NULL
            """,
            new { bookingId, readerId, readAt },
            session.Transaction, cancellationToken: ct));
    }
}

public sealed class ReviewRepository(NpgsqlDataSource db) : IReviewRepository
{
    private const string Columns = """
        id AS "Id", "bookingId" AS "BookingId", kind AS "Kind",
        "fromUserId" AS "FromUserId", "toUserId" AS "ToUserId",
        rating AS "Rating", comment AS "Comment", "createdAt" AS "CreatedAt"
        """;

    public async Task<IReadOnlyList<ReviewEntity>> ListForSubjectAsync(
        string subjectId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<ReviewEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM reviews
                 WHERE "bookingId" = @subjectId
                 ORDER BY "createdAt" DESC, id DESC
                 """,
                new { subjectId }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<ReviewEntity>> ListForUserAsync(
        string userId, string? kind,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // @kind is NULL when unfiltered, and `@kind::text IS NULL OR …` keeps
        // that as one statement rather than two near-identical ones.
        var rows = await session.Connection.QueryAsync<ReviewEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM reviews
                 WHERE "toUserId" = @userId
                   AND (@kind::text IS NULL OR kind = @kind)
                 ORDER BY "createdAt" DESC, id DESC
                 """,
                new { userId, kind }, session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<ReviewEntity?> FindByAuthorAsync(
        string subjectId, string fromUserId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<ReviewEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM reviews
                 WHERE "bookingId" = @subjectId AND "fromUserId" = @fromUserId
                 LIMIT 1
                 """,
                new { subjectId, fromUserId },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<ReviewEntity> CreateAsync(
        ReviewEntity review, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<ReviewEntity>(
            new CommandDefinition(
                $"""
                 INSERT INTO reviews (
                     id, "bookingId", kind, "fromUserId", "toUserId", rating,
                     comment, "createdAt")
                 VALUES (
                     @Id, @BookingId, @Kind, @FromUserId, @ToUserId, @Rating,
                     @Comment, @CreatedAt)
                 RETURNING {Columns}
                 """,
                review, session.Transaction, cancellationToken: ct));
    }
}
