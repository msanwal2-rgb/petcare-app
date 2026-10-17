using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class VerificationTokenRepository(NpgsqlDataSource db)
    : IVerificationTokenRepository
{
    public async Task CreateAsync(
        string id, string identifier, string tokenHash, string type,
        DateTimeOffset expiresAt, DateTimeOffset createdAt,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        // Two statements that must not come apart, so when the caller has not
        // supplied a transaction this opens one of its own.
        if (scope is null)
        {
            await using var owned = await new UnitOfWork(db).BeginAsync(ct);
            await CreateAsync(id, identifier, tokenHash, type, expiresAt, createdAt, owned, ct);
            await owned.CommitAsync(ct);
            return;
        }

        // Invalidate any prior token of this type for this identifier. Without
        // it, every "resend the email, I didn't get it" leaves another live key
        // to the account lying in a mailbox.
        await scope.Connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM verification_tokens WHERE identifier = @identifier AND type = @type",
            new { identifier, type }, scope.Transaction, cancellationToken: ct));

        await scope.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO verification_tokens
              (id, identifier, "tokenHash", type, "expiresAt", "createdAt")
            VALUES (@id, @identifier, @tokenHash, @type, @expiresAt, @createdAt)
            """,
            new { id, identifier, tokenHash, type, expiresAt, createdAt },
            scope.Transaction, cancellationToken: ct));
    }

    public async Task<VerificationTokenEntity?> ConsumeAsync(
        string tokenHash, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<VerificationTokenEntity>(
            new CommandDefinition(
                """
                DELETE FROM verification_tokens
                WHERE "tokenHash" = @tokenHash
                RETURNING identifier AS "Identifier", type AS "Type",
                          "expiresAt" AS "ExpiresAt"
                """,
                new { tokenHash }, session.Transaction, cancellationToken: ct));
    }
}

public sealed class RefreshTokenRepository(NpgsqlDataSource db) : IRefreshTokenRepository
{
    private const string Columns = """
        id AS "Id", "userId" AS "UserId", "issuedAt" AS "IssuedAt",
        "expiresAt" AS "ExpiresAt", "revokedAt" AS "RevokedAt"
        """;

    public async Task CreateAsync(
        string id, string userId, string tokenHash, DateTimeOffset issuedAt,
        DateTimeOffset expiresAt, string userAgent,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO refresh_tokens
              (id, "userId", "tokenHash", "issuedAt", "expiresAt", "userAgent")
            VALUES (@id, @userId, @tokenHash, @issuedAt, @expiresAt, @userAgent)
            """,
            new { id, userId, tokenHash, issuedAt, expiresAt, userAgent = Trim(userAgent) },
            session.Transaction, cancellationToken: ct));
    }

    public Task<RefreshTokenEntity?> FindForUpdateAsync(
        string tokenHash, ITransactionScope scope, CancellationToken ct = default)
        => scope.Connection.QuerySingleOrDefaultAsync<RefreshTokenEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM refresh_tokens WHERE \"tokenHash\" = @tokenHash FOR UPDATE",
                new { tokenHash }, scope.Transaction, cancellationToken: ct));

    public async Task MarkRotatedAsync(
        string id, string replacedById, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE refresh_tokens
            SET "revokedAt" = @at, "replacedById" = @replacedById
            WHERE id = @id
            """,
            new { at, replacedById, id }, session.Transaction, cancellationToken: ct));
    }

    public async Task RevokeAllForUserAsync(
        string userId, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE refresh_tokens SET "revokedAt" = @at
            WHERE "userId" = @userId AND "revokedAt" IS NULL
            """,
            new { at, userId }, session.Transaction, cancellationToken: ct));
    }

    /// <summary>
    /// The user agent is a diagnostic — recorded so an audit can answer "which
    /// device was that?" — and never checked as a credential. An unbounded
    /// client-supplied string does not belong in a column that gets read into
    /// logs, so it is truncated.
    /// </summary>
    private static string Trim(string userAgent)
        => userAgent.Length > 400 ? userAgent[..400] : userAgent;
}

public sealed class RateLimitRepository(NpgsqlDataSource db) : IRateLimitRepository
{
    public async Task<int> CountSinceAsync(
        string bucket, string key, DateTimeOffset since,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT count(*) FROM rate_limit_hits
            WHERE bucket = @bucket AND key = @key AND "createdAt" >= @since
            """,
            new { bucket, key, since }, session.Transaction, cancellationToken: ct));
    }

    public async Task RecordAsync(
        string id, string bucket, string key, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO rate_limit_hits (id, bucket, key, "createdAt")
            VALUES (@id, @bucket, @key, @at)
            """,
            new { id, bucket, key, at }, session.Transaction, cancellationToken: ct));
    }

    public async Task ClearAsync(
        string bucket, string key,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM rate_limit_hits WHERE bucket = @bucket AND key = @key",
            new { bucket, key }, session.Transaction, cancellationToken: ct));
    }

    public async Task<int> PurgeBeforeAsync(
        DateTimeOffset cutoff, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM rate_limit_hits WHERE \"createdAt\" < @cutoff",
            new { cutoff }, session.Transaction, cancellationToken: ct));
    }
}

public sealed class SettingsRepository(NpgsqlDataSource db) : ISettingsRepository
{
    public async Task<IReadOnlyDictionary<string, string>> GetAllAsync(
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // value::text because the column is jsonb and the service decides how to
        // read each key. Deserialising here would mean this repository knowing
        // the settings schema, which is the service's business.
        var rows = await session.Connection.QueryAsync<SettingEntity>(new CommandDefinition(
            "SELECT key AS \"Key\", value::text AS \"Value\" FROM system_settings",
            transaction: session.Transaction, cancellationToken: ct));

        return rows.ToDictionary(r => r.Key, r => r.Value);
    }

    public async Task UpsertAsync(
        string key, string jsonValue, string updatedBy, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO system_settings (key, value, "updatedAt", "updatedBy")
            VALUES (@key, CAST(@jsonValue AS jsonb), @at, @updatedBy)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt",
                                            "updatedBy" = EXCLUDED."updatedBy"
            """,
            new { key, jsonValue, updatedBy, at }, session.Transaction, cancellationToken: ct));
    }
}
