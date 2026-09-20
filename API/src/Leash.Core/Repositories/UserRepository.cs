using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Security;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>
/// Dapper over <c>users</c>. The SQL lives here and nowhere else.
/// </summary>
public sealed class UserRepository(NpgsqlDataSource db) : IUserRepository
{
    /// <summary>
    /// Every column the entity needs, and no others.
    ///
    /// Spelled out rather than <c>SELECT *</c> on purpose: the table also holds
    /// the password hash, the Google subject id, the Stripe customer id and the
    /// session watermark. A <c>SELECT *</c> into an entity that happens not to
    /// bind them today is one added property away from serialising a password
    /// hash to a browser.
    /// </summary>
    private const string Columns = """
        id AS "Id", name AS "Name", email AS "Email", phone AS "Phone",
        "avatarUrl" AS "AvatarUrl", roles AS "Roles",
        "addressCity" AS "AddressCity", "addressState" AS "AddressState",
        lat AS "Lat", lng AS "Lng", verified AS "Verified",
        "createdAt" AS "CreatedAt", "staffRoles" AS "StaffRoles", status AS "Status"
        """;

    /// <summary>
    /// The canonical form of an email address, used everywhere one is stored or
    /// matched. Addresses are stored lowercase, so lookups are a straight
    /// equality match on the unique index rather than a <c>lower(email)</c> call
    /// that could not use it.
    /// </summary>
    public static string NormalizeEmail(string email) => EmailAddress.Normalize(email);

    public async Task<UserEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM users WHERE id = @id",
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<UserEntity?> GetByEmailAsync(
        string email, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM users WHERE email = @email",
                new { email = NormalizeEmail(email) },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<UserCredentialEntity?> GetCredentialByEmailAsync(
        string email, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserCredentialEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns}, "passwordHash" AS "PasswordHash"
                 FROM users WHERE email = @email
                 """,
                new { email = NormalizeEmail(email) },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<UserEntity?> GetByGoogleIdAsync(
        string googleId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM users WHERE \"googleId\" = @googleId",
                new { googleId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<AccountGateEntity?> GetAccountGateAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AccountGateEntity>(
            new CommandDefinition(
                """
                SELECT status AS "Status", "sessionsValidFrom" AS "SessionsValidFrom"
                FROM users WHERE id = @id
                """,
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<UserEntity>> GetManyAsync(
        IReadOnlyCollection<string> ids, bool excludeDeleted,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (ids.Count == 0) return [];

        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<UserEntity>(new CommandDefinition(
            $"""
             SELECT {Columns} FROM users
             WHERE id = ANY(@ids)
               AND (@includeDeleted OR status <> 'deleted')
             """,
            new { ids = ids.ToArray(), includeDeleted = !excludeDeleted },
            session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<IReadOnlyList<UserEntity>> ListAsync(
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<UserEntity>(new CommandDefinition(
            $"SELECT {Columns} FROM users ORDER BY \"createdAt\" ASC",
            transaction: session.Transaction, cancellationToken: ct));

        return rows.ToList();
    }

    public async Task<UserEntity> CreateAsync(
        UserEntity user, string? passwordHash, string? googleId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<UserEntity>(new CommandDefinition(
            $"""
             INSERT INTO users
               (id, name, email, phone, "avatarUrl", roles, "addressCity", "addressState",
                lat, lng, verified, "createdAt", "passwordHash", "googleId",
                "staffRoles", status)
             VALUES
               (@Id, @Name, @Email, @Phone, @AvatarUrl, @Roles, @AddressCity, @AddressState,
                @Lat, @Lng, @Verified, @CreatedAt, @passwordHash, @googleId,
                ARRAY[]::text[], @Status)
             RETURNING {Columns}
             """,
            new
            {
                user.Id, user.Name,
                Email = NormalizeEmail(user.Email),
                user.Phone, user.AvatarUrl, user.Roles,
                user.AddressCity, user.AddressState, user.Lat, user.Lng,
                user.Verified, user.CreatedAt, user.Status,
                passwordHash,
                googleId,
            },
            session.Transaction, cancellationToken: ct));
    }

    /// <summary>
    /// Every column is written with <c>COALESCE(@value, column)</c>, so a field
    /// the request omitted keeps its current value in one statement — no
    /// read-modify-write, and therefore no window in which two concurrent
    /// patches each overwrite the other's untouched fields.
    ///
    /// The column list here is the privilege boundary, and it is short for the
    /// reasons documented on <see cref="UpdateUserRequest"/>: no
    /// <c>verified</c>, no <c>email</c>, no <c>staffRoles</c>, no <c>status</c>.
    /// </summary>
    public async Task<UserEntity?> UpdateAsync(
        string id, UpdateUserRequest patch,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"""
                 UPDATE users SET
                   name           = COALESCE(@name, name),
                   phone          = COALESCE(@phone, phone),
                   "avatarUrl"    = COALESCE(@avatarUrl, "avatarUrl"),
                   roles          = COALESCE(@roles, roles),
                   "addressCity"  = COALESCE(@city, "addressCity"),
                   "addressState" = COALESCE(@state, "addressState"),
                   lat            = COALESCE(@lat, lat),
                   lng            = COALESCE(@lng, lng)
                 WHERE id = @id
                 RETURNING {Columns}
                 """,
                new
                {
                    id,
                    name = patch.Name?.Trim(),
                    phone = patch.Phone?.Trim(),
                    avatarUrl = patch.AvatarUrl,
                    roles = patch.Roles,
                    city = patch.Address?.City,
                    state = patch.Address?.State,
                    lat = patch.Address?.Lat,
                    lng = patch.Address?.Lng,
                },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<UserEntity?> MarkVerifiedAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"""
                 UPDATE users SET verified = true WHERE id = @id
                 RETURNING {Columns}
                 """,
                new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> SetPasswordAndRevokeSessionsAsync(
        string id, string passwordHash, DateTimeOffset revokedAt,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var affected = await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE users
            SET "passwordHash" = @passwordHash, "sessionsValidFrom" = @revokedAt
            WHERE id = @id
            """,
            new { id, passwordHash, revokedAt },
            session.Transaction, cancellationToken: ct));

        return affected > 0;
    }

    public async Task<bool> LinkGoogleAsync(
        string id, string googleId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // Read-then-write, so it needs the two to be atomic or two accounts
        // could claim one Google id simultaneously. The unique index on
        // "googleId" is the real guarantee — this check only decides which
        // caller gets a clean false instead of a constraint violation.
        var claimedBy = await session.Connection.ExecuteScalarAsync<string?>(
            new CommandDefinition(
                "SELECT id FROM users WHERE \"googleId\" = @googleId FOR UPDATE",
                new { googleId }, session.Transaction, cancellationToken: ct));

        if (claimedBy is not null && claimedBy != id) return false;

        await session.Connection.ExecuteAsync(new CommandDefinition(
            "UPDATE users SET \"googleId\" = @googleId WHERE id = @id",
            new { googleId, id }, session.Transaction, cancellationToken: ct));

        return true;
    }

    public async Task<UserEntity?> AdoptGoogleIdAsync(
        string id, string googleId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<UserEntity>(
            new CommandDefinition(
                $"""
                 UPDATE users SET "googleId" = @googleId, verified = true WHERE id = @id
                 RETURNING {Columns}
                 """,
                new { googleId, id }, session.Transaction, cancellationToken: ct));
    }

    public async Task TouchLastLoginAsync(
        string id, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            "UPDATE users SET \"lastLoginAt\" = @at WHERE id = @id",
            new { id, at }, session.Transaction, cancellationToken: ct));
    }
}
