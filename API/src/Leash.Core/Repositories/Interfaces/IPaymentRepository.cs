using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// <c>payments</c> and <c>refunds</c> — the ledger. No rule lives here; the
/// transition table and the refund accounting are <c>PaymentLedger</c>'s.
/// The <c>…ForUpdate</c> reads take a row lock and need a scope.
/// </summary>
public interface IPaymentRepository
{
    Task CreateAsync(
        PaymentEntity payment, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<PaymentEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<PaymentEntity?> GetByIdForUpdateAsync(
        string id, ITransactionScope scope, CancellationToken ct = default);

    Task<PaymentEntity?> GetByProviderRefAsync(
        string providerRef, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<PaymentEntity?> GetByProviderRefForUpdateAsync(
        string providerRef, ITransactionScope scope, CancellationToken ct = default);

    /// <summary>
    /// The order's live payment: the newest row that has not failed. Not a
    /// unique index on <c>orderId</c>, because a customer whose first intent
    /// failed must be able to try again, and the dead attempt is part of the
    /// record rather than something to overwrite.
    /// </summary>
    Task<PaymentEntity?> GetCurrentForOrderAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The order's newest payment whatever its state — what a sync asks the provider about.</summary>
    Task<PaymentEntity?> GetLatestForOrderAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Write a provider state onto a payment. Empty brand/last-four leave the
    /// recorded ones alone; <paramref name="succeededAt"/> is kept once set.
    /// </summary>
    Task UpdateStateAsync(
        string id, string status, string failureCode, string failureMessage,
        string? methodBrand, string? methodLast4, DateTimeOffset? succeededAt,
        DateTimeOffset lastEventAt, DateTimeOffset updatedAt,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Record that an event was seen without changing the status — a later, older one is then stale.</summary>
    Task TouchLastEventAsync(
        string id, DateTimeOffset lastEventAt, ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetStatusAsync(
        string id, string status, int amountRefundedCents, DateTimeOffset updatedAt,
        DateTimeOffset? lastEventAt = null,
        ITransactionScope? scope = null, CancellationToken ct = default);

    // ── Refunds ──────────────────────────────────────────────────────────

    Task CreateRefundAsync(
        RefundEntity refund, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<RefundEntity?> GetRefundForUpdateAsync(
        string id, ITransactionScope scope, CancellationToken ct = default);

    Task<RefundEntity?> GetRefundByProviderRefAsync(
        string providerRef, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// A refund still in flight: pending at the provider, or confirmed by it
    /// but not yet folded into the payment's totals. Both mean the totals do
    /// not yet say what has gone back, so a second refund must wait.
    /// </summary>
    Task<bool> HasPendingRefundAsync(
        string paymentId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>What the provider said: its reference, and its status.</summary>
    Task RecordRefundResponseAsync(
        string id, string providerRef, string status,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetRefundStatusAsync(
        string id, string status, string? note,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task MarkRefundSettledAsync(
        string id, DateTimeOffset settledAt, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Pending refunds the provider never acknowledged, created before <paramref name="createdBefore"/>.</summary>
    Task<IReadOnlyList<RefundEntity>> ListUnacknowledgedRefundsAsync(
        DateTimeOffset createdBefore, int limit, CancellationToken ct = default);

    Task<IReadOnlyList<RefundEntity>> ListRefundsAsync(
        string paymentId, ITransactionScope? scope = null, CancellationToken ct = default);
}
