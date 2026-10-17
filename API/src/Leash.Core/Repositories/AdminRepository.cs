using System.Globalization;
using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper for the admin console. See <see cref="IAdminRepository"/>.</summary>
public sealed class AdminRepository(NpgsqlDataSource db) : IAdminRepository
{
    // ── Users ────────────────────────────────────────────────────────────

    private const string UserColumns = """
        u.id AS "Id", u.name AS "Name", u.email AS "Email", u."avatarUrl" AS "AvatarUrl",
        COALESCE(u.roles, ARRAY[]::text[]) AS "Roles",
        COALESCE(u."staffRoles", ARRAY[]::text[]) AS "StaffRoles",
        u.status AS "Status", u.verified AS "Verified", u."createdAt" AS "CreatedAt",
        u."lastLoginAt" AS "LastLoginAt", u."addressCity" AS "AddressCity", u."addressState" AS "AddressState",
        (u."passwordHash" IS NOT NULL) AS "HasPassword", (u."googleId" IS NOT NULL) AS "HasGoogle",
        u.phone AS "Phone", u.lat AS "Lat", u.lng AS "Lng", u."suspendedAt" AS "SuspendedAt",
        u."suspendedReason" AS "SuspendedReason", u."deletedAt" AS "DeletedAt",
        u."sessionsValidFrom" AS "SessionsValidFrom"
        """;

    /// <summary>
    /// The four user sorts, each with the key expression the keyset compares
    /// on. <c>recent_login</c> puts accounts that never signed in last by
    /// reading their missing login as minus infinity; <c>name</c> compares
    /// bytewise on the lower-cased name, so the order does not depend on the
    /// server's locale.
    /// </summary>
    private sealed record UserSort(string Key, string Type, bool Descending, Func<AdminUserRow, string> KeyOf);

    private static readonly Dictionary<string, UserSort> UserSorts = new()
    {
        ["newest"] = new("u.\"createdAt\"", "timestamptz", true, r => Iso(r.CreatedAt)),
        ["oldest"] = new("u.\"createdAt\"", "timestamptz", false, r => Iso(r.CreatedAt)),
        ["name"] = new("lower(u.name) COLLATE \"C\"", "text", false, r => r.Name.ToLowerInvariant()),
        ["recent_login"] = new("COALESCE(u.\"lastLoginAt\", '-infinity'::timestamptz)", "timestamptz", true,
            r => r.LastLoginAt is { } at ? Iso(at) : "-infinity"),
    };

    public async Task<(IReadOnlyList<AdminUserRow> Rows, string? NextCursor, int Total)> SearchUsersAsync(
        AdminUserQuery query, int limit, CancellationToken ct = default)
    {
        var sortName = query.Sort is { } s && UserSorts.ContainsKey(s) ? s : "newest";
        var sort = UserSorts[sortName];

        var where = new List<string>();
        var args = new DynamicParameters();

        if (query.Status is { } status) { where.Add("u.status = @status"); args.Add("status", status); }
        if (query.Role is { } role) { where.Add("@role = ANY(u.roles)"); args.Add("role", role); }
        if (query.StaffRole is { } staffRole) { where.Add("@staffRole = ANY(u.\"staffRoles\")"); args.Add("staffRole", staffRole); }
        if (query.Verified is { } verified) { where.Add("u.verified = @verified"); args.Add("verified", verified); }
        if (query.AuthMethod == "password") where.Add("u.\"passwordHash\" IS NOT NULL");
        if (query.AuthMethod == "google") where.Add("u.\"googleId\" IS NOT NULL");

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            // Exact on id: a ticket quotes an id, and a `contains` on it would
            // make "u1" match u10, u11… which is never what was meant.
            where.Add("(u.name ILIKE @like ESCAPE '\\' OR u.email ILIKE @like ESCAPE '\\' OR u.id = @q)");
            args.Add("q", query.Q.Trim());
            args.Add("like", Like(query.Q));
        }

        var filter = where.Count == 0 ? "TRUE" : string.Join(" AND ", where);
        var keyset = "TRUE";

        if (Cursor.DecodeParts(query.Cursor, 3) is [var cursorSort, var key, var id] && cursorSort == sortName)
        {
            keyset = $"({sort.Key}, u.id) {(sort.Descending ? "<" : ">")} (@key::{sort.Type}{(sort.Type == "text" ? " COLLATE \"C\"" : "")}, @keyId)";
            args.Add("key", Uri.UnescapeDataString(key));
            args.Add("keyId", id);
        }

        var direction = sort.Descending ? "DESC" : "ASC";
        args.Add("take", limit + 1);

        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<AdminUserRow>(new CommandDefinition(
            $"""
             SELECT {UserColumns} FROM users u
             WHERE {filter} AND {keyset}
             ORDER BY {sort.Key} {direction}, u.id {direction}
             LIMIT @take
             """, args, cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT count(*)::int FROM users u WHERE {filter}", args, cancellationToken: ct));

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            next = Cursor.EncodeParts(sortName, Uri.EscapeDataString(sort.KeyOf(last)), last.Id);
        }

        return (rows, next, total);
    }

    public async Task<AdminUserRow?> GetUserAsync(string id, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<AdminUserRow>(new CommandDefinition(
            $"SELECT {UserColumns} FROM users u WHERE u.id = @id{(scope is null ? "" : " FOR UPDATE")}",
            new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<AdminUserCountsDto> CountUserActivityAsync(string id, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.QuerySingleAsync<AdminUserCountsDto>(new CommandDefinition(
            """
            SELECT
              (SELECT count(*)::int FROM pets WHERE "ownerId" = @id) AS "Pets",
              (SELECT count(*)::int FROM bookings WHERE "ownerId" = @id) AS "Bookings",
              (SELECT count(*)::int FROM vet_appointments WHERE "ownerId" = @id) AS "Appointments",
              (SELECT count(*)::int FROM orders WHERE "userId" = @id) AS "Orders",
              (SELECT count(*)::int FROM notifications WHERE "userId" = @id AND "readAt" IS NULL) AS "UnreadNotifications"
            """, new { id }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<AdminOrderSummaryDto>> RecentOrdersAsync(string id, int limit, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<OrderSummaryRow>(new CommandDefinition(
            """
            SELECT id AS "Id", status AS "Status", "paymentStatus" AS "PaymentStatus",
                   "totalCents" AS "TotalCents", "placedAt" AS "PlacedAt"
            FROM orders WHERE "userId" = @id ORDER BY "placedAt" DESC, id DESC LIMIT @limit
            """, new { id, limit }, cancellationToken: ct));
        return [.. rows.Select(r => new AdminOrderSummaryDto(r.Id, r.Status, r.PaymentStatus, r.TotalCents, r.PlacedAt))];
    }

    public async Task<AdminCaretakerProfileDto?> CaretakerProfileForAsync(string userId, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<AdminCaretakerProfileDto>(new CommandDefinition(
            """
            SELECT id AS "Id", "backgroundCheckStatus" AS "BackgroundCheckStatus",
                   rating AS "Rating", "reviewCount" AS "ReviewCount"
            FROM caretaker_profiles WHERE "userId" = @userId
            """, new { userId }, cancellationToken: ct));
    }

    public async Task<AdminVetProfileDto?> VetProfileForAsync(string userId, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<AdminVetProfileDto>(new CommandDefinition(
            """
            SELECT id AS "Id", "clinicName" AS "ClinicName", "licenseNumber" AS "LicenseNumber",
                   "licenseState" AS "LicenseState"
            FROM vet_profiles WHERE "userId" = @userId
            """, new { userId }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<string>> LockActiveAdminsAsync(ITransactionScope scope, CancellationToken ct = default)
    {
        // PostgreSQL re-checks the WHERE on each row after waiting for its
        // lock, so a demotion committed while we waited drops that row out.
        var rows = await scope.Connection.QueryAsync<string>(new CommandDefinition(
            """
            SELECT id FROM users
            WHERE 'admin' = ANY("staffRoles") AND status = 'active'
            ORDER BY id
            FOR UPDATE
            """, transaction: scope.Transaction, cancellationToken: ct));
        return rows.ToList();
    }

    public Task SetVerifiedAsync(string id, bool verified, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope, """UPDATE users SET verified = @verified WHERE id = @id""", new { id, verified }, ct);

    public Task SuspendAsync(string id, string reason, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope,
            """
            UPDATE users SET status = 'suspended', "suspendedAt" = @at, "suspendedReason" = @reason,
                             "sessionsValidFrom" = @at
            WHERE id = @id
            """, new { id, reason, at }, ct);

    public Task ReactivateAsync(string id, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope,
            """UPDATE users SET status = 'active', "suspendedAt" = NULL, "suspendedReason" = '' WHERE id = @id""",
            new { id }, ct);

    public Task BumpSessionsAsync(string id, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope, """UPDATE users SET "sessionsValidFrom" = @at WHERE id = @id""", new { id, at }, ct);

    public Task SetRolesAsync(string id, string[] roles, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope, """UPDATE users SET roles = @roles WHERE id = @id""", new { id, roles }, ct);

    public Task SetStaffRolesAsync(string id, string[] staffRoles, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope,
            // isOps is the reference's legacy flag, kept in step until it is dropped.
            """UPDATE users SET "staffRoles" = @staffRoles, "isOps" = @isOps WHERE id = @id""",
            new { id, staffRoles, isOps = staffRoles.Contains(StaffRoles.Ops) || staffRoles.Contains(StaffRoles.Admin) }, ct);

    public Task SoftDeleteAsync(string id, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope,
            """
            UPDATE users SET
                status = 'deleted', "deletedAt" = @at, "sessionsValidFrom" = @at,
                name = 'Deleted account', email = 'deleted+' || id || '@removed.invalid',
                phone = '', "avatarUrl" = '', "passwordHash" = NULL, "googleId" = NULL,
                "addressCity" = '', "addressState" = '', lat = 0, lng = 0,
                roles = ARRAY[]::text[], "staffRoles" = ARRAY[]::text[], "isOps" = false,
                "stripeCustomerId" = NULL
            WHERE id = @id
            """, new { id, at }, ct);

    // ── Professionals ────────────────────────────────────────────────────

    private const string ProfessionalsCte = """
        WITH p AS (
          SELECT c.id, 'caretaker' AS kind, c."userId" AS user_id, u.name AS user_name, u.email AS user_email,
                 u."avatarUrl" AS avatar_url, c."backgroundCheckStatus" AS status, c.rating, c."reviewCount" AS review_count,
                 cardinality(COALESCE(c."servicesOffered", ARRAY[]::text[]))::text AS d1,
                 cardinality(COALESCE(c.certifications, ARRAY[]::text[]))::text AS d2, '' AS d3
          FROM caretaker_profiles c JOIN users u ON u.id = c."userId"
          UNION ALL
          SELECT v.id, 'vet', v."userId", u.name, u.email, u."avatarUrl", v."verificationStatus",
                 v.rating, v."reviewCount", v."clinicName", v."licenseNumber", v."licenseState"
          FROM vet_profiles v JOIN users u ON u.id = v."userId"
          UNION ALL
          -- A shelter has no rating, deliberately (R9). Zeroes are the honest
          -- rendering of "we do not score these yet".
          SELECT s.id, 'shelter', s."userId", u.name, u.email, u."avatarUrl", s."verificationStatus",
                 0::float8, 0, s.name, s.kind, s."registrationNumber"
          FROM shelter_profiles s JOIN users u ON u.id = s."userId"
        ), ranked AS (
          SELECT p.*,
                 CASE status WHEN 'pending' THEN 0 WHEN 'none' THEN 1 ELSE 2 END AS rank,
                 lower(user_name) COLLATE "C" AS sort_name
          FROM p
        )
        """;

    public async Task<(IReadOnlyList<AdminProfessionalEntity> Rows, string? NextCursor, int Total, int AwaitingReview)>
        SearchProfessionalsAsync(AdminProfessionalQuery query, int limit, CancellationToken ct = default)
    {
        var where = new List<string>();
        var args = new DynamicParameters();

        if (query.Kind is { } kind) { where.Add("kind = @kind"); args.Add("kind", kind); }
        if (query.Status is { } status) { where.Add("status = @status"); args.Add("status", status); }
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            where.Add("(user_name ILIKE @like ESCAPE '\\' OR user_email ILIKE @like ESCAPE '\\')");
            args.Add("like", Like(query.Q));
        }

        var filter = where.Count == 0 ? "TRUE" : string.Join(" AND ", where);
        var keyset = "TRUE";

        // Unverified first: the page exists to work through a queue.
        if (Cursor.DecodeParts(query.Cursor, 3) is [var rank, var name, var id]
            && int.TryParse(rank, NumberStyles.Integer, CultureInfo.InvariantCulture, out var r))
        {
            keyset = "(rank, sort_name, id) > (@rank, @name COLLATE \"C\", @keyId)";
            args.Add("rank", r);
            args.Add("name", Uri.UnescapeDataString(name));
            args.Add("keyId", id);
        }

        args.Add("take", limit + 1);

        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<AdminProfessionalEntity>(new CommandDefinition(
            $"""
             {ProfessionalsCte}
             SELECT id AS "Id", kind AS "Kind", user_id AS "UserId", user_name AS "UserName",
                    user_email AS "UserEmail", avatar_url AS "AvatarUrl", status AS "Status",
                    rating AS "Rating", review_count AS "ReviewCount", rank AS "Rank",
                    sort_name AS "SortName", d1 AS "D1", d2 AS "D2", d3 AS "D3"
             FROM ranked
             WHERE {filter} AND {keyset}
             ORDER BY rank, sort_name, id
             LIMIT @take
             """, args, cancellationToken: ct))).ToList();

        var counts = await conn.QuerySingleAsync<(int Total, int Awaiting)>(new CommandDefinition(
            $"""
             {ProfessionalsCte}
             SELECT count(*) FILTER (WHERE {filter})::int, count(*) FILTER (WHERE status <> 'verified')::int
             FROM ranked
             """, args, cancellationToken: ct));

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            next = Cursor.EncodeParts(
                last.Rank.ToString(CultureInfo.InvariantCulture), Uri.EscapeDataString(last.SortName), last.Id);
        }

        return (rows, next, counts.Total, counts.Awaiting);
    }

    public async Task<(string UserId, string Email)?> SetVerificationAsync(
        string kind, string profileId, string status, ITransactionScope scope, CancellationToken ct = default)
    {
        var (table, column) = kind switch
        {
            "caretaker" => ("caretaker_profiles", "\"backgroundCheckStatus\""),
            "vet" => ("vet_profiles", "\"verificationStatus\""),
            "shelter" => ("shelter_profiles", "\"verificationStatus\""),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
        };

        var owner = await scope.Connection.QuerySingleOrDefaultAsync<OwnerRow>(new CommandDefinition(
            $"""
             WITH changed AS (
               UPDATE {table} SET {column} = @status WHERE id = @profileId RETURNING "userId"
             )
             SELECT u.id AS "UserId", u.email AS "Email" FROM changed JOIN users u ON u.id = changed."userId"
             """, new { status, profileId }, scope.Transaction, cancellationToken: ct));
        return owner is null ? null : (owner.UserId, owner.Email);
    }

    // ── Finance ──────────────────────────────────────────────────────────

    private const string PaymentColumns = """
        p.id AS "Id", p."userId" AS "UserId", p.kind AS "Kind", p."orderId" AS "OrderId",
        p."subscriptionId" AS "SubscriptionId", p.provider AS "Provider", p."providerRef" AS "ProviderRef",
        p."providerCustomerId" AS "ProviderCustomerId", p.status AS "Status", p."amountCents" AS "AmountCents",
        p."amountRefundedCents" AS "AmountRefundedCents", p.currency AS "Currency",
        p."methodBrand" AS "MethodBrand", p."methodLast4" AS "MethodLast4", p."failureCode" AS "FailureCode",
        p."failureMessage" AS "FailureMessage", p."lastEventAt" AS "LastEventAt", p."createdAt" AS "CreatedAt",
        p."updatedAt" AS "UpdatedAt", p."succeededAt" AS "SucceededAt",
        u.name AS "UserName", u.email AS "UserEmail"
        """;

    public async Task<(IReadOnlyList<AdminPaymentEntity> Rows, string? NextCursor, int Total, long Captured, long Refunded)>
        SearchPaymentsAsync(AdminPaymentQuery query, int limit, CancellationToken ct = default)
    {
        var where = new List<string>();
        var args = new DynamicParameters();

        if (query.Status is { } status) { where.Add("p.status = @status"); args.Add("status", status); }
        if (query.Kind is { } kind) { where.Add("p.kind = @kind"); args.Add("kind", kind); }
        if (query.UserId is { } userId) { where.Add("p.\"userId\" = @userId"); args.Add("userId", userId); }
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            where.Add("(p.\"providerRef\" ILIKE @like ESCAPE '\\' OR p.\"orderId\" = @q OR u.email ILIKE @like ESCAPE '\\')");
            args.Add("q", query.Q.Trim());
            args.Add("like", Like(query.Q));
        }

        var filter = where.Count == 0 ? "TRUE" : string.Join(" AND ", where);
        var (keyset, next) = ("TRUE", (string?)null);
        if (Cursor.DecodeTimestamp(query.Cursor) is ({ } at, { } id))
        {
            keyset = "(p.\"createdAt\", p.id) < (@at, @keyId)";
            args.Add("at", at);
            args.Add("keyId", id);
        }
        args.Add("take", limit + 1);

        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<AdminPaymentEntity>(new CommandDefinition(
            $"""
             SELECT {PaymentColumns} FROM payments p JOIN users u ON u.id = p."userId"
             WHERE {filter} AND {keyset}
             ORDER BY p."createdAt" DESC, p.id DESC
             LIMIT @take
             """, args, cancellationToken: ct))).ToList();

        // Captured minus returned over the filtered set, so the figures under a
        // filter describe what is on screen rather than the whole ledger.
        var sums = await conn.QuerySingleAsync<(int Total, long Captured, long Refunded)>(new CommandDefinition(
            $"""
             SELECT count(*)::int,
                    COALESCE(sum(p."amountCents") FILTER (WHERE p.status IN ('paid', 'partially_refunded', 'refunded')), 0)::bigint,
                    COALESCE(sum(p."amountRefundedCents") FILTER (WHERE p.status IN ('paid', 'partially_refunded', 'refunded')), 0)::bigint
             FROM payments p JOIN users u ON u.id = p."userId"
             WHERE {filter}
             """, args, cancellationToken: ct));

        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            next = Cursor.Encode(rows[^1].CreatedAt, rows[^1].Id);
        }

        return (rows, next, sums.Total, sums.Captured, sums.Refunded);
    }

    public async Task<IReadOnlyList<RefundEntity>> RefundsForAsync(IReadOnlyCollection<string> paymentIds, CancellationToken ct = default)
    {
        if (paymentIds.Count == 0) return [];
        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<RefundEntity>(new CommandDefinition(
            """
            SELECT id AS "Id", "paymentId" AS "PaymentId", "providerRef" AS "ProviderRef",
                   "amountCents" AS "AmountCents", status AS "Status", reason AS "Reason",
                   "initiatedBy" AS "InitiatedBy", note AS "Note", "createdAt" AS "CreatedAt",
                   "settledAt" AS "SettledAt"
            FROM refunds WHERE "paymentId" = ANY(@ids) ORDER BY "createdAt" DESC, id DESC
            """, new { ids = paymentIds.ToArray() }, cancellationToken: ct));
        return rows.ToList();
    }

    private const string SubscriptionColumns = """
        s.id AS "Id", s."userId" AS "UserId", s."planId" AS "PlanId", s.provider AS "Provider",
        s."providerRef" AS "ProviderRef", s."providerCustomerId" AS "ProviderCustomerId", s.status AS "Status",
        s."currentPeriodStart" AS "CurrentPeriodStart", s."currentPeriodEnd" AS "CurrentPeriodEnd",
        s."cancelAtPeriodEnd" AS "CancelAtPeriodEnd", s."canceledAt" AS "CanceledAt", s."endedAt" AS "EndedAt",
        s."graceEndsAt" AS "GraceEndsAt", s."latestInvoiceRef" AS "LatestInvoiceRef",
        s."lastEventAt" AS "LastEventAt", s."createdAt" AS "CreatedAt", s."updatedAt" AS "UpdatedAt",
        u.name AS "UserName", u.email AS "UserEmail", pl.name AS "PlanName", pl."priceCents" AS "PriceCents"
        """;

    public async Task<(IReadOnlyList<AdminSubscriptionEntity> Rows, string? NextCursor, int Total, int ActiveCount, long MrrCents)>
        SearchSubscriptionsAsync(AdminSubscriptionQuery query, int limit, CancellationToken ct = default)
    {
        var where = new List<string>();
        var args = new DynamicParameters();

        if (query.Status is { } status) { where.Add("s.status = @status"); args.Add("status", status); }
        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            where.Add("(s.\"providerRef\" ILIKE @like ESCAPE '\\' OR u.email ILIKE @like ESCAPE '\\')");
            args.Add("like", Like(query.Q));
        }

        var filter = where.Count == 0 ? "TRUE" : string.Join(" AND ", where);
        var keyset = "TRUE";
        if (Cursor.DecodeTimestamp(query.Cursor) is ({ } at, { } id))
        {
            keyset = "(s.\"createdAt\", s.id) < (@at, @keyId)";
            args.Add("at", at);
            args.Add("keyId", id);
        }
        args.Add("take", limit + 1);

        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<AdminSubscriptionEntity>(new CommandDefinition(
            $"""
             SELECT {SubscriptionColumns}
             FROM subscriptions s JOIN users u ON u.id = s."userId" JOIN plans pl ON pl.id = s."planId"
             WHERE {filter} AND {keyset}
             ORDER BY s."createdAt" DESC, s.id DESC
             LIMIT @take
             """, args, cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            $"""SELECT count(*)::int FROM subscriptions s JOIN users u ON u.id = s."userId" WHERE {filter}""",
            args, cancellationToken: ct));

        // Monthly recurring revenue, normalised: an annual plan counts a twelfth
        // of itself, so the figure means the same whatever is being sold.
        var (active, mrr) = await conn.QuerySingleAsync<(int, long)>(new CommandDefinition(
            """
            SELECT count(*)::int,
                   COALESCE(sum(CASE pl."interval" WHEN 'year' THEN round(pl."priceCents" / 12.0) ELSE pl."priceCents" END), 0)::bigint
            FROM subscriptions s JOIN plans pl ON pl.id = s."planId"
            WHERE s.status IN ('active', 'trialing')
            """, cancellationToken: ct));

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            next = Cursor.Encode(rows[^1].CreatedAt, rows[^1].Id);
        }

        return (rows, next, total, active, mrr);
    }

    public async Task<AdminSubscriptionEntity?> GetSubscriptionForUpdateAsync(string id, ITransactionScope scope, CancellationToken ct = default)
        => await scope.Connection.QuerySingleOrDefaultAsync<AdminSubscriptionEntity>(new CommandDefinition(
            $"""
             SELECT {SubscriptionColumns}
             FROM subscriptions s JOIN users u ON u.id = s."userId" JOIN plans pl ON pl.id = s."planId"
             WHERE s.id = @id
             FOR UPDATE OF s
             """, new { id }, scope.Transaction, cancellationToken: ct));

    public Task UpdateSubscriptionAsync(
        string id, bool cancelAtPeriodEnd, string status, DateTimeOffset? canceledAt, DateTimeOffset? endedAt,
        DateTimeOffset? graceEndsAt, DateTimeOffset updatedAt, DateTimeOffset? lastEventAt,
        ITransactionScope scope, CancellationToken ct = default)
        => Exec(scope,
            """
            UPDATE subscriptions SET
                "cancelAtPeriodEnd" = @cancelAtPeriodEnd, status = @status,
                "canceledAt" = @canceledAt, "endedAt" = @endedAt, "graceEndsAt" = @graceEndsAt,
                "updatedAt" = @updatedAt, "lastEventAt" = COALESCE(@lastEventAt::timestamptz, "lastEventAt")
            WHERE id = @id
            """, new { id, cancelAtPeriodEnd, status, canceledAt, endedAt, graceEndsAt, updatedAt, lastEventAt }, ct);

    // ── Overview ─────────────────────────────────────────────────────────

    public async Task<AdminStatsDto> StatsAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);

        var users = await conn.QuerySingleAsync<AdminUserStatsDto>(new CommandDefinition(
            """
            SELECT
              count(*) FILTER (WHERE status <> 'deleted')::int AS "Total",
              count(*) FILTER (WHERE status <> 'deleted' AND "createdAt" >= @d7)::int AS "NewLast7Days",
              count(*) FILTER (WHERE status <> 'deleted' AND "createdAt" >= @d30)::int AS "NewLast30Days",
              count(*) FILTER (WHERE status = 'suspended')::int AS "Suspended",
              count(*) FILTER (WHERE verified = false AND status = 'active')::int AS "Unverified",
              count(*) FILTER (WHERE cardinality(COALESCE("staffRoles", ARRAY[]::text[])) > 0)::int AS "Staff"
            FROM users
            """, new { d7 = now.AddDays(-7), d30 = now.AddDays(-30) }, cancellationToken: ct));

        async Task<AdminCountByStatusDto> ByStatus(string table)
        {
            var rows = (await conn.QueryAsync<StatusCountEntity>(new CommandDefinition(
                $"""SELECT status AS "Status", count(*)::int AS "Count" FROM {table} GROUP BY status""",
                cancellationToken: ct))).ToList();
            return new AdminCountByStatusDto(rows.Sum(r => r.Count), rows.ToDictionary(r => r.Status, r => r.Count));
        }

        var bookings = await ByStatus("bookings");
        var appointments = await ByStatus("vet_appointments");
        var orders = await ByStatus("orders");

        // Gross value excludes money that came back or never arrived: a
        // refunded order is not revenue, and counting it flatters the number in
        // exactly the direction nobody should flatter it.
        var (gross, awaiting) = await conn.QuerySingleAsync<(long, int)>(new CommandDefinition(
            """
            SELECT COALESCE(sum("totalCents") FILTER (WHERE status NOT IN ('cancelled', 'refunded', 'pending_payment')), 0)::bigint,
                   count(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled', 'refunded', 'pending_payment'))::int
            FROM orders
            """, cancellationToken: ct));

        var catalog = await conn.QuerySingleAsync<AdminCatalogStatsDto>(new CommandDefinition(
            """
            SELECT count(*) FILTER (WHERE active)::int AS "Active",
                   count(*) FILTER (WHERE active AND "stockQty" = 0)::int AS "OutOfStock"
            FROM products
            """, cancellationToken: ct));

        return new AdminStatsDto(
            users, bookings, appointments,
            new AdminOrderStatsDto(orders.Total, gross, orders.ByStatus, awaiting),
            catalog);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /// <summary>A contains-pattern with LIKE's own wildcards escaped, so "%" searches for a percent sign.</summary>
    internal static string Like(string q)
        => "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    private static string Iso(DateTimeOffset at) => at.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    private static Task Exec(ITransactionScope scope, string sql, object args, CancellationToken ct)
        => scope.Connection.ExecuteAsync(new CommandDefinition(sql, args, scope.Transaction, cancellationToken: ct));

    // Mutable, because Dapper cannot bind timestamptz to a positional record (ARCHITECTURE.md §9.1).
    private sealed class OrderSummaryRow
    {
        public string Id { get; set; } = "";
        public string Status { get; set; } = "";
        public string PaymentStatus { get; set; } = "";
        public int TotalCents { get; set; }
        public DateTimeOffset PlacedAt { get; set; }
    }

    private sealed class OwnerRow
    {
        public string UserId { get; set; } = "";
        public string Email { get; set; } = "";
    }
}

public sealed class AuditRepository(NpgsqlDataSource db) : IAuditRepository
{
    public async Task InsertAsync(
        string actorUserId, string action, string targetType, string targetId, string summary,
        string? metadataJson, string ip, DateTimeOffset at, ITransactionScope? scope = null,
        CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO admin_audit_log (id, "actorUserId", action, "targetType", "targetId", summary, metadata, ip, "createdAt")
            VALUES (@id, @actorUserId, @action, @targetType, @targetId, @summary, CAST(@metadataJson AS jsonb), @ip, @at)
            """,
            new { id = Ids.New("aud"), actorUserId, action, targetType, targetId, summary, metadataJson, ip, at },
            session.Transaction, cancellationToken: ct));
    }

    public async Task<(IReadOnlyList<AuditEntryEntity> Rows, string? NextCursor, int Total)> ListAsync(
        AdminAuditQuery query, int limit, CancellationToken ct = default)
    {
        var where = new List<string>();
        var args = new DynamicParameters();

        if (query.ActorUserId is { } actor) { where.Add("a.\"actorUserId\" = @actor"); args.Add("actor", actor); }
        if (query.Action is { } action) { where.Add("a.action = @action"); args.Add("action", action); }
        if (query.TargetType is { } type) { where.Add("a.\"targetType\" = @type"); args.Add("type", type); }
        if (query.TargetId is { } target) { where.Add("a.\"targetId\" = @target"); args.Add("target", target); }

        var filter = where.Count == 0 ? "TRUE" : string.Join(" AND ", where);
        var keyset = "TRUE";
        if (Cursor.DecodeParts(query.Cursor, 2) is [var atRaw, var seqRaw]
            && DateTimeOffset.TryParse(atRaw, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at)
            && long.TryParse(seqRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var seq))
        {
            keyset = "(a.\"createdAt\", a.seq) < (@at, @seq)";
            args.Add("at", at);
            args.Add("seq", seq);
        }
        args.Add("take", limit + 1);

        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = (await conn.QueryAsync<AuditEntryEntity>(new CommandDefinition(
            $"""
             SELECT a.id AS "Id", a."actorUserId" AS "ActorUserId", u.name AS "ActorName", u.email AS "ActorEmail",
                    a.action AS "Action", a."targetType" AS "TargetType", a."targetId" AS "TargetId",
                    a.summary AS "Summary", a.metadata::text AS "Metadata", a.ip AS "Ip",
                    a."createdAt" AS "CreatedAt", a.seq AS "Seq"
             FROM admin_audit_log a JOIN users u ON u.id = a."actorUserId"
             WHERE {filter} AND {keyset}
             ORDER BY a."createdAt" DESC, a.seq DESC
             LIMIT @take
             """, args, cancellationToken: ct))).ToList();

        var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT count(*)::int FROM admin_audit_log a WHERE {filter}", args, cancellationToken: ct));

        string? next = null;
        if (rows.Count > limit)
        {
            rows.RemoveAt(rows.Count - 1);
            var last = rows[^1];
            next = Cursor.EncodeParts(
                last.CreatedAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
                last.Seq.ToString(CultureInfo.InvariantCulture));
        }

        return (rows, next, total);
    }
}
