using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;
using NpgsqlTypes;

namespace Leash.Core.Repositories;

public sealed class SubscriptionRepository(NpgsqlDataSource db) : ISubscriptionRepository
{
    private const string PlanColumns = """
        id AS "Id", key AS "Key", name AS "Name", description AS "Description",
        "priceCents" AS "PriceCents", currency AS "Currency", "interval" AS "Interval",
        "stripeProductId" AS "StripeProductId", "stripePriceId" AS "StripePriceId",
        COALESCE(entitlements, ARRAY[]::text[]) AS "Entitlements",
        "consultDiscountPct" AS "ConsultDiscountPct", active AS "Active"
        """;

    private const string Columns = """
        s.id AS "Id", s."userId" AS "UserId", s."planId" AS "PlanId", s.provider AS "Provider",
        s."providerRef" AS "ProviderRef", s."providerCustomerId" AS "ProviderCustomerId",
        s.status AS "Status", s."currentPeriodStart" AS "CurrentPeriodStart",
        s."currentPeriodEnd" AS "CurrentPeriodEnd", s."cancelAtPeriodEnd" AS "CancelAtPeriodEnd",
        s."canceledAt" AS "CanceledAt", s."endedAt" AS "EndedAt", s."graceEndsAt" AS "GraceEndsAt",
        s."latestInvoiceRef" AS "LatestInvoiceRef", s."lastEventAt" AS "LastEventAt",
        s."createdAt" AS "CreatedAt", s."updatedAt" AS "UpdatedAt"
        """;

    public Task<PlanEntity?> GetPlanByKeyAsync(string key, ITransactionScope? scope = null, CancellationToken ct = default)
        => PlanAsync("key = @value", key, scope, ct);

    public Task<PlanEntity?> GetPlanByIdAsync(string id, ITransactionScope? scope = null, CancellationToken ct = default)
        => PlanAsync("id = @value", id, scope, ct);

    public Task<PlanEntity?> GetPlanByPriceIdAsync(string priceId, ITransactionScope? scope = null, CancellationToken ct = default)
        => string.IsNullOrEmpty(priceId)
            ? Task.FromResult<PlanEntity?>(null)
            : PlanAsync("\"stripePriceId\" = @value", priceId, scope, ct);

    private async Task<PlanEntity?> PlanAsync(string where, string value, ITransactionScope? scope, CancellationToken ct)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QueryFirstOrDefaultAsync<PlanEntity>(new CommandDefinition(
            $"SELECT {PlanColumns} FROM plans WHERE {where} ORDER BY id LIMIT 1",
            new { value }, session.Transaction, cancellationToken: ct));
    }

    public async Task<SubscriptionWithPlanEntity?> GetLiveForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QueryFirstOrDefaultAsync<SubscriptionWithPlanEntity>(new CommandDefinition(
            $"""
             SELECT {Columns}, p.key AS "PlanKey", p.name AS "PlanName",
                    COALESCE(p.entitlements, ARRAY[]::text[]) AS "PlanEntitlements",
                    p."consultDiscountPct" AS "PlanConsultDiscountPct"
             FROM subscriptions s JOIN plans p ON p.id = s."planId"
             WHERE s."userId" = @userId AND s.status = ANY(@live)
             ORDER BY s."currentPeriodEnd" DESC, s.id
             LIMIT 1
             """,
            new { userId, live = SubscriptionStatuses.Live }, session.Transaction, cancellationToken: ct));
    }

    public async Task<SubscriptionEntity?> GetLatestForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QueryFirstOrDefaultAsync<SubscriptionEntity>(new CommandDefinition(
            $"""
             SELECT {Columns} FROM subscriptions s
             WHERE s."userId" = @userId
             ORDER BY s."createdAt" DESC, s.id DESC
             LIMIT 1
             """,
            new { userId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<SubscriptionEntity?> GetByProviderRefForUpdateAsync(
        string providerRef, ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<SubscriptionEntity>(new CommandDefinition(
            $"""SELECT {Columns} FROM subscriptions s WHERE s."providerRef" = @providerRef FOR UPDATE""",
            new { providerRef }, session.Transaction, cancellationToken: ct));
    }

    public async Task InsertAsync(SubscriptionEntity s, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO subscriptions (
                id, "userId", "planId", provider, "providerRef", "providerCustomerId", status,
                "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd", "canceledAt", "endedAt",
                "graceEndsAt", "latestInvoiceRef", "lastEventAt", "createdAt", "updatedAt")
            VALUES (
                @Id, @UserId, @PlanId, @Provider, @ProviderRef, @ProviderCustomerId, @Status,
                @CurrentPeriodStart, @CurrentPeriodEnd, @CancelAtPeriodEnd, @CanceledAt, @EndedAt,
                @GraceEndsAt, @LatestInvoiceRef, @LastEventAt, @CreatedAt, @UpdatedAt)
            """,
            s, session.Transaction, cancellationToken: ct));
    }

    public async Task UpdateAsync(SubscriptionEntity s, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE subscriptions SET
                "userId" = @UserId, "planId" = @PlanId, "providerCustomerId" = @ProviderCustomerId,
                status = @Status, "currentPeriodStart" = @CurrentPeriodStart,
                "currentPeriodEnd" = @CurrentPeriodEnd, "cancelAtPeriodEnd" = @CancelAtPeriodEnd,
                "canceledAt" = @CanceledAt, "endedAt" = @EndedAt, "graceEndsAt" = @GraceEndsAt,
                "latestInvoiceRef" = @LatestInvoiceRef, "lastEventAt" = @LastEventAt,
                "updatedAt" = @UpdatedAt
            WHERE id = @Id
            """,
            s, session.Transaction, cancellationToken: ct));
    }

    public async Task SetCancelAtPeriodEndAsync(
        string id, bool value, DateTimeOffset updatedAt, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE subscriptions SET "cancelAtPeriodEnd" = @value, "updatedAt" = @updatedAt WHERE id = @id""",
            new { id, value, updatedAt }, session.Transaction, cancellationToken: ct));
    }

    public async Task<string?> GetCustomerIdAsync(string userId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """SELECT NULLIF("stripeCustomerId", '') FROM users WHERE id = @userId""",
            new { userId }, session.Transaction, cancellationToken: ct));
    }

    public async Task SetCustomerIdAsync(string userId, string customerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE users SET "stripeCustomerId" = @customerId WHERE id = @userId""",
            new { userId, customerId }, session.Transaction, cancellationToken: ct));
    }

    public async Task<string?> FindUserByCustomerIdAsync(string customerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(customerId)) return null;
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """SELECT id FROM users WHERE "stripeCustomerId" = @customerId""",
            new { customerId }, session.Transaction, cancellationToken: ct));
    }
}

public sealed class WebhookEventRepository(NpgsqlDataSource db) : IWebhookEventRepository
{
    public async Task<bool> TryInsertClaimedAsync(
        string id, string type, string apiVersion, DateTimeOffset eventAt, string payloadJson,
        DateTimeOffset now, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            INSERT INTO webhook_events (
                id, provider, type, "apiVersion", "eventAt", payload, status, attempts,
                "lockedAt", error, "receivedAt")
            VALUES (@id, 'stripe', @type, @apiVersion, @eventAt, @payload, 'received', 1, @now, '', @now)
            ON CONFLICT (id) DO NOTHING
            """, conn);
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("type", type);
        cmd.Parameters.AddWithValue("apiVersion", apiVersion);
        cmd.Parameters.AddWithValue("eventAt", eventAt);
        cmd.Parameters.Add(new NpgsqlParameter("payload", NpgsqlDbType.Jsonb) { Value = payloadJson });
        cmd.Parameters.AddWithValue("now", now);
        return await cmd.ExecuteNonQueryAsync(ct) == 1;
    }

    public async Task<WebhookEventEntity?> GetAsync(string id, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<WebhookEventEntity>(new CommandDefinition(
            """SELECT id AS "Id", status AS "Status", attempts AS "Attempts", "lockedAt" AS "LockedAt" FROM webhook_events WHERE id = @id""",
            new { id }, cancellationToken: ct));
    }

    public async Task<int?> TryReclaimAsync(string id, WebhookEventEntity seen, DateTimeOffset now, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            """
            UPDATE webhook_events
            SET attempts = attempts + 1, "lockedAt" = @now, status = 'received'
            WHERE id = @id AND status = @status AND attempts = @attempts
              AND "lockedAt" IS NOT DISTINCT FROM @lockedAt
            RETURNING attempts
            """,
            new { id, now, status = seen.Status, attempts = seen.Attempts, lockedAt = seen.LockedAt },
            cancellationToken: ct));
    }

    public async Task SetOutcomeAsync(string id, string status, string error, DateTimeOffset? processedAt, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition(
            """
            UPDATE webhook_events
            SET status = @status, error = @error, "lockedAt" = NULL,
                "processedAt" = COALESCE(@processedAt::timestamptz, "processedAt")
            WHERE id = @id
            """,
            new { id, status, error, processedAt }, cancellationToken: ct));
    }

    public async Task<int> PurgeSettledAsync(DateTimeOffset receivedBefore, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        return await conn.ExecuteAsync(new CommandDefinition(
            """DELETE FROM webhook_events WHERE status IN ('processed', 'skipped') AND "receivedAt" < @receivedBefore""",
            new { receivedBefore }, cancellationToken: ct));
    }
}
