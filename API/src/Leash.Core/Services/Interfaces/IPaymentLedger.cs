using Leash.Core.Models.Entities;
using Leash.Core.Payments;

namespace Leash.Core.Services.Interfaces;

public enum ApplyFailure { UnknownPayment, StaleEvent, IllegalTransition, AmountMismatch }

/// <summary>What folding one provider state into the ledger did.</summary>
public sealed record ApplyResult(
    bool Ok, string? Status, bool Changed, ApplyFailure? Failure = null,
    string? From = null, int? Expected = null, int? Actual = null)
{
    public static ApplyResult Applied(string status, bool changed) => new(true, status, changed);
    public static ApplyResult Refused(ApplyFailure failure) => new(false, null, false, failure);
}

/// <summary>Send money back. Name the payment, or the order whose current payment it is.</summary>
/// <param name="AmountCents">Null refunds everything still refundable.</param>
/// <param name="InitiatedBy">A staff user id, <c>system</c>, or <c>stripe</c> for a dashboard refund.</param>
public sealed record RefundRequest(
    string? OrderId = null,
    string? PaymentId = null,
    int? AmountCents = null,
    string? Reason = null,
    string? InitiatedBy = null,
    string? Note = null);

public enum RefundFailure
{
    NoPayment,
    NotRefundable,
    AlreadyRefunding,
    ExceedsCaptured,

    /// <summary>The provider refused it. The refund row is <c>failed</c>; nothing is owed a retry.</summary>
    ProviderFailed,

    /// <summary>
    /// The provider could not be reached or answered ambiguously. The refund row
    /// stays <c>pending</c> and the housekeeping job retries it under the same
    /// idempotency key — it may already have gone through.
    /// </summary>
    ProviderUnavailable,
}

public sealed record RefundOutcome(
    bool Ok, string? RefundId, int AmountCents, RefundFailure? Failure = null,
    string? PaymentStatus = null, int? RemainingCents = null, string? Message = null);

/// <summary>
/// The payment ledger: the one place a payment's status is written
/// (REQUIREMENTS.md M4, M8, M9).
///
/// <see cref="ApplyIntentStateAsync"/> is the reconciler, and it has exactly
/// three callers — the Stripe webhook, the inline settle a synchronous provider
/// takes, and the sync a confirmation page calls when a webhook is slow. One
/// function for all three is the point (M3): the demo path and the real path
/// cannot drift, because there is only one path.
/// </summary>
public interface IPaymentLedger
{
    /// <summary>
    /// Fold a provider intent state into the ledger. Idempotent — the same state
    /// twice is a no-op, which is what makes webhook replay safe.
    ///
    /// <paramref name="eventAt"/> is the provider event's own creation time
    /// (now, when omitted). Webhooks arrive out of order, and last-writer-wins is
    /// only correct if "last" means most recently <i>created</i>: otherwise a
    /// delayed failure notice can overwrite a later success.
    ///
    /// The amount is re-checked. If the provider settled a different sum than we
    /// recorded, the payment is marked failed rather than paid — either the order
    /// was re-priced under us or the intent is not the one we think it is.
    /// </summary>
    Task<ApplyResult> ApplyIntentStateAsync(
        PaymentIntent intent, DateTimeOffset? eventAt = null, CancellationToken ct = default);

    /// <summary>
    /// Send money back, fully or in part (M8). The refund row is written
    /// <c>pending</c>, under a lock on the payment, <b>before</b> the provider is
    /// called — so a crash or a timeout in between leaves a row to retry rather
    /// than money nobody knows is owed, and two concurrent refunds cannot both
    /// pass the "already refunding?" check.
    /// </summary>
    Task<RefundOutcome> RequestRefundAsync(RefundRequest request, CancellationToken ct = default);

    /// <summary>
    /// Mark a refund settled and move the payment's totals, and the order's
    /// mirrored <c>paymentStatus</c>, in one transaction. Idempotent: a refund
    /// already counted is not counted again. Called by
    /// <see cref="RequestRefundAsync"/> for a synchronous provider and by the
    /// <c>charge.refunded</c> webhook for a real one.
    /// </summary>
    Task SettleRefundAsync(string refundId, CancellationToken ct = default);

    /// <summary>
    /// Re-send refunds left <c>pending</c> without a provider reference — the
    /// provider never acknowledged them — and older than
    /// <paramref name="olderThan"/>. Same idempotency key, so one that did go
    /// through is not sent twice. Returns how many were retried.
    /// </summary>
    Task<int> RetryUnacknowledgedRefundsAsync(
        DateTimeOffset now, TimeSpan olderThan, CancellationToken ct = default);

    /// <summary>The order's live payment: the newest row that has not failed.</summary>
    Task<PaymentEntity?> CurrentForOrderAsync(string orderId, CancellationToken ct = default);

    /// <summary>
    /// Fold in a refund the provider reports — one issued from Stripe's own
    /// dashboard, which is how finance staff often do it, or one of ours whose
    /// settlement has arrived. Matched on the provider's refund id, so it is
    /// recorded once however often it is reported.
    /// </summary>
    Task ReconcileProviderRefundAsync(
        string paymentId, string providerRefundRef, int amountCents, string status, string? reason,
        DateTimeOffset createdAt, CancellationToken ct = default);

    /// <summary>
    /// A chargeback opened, won or lost. Opened → <c>disputed</c>; won → back
    /// to <c>paid</c>; lost → the money is gone, counted as refunded in full.
    /// </summary>
    Task<ApplyResult> ApplyDisputeAsync(
        string intentRef, DisputeOutcome outcome, DateTimeOffset eventAt, CancellationToken ct = default);
}

public enum DisputeOutcome { Opened, Won, Lost }

public static class PaymentLedgerExtensions
{
    /// <summary>A Stripe dispute event onto an outcome: <c>created</c> opens one; <c>closed</c> is won or lost.</summary>
    public static DisputeOutcome DisputeOutcomeFor(string? stripeStatus, bool closed)
        => !closed ? DisputeOutcome.Opened : stripeStatus == "won" ? DisputeOutcome.Won : DisputeOutcome.Lost;
}
