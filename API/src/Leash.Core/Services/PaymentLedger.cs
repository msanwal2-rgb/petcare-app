using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace Leash.Core.Services;

/// <summary>See <see cref="IPaymentLedger"/>.</summary>
public sealed class PaymentLedger(
    IPaymentRepository payments,
    IOrderRepository orders,
    IPaymentProvider provider,
    IUnitOfWork unitOfWork,
    ILogger<PaymentLedger> log) : IPaymentLedger
{
    public async Task<ApplyResult> ApplyIntentStateAsync(
        PaymentIntent intent, DateTimeOffset? eventAt = null, CancellationToken ct = default)
    {
        var now = Ids.Now();
        var at = eventAt ?? now;

        await using var scope = await unitOfWork.BeginAsync(ct);

        // Locked: two deliveries of different events about one intent must not
        // both read "pending" and both write.
        var payment = await payments.GetByProviderRefForUpdateAsync(intent.Ref, scope, ct);
        if (payment is null) return ApplyResult.Refused(ApplyFailure.UnknownPayment);

        if (payment.LastEventAt is { } last && at < last)
            return ApplyResult.Refused(ApplyFailure.StaleEvent);

        var from = payment.Status;
        var to = PaymentTransitions.StatusForIntent(intent.Status);

        if (from == to)
        {
            // Already there. Still record that this event was seen, so a
            // genuinely older one arriving afterwards is recognised as stale.
            await payments.TouchLastEventAsync(payment.Id, at, scope, ct);
            await scope.CommitAsync(ct);
            return ApplyResult.Applied(to, changed: false);
        }

        if (!PaymentTransitions.CanTransition(from, to))
            return new ApplyResult(false, null, false, ApplyFailure.IllegalTransition, From: from);

        // The provider reporting 0 means "did not say" (the demo's getIntent);
        // anything else must be what we recorded, or this is not our charge.
        if (to == PaymentStatuses.Paid && intent.AmountCents > 0 && intent.AmountCents != payment.AmountCents)
        {
            await payments.UpdateStateAsync(
                payment.Id, PaymentStatuses.Failed, "amount_mismatch",
                $"Provider charged {intent.AmountCents}, order expected {payment.AmountCents}",
                null, null, null, at, now, scope, ct);
            await MirrorAsync(payment, PaymentStatuses.Failed, scope, ct);
            await scope.CommitAsync(ct);

            log.LogError("Payment {PaymentId}: provider charged {Actual}, expected {Expected}",
                payment.Id, intent.AmountCents, payment.AmountCents);
            return new ApplyResult(false, null, false, ApplyFailure.AmountMismatch,
                Expected: payment.AmountCents, Actual: intent.AmountCents);
        }

        await payments.UpdateStateAsync(
            payment.Id, to, intent.FailureCode ?? "", intent.FailureMessage ?? "",
            intent.MethodBrand, intent.MethodLast4,
            to == PaymentStatuses.Paid ? now : null, at, now, scope, ct);

        // `paid` is mirrored by settlement, which also releases the hold and
        // moves the order — doing half of that here would let the two disagree.
        if (to != PaymentStatuses.Paid) await MirrorAsync(payment, to, scope, ct);

        await scope.CommitAsync(ct);
        return ApplyResult.Applied(to, changed: true);
    }

    /// <summary>
    /// Keep the order's own <c>paymentStatus</c> in step. It is a denormalised
    /// copy — the ledger is the record — but it is what the customer's order
    /// page and the fulfilment queue read, so it changes in the same
    /// transaction or not at all.
    /// </summary>
    private Task MirrorAsync(PaymentEntity payment, string status, ITransactionScope scope, CancellationToken ct)
        => payment.OrderId is null
            ? Task.CompletedTask
            : orders.SetPaymentAsync(payment.OrderId, status, paymentRef: null, releaseHold: false, scope, ct);

    public async Task<RefundOutcome> RequestRefundAsync(RefundRequest request, CancellationToken ct = default)
    {
        var paymentId = request.PaymentId
            ?? (request.OrderId is null ? null : (await payments.GetCurrentForOrderAsync(request.OrderId, ct: ct))?.Id);
        if (paymentId is null) return Refused(RefundFailure.NoPayment);

        RefundEntity refund;
        string providerRef;

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            // The lock is what makes "already refunding?" true by the time the
            // INSERT lands: two refunds at once queue here, and the second sees
            // the first's pending row.
            var payment = await payments.GetByIdForUpdateAsync(paymentId, scope, ct);
            if (payment is null) return Refused(RefundFailure.NoPayment);

            if (!PaymentTransitions.Refundable.Contains(payment.Status))
                return new RefundOutcome(false, null, 0, RefundFailure.NotRefundable, payment.Status);

            if (await payments.HasPendingRefundAsync(payment.Id, scope, ct))
                return Refused(RefundFailure.AlreadyRefunding);

            var remaining = Math.Max(0, payment.AmountCents - payment.AmountRefundedCents);
            var amount = request.AmountCents ?? remaining;
            if (amount <= 0 || amount > remaining)
                return new RefundOutcome(false, null, 0, RefundFailure.ExceedsCaptured, RemainingCents: remaining);

            refund = new RefundEntity
            {
                Id = Ids.New("rfnd"),
                PaymentId = payment.Id,
                ProviderRef = null,
                AmountCents = amount,
                Status = RefundStatuses.Pending,
                Reason = request.Reason ?? RefundReasons.RequestedByCustomer,
                InitiatedBy = request.InitiatedBy ?? "system",
                Note = request.Note ?? "",
                CreatedAt = Ids.Now(),
            };

            // Written before anybody is called. A crash or a timeout from here
            // on leaves a row that says money is owed.
            await payments.CreateRefundAsync(refund, scope, ct);
            await scope.CommitAsync(ct);
            providerRef = payment.ProviderRef;
        }

        return await SendAsync(refund, providerRef, ct);
    }

    /// <summary>Ask the provider, under the refund row's id as the idempotency key, and record what it said.</summary>
    private async Task<RefundOutcome> SendAsync(RefundEntity refund, string providerRef, CancellationToken ct)
    {
        ProviderRefund result;
        try
        {
            result = await provider.RefundAsync(providerRef, refund.AmountCents, refund.Reason, refund.Id, ct);
        }
        catch (PaymentProviderException e) when (e.Definitive)
        {
            await payments.SetRefundStatusAsync(refund.Id, RefundStatuses.Failed, e.Message, ct: CancellationToken.None);
            return new RefundOutcome(false, refund.Id, refund.AmountCents, RefundFailure.ProviderFailed, Message: e.Message);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // We do not know whether it happened. Leave it pending; the sweep
            // asks again under the same key, and the provider deduplicates.
            log.LogWarning(e, "Refund {RefundId} not confirmed by the provider; left pending for retry", refund.Id);
            await payments.SetRefundStatusAsync(
                refund.Id, RefundStatuses.Pending, $"Not confirmed by the provider: {e.Message}", ct: CancellationToken.None);
            return new RefundOutcome(false, refund.Id, refund.AmountCents, RefundFailure.ProviderUnavailable, Message: e.Message);
        }

        // Note what is not set here: settledAt. That is SettleRefundAsync's to
        // write, and it is how it knows an amount has already been counted.
        await payments.RecordRefundResponseAsync(refund.Id, result.Ref, result.Status, ct: ct);

        switch (result.Status)
        {
            case RefundStatuses.Succeeded:
                // A synchronous provider (the demo) is done here. A real one says
                // pending, and charge.refunded settles it — one place either way.
                await SettleRefundAsync(refund.Id, ct);
                break;
            case RefundStatuses.Failed or RefundStatuses.Canceled:
                return new RefundOutcome(false, refund.Id, refund.AmountCents, RefundFailure.ProviderFailed,
                    Message: $"The provider reported the refund {result.Status}");
        }

        return new RefundOutcome(true, refund.Id, refund.AmountCents);
    }

    public async Task SettleRefundAsync(string refundId, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var refund = await payments.GetRefundForUpdateAsync(refundId, scope, ct);
        if (refund is null) return;

        // Already folded into the totals: counting it again would refund the
        // same money twice on paper.
        if (refund.Status == RefundStatuses.Succeeded && refund.SettledAt is not null) return;

        var payment = await payments.GetByIdForUpdateAsync(refund.PaymentId, scope, ct);
        if (payment is null) return;

        var refunded = Math.Min(payment.AmountRefundedCents + refund.AmountCents, payment.AmountCents);
        var next = refunded >= payment.AmountCents ? PaymentStatuses.Refunded : PaymentStatuses.PartiallyRefunded;
        var status = PaymentTransitions.CanTransition(payment.Status, next) ? next : payment.Status;
        var now = Ids.Now();

        await payments.MarkRefundSettledAsync(refund.Id, now, scope, ct);
        await payments.SetStatusAsync(payment.Id, status, refunded, now, scope: scope, ct: ct);
        await MirrorAsync(payment, status, scope, ct);

        await scope.CommitAsync(ct);
    }

    public async Task<int> RetryUnacknowledgedRefundsAsync(
        DateTimeOffset now, TimeSpan olderThan, CancellationToken ct = default)
    {
        var due = await payments.ListUnacknowledgedRefundsAsync(now - olderThan, limit: 50, ct);
        var retried = 0;

        foreach (var refund in due)
        {
            var payment = await payments.GetByIdAsync(refund.PaymentId, ct: ct);
            if (payment is null) continue;

            await SendAsync(refund, payment.ProviderRef, ct);
            retried++;
        }

        return retried;
    }

    public Task<PaymentEntity?> CurrentForOrderAsync(string orderId, CancellationToken ct = default)
        => payments.GetCurrentForOrderAsync(orderId, ct: ct);

    public async Task ReconcileProviderRefundAsync(
        string paymentId, string providerRefundRef, int amountCents, string status, string? reason,
        DateTimeOffset createdAt, CancellationToken ct = default)
    {
        var succeeded = status == RefundStatuses.Succeeded;
        var existing = await payments.GetRefundByProviderRefAsync(providerRefundRef, ct: ct);

        if (existing is not null)
        {
            // One of ours, or one already recorded: only its settlement is news.
            if (succeeded && existing.SettledAt is null) await SettleRefundAsync(existing.Id, ct);
            return;
        }

        var id = $"rfnd_{providerRefundRef}";
        await payments.CreateRefundAsync(new RefundEntity
        {
            Id = id,
            PaymentId = paymentId,
            ProviderRef = providerRefundRef,
            AmountCents = amountCents,
            Status = succeeded ? RefundStatuses.Succeeded : RefundStatuses.Pending,
            Reason = reason ?? "",
            // The provider's doing, not ours — so the console can tell a
            // dashboard refund from one a member of staff issued here.
            InitiatedBy = "stripe",
            Note = "Recorded from a provider event",
            CreatedAt = createdAt,
        }, ct: ct);

        if (succeeded) await SettleRefundAsync(id, ct);
    }

    public async Task<ApplyResult> ApplyDisputeAsync(
        string intentRef, DisputeOutcome outcome, DateTimeOffset eventAt, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var payment = await payments.GetByProviderRefForUpdateAsync(intentRef, scope, ct);
        if (payment is null) return ApplyResult.Refused(ApplyFailure.UnknownPayment);

        if (payment.LastEventAt is { } last && eventAt < last)
            return ApplyResult.Refused(ApplyFailure.StaleEvent);

        var (to, refunded) = outcome switch
        {
            DisputeOutcome.Opened => (PaymentStatuses.Disputed, payment.AmountRefundedCents),
            DisputeOutcome.Won => (PaymentStatuses.Paid, payment.AmountRefundedCents),
            _ => (PaymentStatuses.Refunded, payment.AmountCents),
        };

        if (!PaymentTransitions.CanTransition(payment.Status, to))
            return new ApplyResult(false, null, false, ApplyFailure.IllegalTransition, From: payment.Status);

        await payments.SetStatusAsync(payment.Id, to, refunded, Ids.Now(), eventAt, scope, ct);
        await MirrorAsync(payment, to, scope, ct);
        await scope.CommitAsync(ct);

        return ApplyResult.Applied(to, changed: payment.Status != to);
    }

    private static RefundOutcome Refused(RefundFailure failure) => new(false, null, 0, failure);
}
