using Dapper;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper over <c>payments</c> and <c>refunds</c>.</summary>
public sealed class PaymentRepository(NpgsqlDataSource db) : IPaymentRepository
{
    private const string Columns = """
        id AS "Id", "userId" AS "UserId", kind AS "Kind", "orderId" AS "OrderId",
        "subscriptionId" AS "SubscriptionId", "adoptionApplicationId" AS "AdoptionApplicationId",
        provider AS "Provider", "providerRef" AS "ProviderRef",
        "providerCustomerId" AS "ProviderCustomerId", status AS "Status",
        "amountCents" AS "AmountCents", "amountRefundedCents" AS "AmountRefundedCents",
        currency AS "Currency", "methodBrand" AS "MethodBrand", "methodLast4" AS "MethodLast4",
        "failureCode" AS "FailureCode", "failureMessage" AS "FailureMessage",
        "lastEventAt" AS "LastEventAt",
        "createdAt" AS "CreatedAt", "updatedAt" AS "UpdatedAt", "succeededAt" AS "SucceededAt"
        """;

    private const string RefundColumns = """
        id AS "Id", "paymentId" AS "PaymentId", "providerRef" AS "ProviderRef",
        "amountCents" AS "AmountCents", status AS "Status", reason AS "Reason",
        "initiatedBy" AS "InitiatedBy", note AS "Note",
        "createdAt" AS "CreatedAt", "settledAt" AS "SettledAt"
        """;

    public async Task CreateAsync(
        PaymentEntity payment, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO payments (
                id, "userId", kind, "orderId", "subscriptionId", "adoptionApplicationId", provider, "providerRef",
                "providerCustomerId", status, "amountCents", "amountRefundedCents", currency,
                "methodBrand", "methodLast4", "failureCode", "failureMessage", "lastEventAt",
                "createdAt", "updatedAt", "succeededAt")
            VALUES (
                @Id, @UserId, @Kind, @OrderId, @SubscriptionId, @AdoptionApplicationId, @Provider, @ProviderRef,
                @ProviderCustomerId, @Status, @AmountCents, @AmountRefundedCents, @Currency,
                @MethodBrand, @MethodLast4, @FailureCode, @FailureMessage, @LastEventAt,
                @CreatedAt, @UpdatedAt, @SucceededAt)
            """,
            payment, session.Transaction, cancellationToken: ct));
    }

    public Task<PaymentEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default)
        => OneAsync("id = @key", id, forUpdate: false, scope, ct);

    public Task<PaymentEntity?> GetByIdForUpdateAsync(
        string id, ITransactionScope scope, CancellationToken ct = default)
        => OneAsync("id = @key", id, forUpdate: true, scope, ct);

    public Task<PaymentEntity?> GetByProviderRefAsync(
        string providerRef, ITransactionScope? scope = null, CancellationToken ct = default)
        => OneAsync("\"providerRef\" = @key", providerRef, forUpdate: false, scope, ct);

    public Task<PaymentEntity?> GetByProviderRefForUpdateAsync(
        string providerRef, ITransactionScope scope, CancellationToken ct = default)
        => OneAsync("\"providerRef\" = @key", providerRef, forUpdate: true, scope, ct);

    private async Task<PaymentEntity?> OneAsync(
        string where, string key, bool forUpdate, ITransactionScope? scope, CancellationToken ct)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PaymentEntity>(
            new CommandDefinition(
                $"SELECT {Columns} FROM payments WHERE {where}{(forUpdate ? " FOR UPDATE" : "")}",
                new { key }, session.Transaction, cancellationToken: ct));
    }

    public async Task<PaymentEntity?> GetCurrentForOrderAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PaymentEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM payments
                 WHERE "orderId" = @orderId AND status <> @failed
                 ORDER BY "createdAt" DESC, id DESC
                 LIMIT 1
                 """,
                new { orderId, failed = PaymentStatuses.Failed },
                session.Transaction, cancellationToken: ct));
    }

    public Task<PaymentEntity?> GetForAdoptionAsync(
        string applicationId, ITransactionScope? scope = null, CancellationToken ct = default)
        => OneAsync("\"adoptionApplicationId\" = @key", applicationId, forUpdate: false, scope, ct);

    public async Task<PaymentEntity?> GetLatestForOrderAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<PaymentEntity>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM payments
                 WHERE "orderId" = @orderId
                 ORDER BY "createdAt" DESC, id DESC
                 LIMIT 1
                 """,
                new { orderId }, session.Transaction, cancellationToken: ct));
    }

    public async Task UpdateStateAsync(
        string id, string status, string failureCode, string failureMessage,
        string? methodBrand, string? methodLast4, DateTimeOffset? succeededAt,
        DateTimeOffset lastEventAt, DateTimeOffset updatedAt,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE payments SET
                status           = @status,
                "failureCode"    = @failureCode,
                "failureMessage" = @failureMessage,
                "methodBrand"    = COALESCE(NULLIF(@methodBrand, ''), "methodBrand"),
                "methodLast4"    = COALESCE(NULLIF(@methodLast4, ''), "methodLast4"),
                "succeededAt"    = COALESCE("succeededAt", @succeededAt::timestamptz),
                "lastEventAt"    = @lastEventAt,
                "updatedAt"      = @updatedAt
            WHERE id = @id
            """,
            new { id, status, failureCode, failureMessage, methodBrand, methodLast4, succeededAt, lastEventAt, updatedAt },
            session.Transaction, cancellationToken: ct));
    }

    public async Task TouchLastEventAsync(
        string id, DateTimeOffset lastEventAt, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE payments SET "lastEventAt" = GREATEST("lastEventAt", @lastEventAt) WHERE id = @id""",
            new { id, lastEventAt }, session.Transaction, cancellationToken: ct));
    }

    public async Task SetStatusAsync(
        string id, string status, int amountRefundedCents, DateTimeOffset updatedAt,
        DateTimeOffset? lastEventAt = null,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE payments SET
                status                = @status,
                "amountRefundedCents" = @amountRefundedCents,
                "lastEventAt"         = COALESCE(@lastEventAt::timestamptz, "lastEventAt"),
                "updatedAt"           = @updatedAt
            WHERE id = @id
            """,
            new { id, status, amountRefundedCents, updatedAt, lastEventAt },
            session.Transaction, cancellationToken: ct));
    }

    // ── Refunds ──────────────────────────────────────────────────────────

    public async Task CreateRefundAsync(
        RefundEntity refund, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO refunds (
                id, "paymentId", "providerRef", "amountCents", status, reason,
                "initiatedBy", note, "createdAt", "settledAt")
            VALUES (
                @Id, @PaymentId, @ProviderRef, @AmountCents, @Status, @Reason,
                @InitiatedBy, @Note, @CreatedAt, @SettledAt)
            """,
            refund, session.Transaction, cancellationToken: ct));
    }

    public async Task<RefundEntity?> GetRefundForUpdateAsync(
        string id, ITransactionScope scope, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<RefundEntity>(new CommandDefinition(
            $"SELECT {RefundColumns} FROM refunds WHERE id = @id FOR UPDATE",
            new { id }, session.Transaction, cancellationToken: ct));
    }

    public async Task<RefundEntity?> GetRefundByProviderRefAsync(
        string providerRef, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleOrDefaultAsync<RefundEntity>(new CommandDefinition(
            $"""SELECT {RefundColumns} FROM refunds WHERE "providerRef" = @providerRef""",
            new { providerRef }, session.Transaction, cancellationToken: ct));
    }

    public async Task<bool> HasPendingRefundAsync(
        string paymentId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """
            SELECT EXISTS (
              SELECT 1 FROM refunds
              WHERE "paymentId" = @paymentId
                AND (status = 'pending' OR (status = 'succeeded' AND "settledAt" IS NULL)))
            """,
            new { paymentId }, session.Transaction, cancellationToken: ct));
    }

    public async Task RecordRefundResponseAsync(
        string id, string providerRef, string status,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE refunds SET "providerRef" = @providerRef, status = @status WHERE id = @id""",
            new { id, providerRef, status }, session.Transaction, cancellationToken: ct));
    }

    public async Task SetRefundStatusAsync(
        string id, string status, string? note,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE refunds SET status = @status, note = COALESCE(@note, note) WHERE id = @id""",
            new { id, status, note }, session.Transaction, cancellationToken: ct));
    }

    public async Task MarkRefundSettledAsync(
        string id, DateTimeOffset settledAt, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        await session.Connection.ExecuteAsync(new CommandDefinition(
            """UPDATE refunds SET status = 'succeeded', "settledAt" = COALESCE("settledAt", @settledAt) WHERE id = @id""",
            new { id, settledAt }, session.Transaction, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<RefundEntity>> ListUnacknowledgedRefundsAsync(
        DateTimeOffset createdBefore, int limit, CancellationToken ct = default)
    {
        await using var conn = await db.OpenConnectionAsync(ct);
        var rows = await conn.QueryAsync<RefundEntity>(new CommandDefinition(
            $"""
             SELECT {RefundColumns} FROM refunds
             WHERE status = 'pending' AND "providerRef" IS NULL AND "createdAt" < @createdBefore
             ORDER BY "createdAt", id
             LIMIT @limit
             """,
            new { createdBefore, limit }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<IReadOnlyList<RefundEntity>> ListRefundsAsync(
        string paymentId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        var rows = await session.Connection.QueryAsync<RefundEntity>(new CommandDefinition(
            $"""SELECT {RefundColumns} FROM refunds WHERE "paymentId" = @paymentId ORDER BY "createdAt", id""",
            new { paymentId }, session.Transaction, cancellationToken: ct));
        return rows.ToList();
    }
}
