using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Stripe;
using SubscriptionStatuses = Leash.Core.Models.Enums.SubscriptionStatuses;

namespace Leash.Core.Payments;

/// <summary>
/// Turning Stripe events into changes in this application — the port of the
/// reference's <c>lib/server/webhooks/stripe.ts</c>.
///
/// Two rules govern every branch, and both are about what status the route
/// returns rather than what the database ends up saying:
///
///  1. <b>A business-level "no" is a skip, and a skip is a 200.</b> An event
///     asking for something impossible — an illegal transition, a subject we
///     cannot resolve, a type we do not handle — will be refused identically on
///     every retry. A 500 would buy a three-day redelivery storm.
///  2. <b>A transient failure throws</b>, the intake records it and answers
///     500, and Stripe redelivers.
///
/// Everything is keyed on the event's <c>created</c> time, never on arrival.
/// Every write goes through the ledger, the reconciler or the order lifecycle;
/// nothing here touches a table.
/// </summary>
public sealed class StripeWebhookHandler(
    IPaymentLedger ledger,
    IPaymentRepository payments,
    IOrderRepository orders,
    IOrderLifecycle lifecycle,
    ISubscriptionReconciler reconciler,
    INotifier notifier) : IStripeWebhookHandler
{
    public async Task<WebhookHandled> HandleAsync(Event evt, CancellationToken ct = default)
    {
        var eventAt = new DateTimeOffset(DateTime.SpecifyKind(evt.Created, DateTimeKind.Utc));

        switch (evt.Type)
        {
            // ── One-off store payments ───────────────────────────────────
            case "payment_intent.succeeded":
            case "payment_intent.payment_failed":
            case "payment_intent.processing":
            case "payment_intent.requires_action":
            case "payment_intent.canceled":
                return await IntentAsync(evt, eventAt, ct);

            case "charge.refunded":
                return await RefundsAsync(evt, ct);

            case "charge.dispute.created":
            case "charge.dispute.closed":
                return await DisputeAsync(evt, eventAt, ct);

            // ── Membership ───────────────────────────────────────────────
            case "checkout.session.completed":
                return await CheckoutCompletedAsync(evt, ct);

            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
                return await SubscriptionAsync(evt, eventAt, ct);

            case "invoice.paid":
                return await InvoicePaidAsync(evt, ct);

            case "invoice.payment_failed":
            case "invoice.payment_action_required":
                return await InvoiceTroubleAsync(evt, ct);

            default:
                // Stripe endpoints receive types nobody subscribed to. Not an error.
                return WebhookHandled.Skip(WebhookSkipReasons.UnknownType);
        }
    }

    private async Task<WebhookHandled> IntentAsync(Event evt, DateTimeOffset eventAt, CancellationToken ct)
    {
        if (evt.Data.Object is not Stripe.PaymentIntent pi) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        // `payment_failed` arrives carrying an intent whose status has already
        // reverted to requires_payment_method, because Stripe keeps it
        // retryable. Reading the object would record a decline as "pending" and
        // lose the failure code. The event type is the authority on what
        // happened; the object only on what is true now.
        var status = evt.Type == "payment_intent.payment_failed" ? IntentStatuses.Failed : null;

        // The client secret is in the payload; it goes no further.
        var intent = StripePaymentProvider.ToIntent(pi, status) with { ClientSecret = null };

        var applied = await ledger.ApplyIntentStateAsync(intent, eventAt, ct);
        if (!applied.Ok)
        {
            return WebhookHandled.Skip(applied.Failure switch
            {
                ApplyFailure.UnknownPayment => WebhookSkipReasons.UnknownSubject,
                ApplyFailure.StaleEvent => WebhookSkipReasons.Stale,
                // Illegal, or the wrong amount: recorded, and not going to
                // resolve itself on a retry.
                _ => WebhookSkipReasons.NoopTransition,
            });
        }

        // Our own row says which order this pays for — not the event's
        // metadata, which is only as good as whoever created the intent.
        var orderId = (await payments.GetByProviderRefAsync(pi.Id, ct: ct))?.OrderId;
        if (orderId is null) return WebhookHandled.Did($"payment {applied.Status}");

        if (applied.Status == PaymentStatuses.Paid)
        {
            await lifecycle.SettleAsync(orderId, ct);
            return WebhookHandled.Did($"order {orderId} paid");
        }

        if (applied.Status == PaymentStatuses.Failed && evt.Type == "payment_intent.canceled")
        {
            // Cancelled outright: give the stock back.
            await lifecycle.MoveAsync(orderId, OrderStatuses.Cancelled, new OrderMove(InitiatedBy: "stripe"), ct);
            return WebhookHandled.Did($"order {orderId} cancelled");
        }

        if (applied.Status == PaymentStatuses.Failed && applied.Changed)
        {
            // A decline: the order stays where it is, and the customer is told
            // they can try another card.
            if (await orders.GetByIdAsync(orderId, ct: ct) is { } order)
                await notifier.NotifyAsync(order.UserId, Notices.OrderPaymentFailed(orderId), ct: ct);
            return WebhookHandled.Did($"order {orderId} payment failed");
        }

        return WebhookHandled.Did($"payment {applied.Status}");
    }

    private async Task<WebhookHandled> RefundsAsync(Event evt, CancellationToken ct)
    {
        if (evt.Data.Object is not Charge charge || string.IsNullOrEmpty(charge.PaymentIntentId))
            return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var payment = await payments.GetByProviderRefAsync(charge.PaymentIntentId, ct: ct);
        if (payment is null) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        // Every refund Stripe knows about, against our rows — which is what
        // makes a refund issued from Stripe's dashboard flow back in.
        foreach (var r in charge.Refunds?.Data ?? [])
        {
            await ledger.ReconcileProviderRefundAsync(
                payment.Id, r.Id, (int)r.Amount,
                r.Status switch
                {
                    "succeeded" => RefundStatuses.Succeeded,
                    "failed" => RefundStatuses.Failed,
                    "canceled" => RefundStatuses.Canceled,
                    _ => RefundStatuses.Pending,
                },
                r.Reason,
                new DateTimeOffset(DateTime.SpecifyKind(r.Created, DateTimeKind.Utc)), ct);
        }

        // Fully refunded money on a live order: the order follows.
        var after = await payments.GetByIdAsync(payment.Id, ct: ct);
        if (after is { Status: PaymentStatuses.Refunded, OrderId: { } orderId }
            && await orders.GetByIdAsync(orderId, ct: ct) is { } order
            && order.Status is not (OrderStatuses.Refunded or OrderStatuses.Cancelled))
        {
            await lifecycle.MoveAsync(orderId, OrderStatuses.Refunded, new OrderMove(InitiatedBy: "stripe"), ct);
        }

        return WebhookHandled.Did($"refunds reconciled for {charge.PaymentIntentId}");
    }

    private async Task<WebhookHandled> DisputeAsync(Event evt, DateTimeOffset eventAt, CancellationToken ct)
    {
        if (evt.Data.Object is not Dispute dispute || string.IsNullOrEmpty(dispute.PaymentIntentId))
            return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var outcome = PaymentLedgerExtensions.DisputeOutcomeFor(dispute.Status, closed: evt.Type == "charge.dispute.closed");
        var applied = await ledger.ApplyDisputeAsync(dispute.PaymentIntentId, outcome, eventAt, ct);

        return applied.Ok
            ? WebhookHandled.Did($"dispute {dispute.Status}")
            : WebhookHandled.Skip(applied.Failure switch
            {
                ApplyFailure.UnknownPayment => WebhookSkipReasons.UnknownSubject,
                ApplyFailure.StaleEvent => WebhookSkipReasons.Stale,
                _ => WebhookSkipReasons.NoopTransition,
            });
    }

    private async Task<WebhookHandled> CheckoutCompletedAsync(Event evt, CancellationToken ct)
    {
        if (evt.Data.Object is not Stripe.Checkout.Session session || session.Mode != "subscription")
            return WebhookHandled.Skip(WebhookSkipReasons.UnknownType);

        if (string.IsNullOrEmpty(session.ClientReferenceId) || string.IsNullOrEmpty(session.CustomerId))
            return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        // Remember the customer, so a returning member is not billed as a
        // stranger (M15) and the portal can be opened for them. The subscription
        // itself arrives on customer.subscription.created.
        await reconciler.LinkCustomerAsync(session.ClientReferenceId, session.CustomerId, ct);
        return WebhookHandled.Did($"customer {session.CustomerId} linked to {session.ClientReferenceId}");
    }

    private async Task<WebhookHandled> SubscriptionAsync(Event evt, DateTimeOffset eventAt, CancellationToken ct)
    {
        if (evt.Data.Object is not Subscription sub) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var customerRef = sub.CustomerId ?? "";
        var userId = sub.Metadata?.GetValueOrDefault("userId")
                     ?? await reconciler.FindUserForCustomerAsync(customerRef, ct);
        if (string.IsNullOrEmpty(userId)) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var current = StripeSubscriptionProvider.ToSubscription(sub);
        var plan = await reconciler.PlanForPriceAsync(current.PriceId, ct);
        if (plan is null) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var result = await reconciler.ApplyAsync(new SubscriptionSnapshot(
            current.Ref,
            "stripe",
            customerRef,
            evt.Type == "customer.subscription.deleted" ? SubscriptionStatuses.Canceled : current.Status,
            current.CurrentPeriodStart,
            current.CurrentPeriodEnd,
            current.CancelAtPeriodEnd,
            sub.CanceledAt is { } canceled ? new DateTimeOffset(DateTime.SpecifyKind(canceled, DateTimeKind.Utc)) : null,
            sub.EndedAt is { } ended ? new DateTimeOffset(DateTime.SpecifyKind(ended, DateTimeKind.Utc)) : null,
            sub.LatestInvoiceId ?? "",
            plan.Id,
            userId), eventAt, ct);

        if (!result.Ok)
        {
            return WebhookHandled.Skip(result.Failure == SnapshotFailure.Stale
                ? WebhookSkipReasons.Stale
                : WebhookSkipReasons.UnknownSubject);
        }

        return WebhookHandled.Did($"subscription {sub.Id} → {sub.Status}");
    }

    private async Task<WebhookHandled> InvoicePaidAsync(Event evt, CancellationToken ct)
    {
        if (evt.Data.Object is not Invoice invoice || string.IsNullOrEmpty(invoice.Id))
            return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var userId = await reconciler.FindUserForCustomerAsync(invoice.CustomerId ?? "", ct);
        if (userId is null) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        // A ledger row per renewal, so the finance console can show a member's
        // billing history without asking Stripe.
        await reconciler.RecordInvoiceAsync(
            userId, "stripe", invoice.Id, invoice.CustomerId ?? "", (int)invoice.AmountPaid, invoice.Currency ?? "usd", ct);
        return WebhookHandled.Did($"invoice {invoice.Id} recorded");
    }

    private async Task<WebhookHandled> InvoiceTroubleAsync(Event evt, CancellationToken ct)
    {
        if (evt.Data.Object is not Invoice invoice) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        var userId = await reconciler.FindUserForCustomerAsync(invoice.CustomerId ?? "", ct);
        if (userId is null) return WebhookHandled.Skip(WebhookSkipReasons.UnknownSubject);

        // The status change itself arrives on customer.subscription.updated,
        // which is where the dunning notice is sent from. This branch only
        // speaks when the bank wants the member to act.
        if (evt.Type == "invoice.payment_action_required")
            await notifier.NotifyAsync(userId, Notices.MembershipActionRequired(), ct: ct);

        return WebhookHandled.Did($"invoice trouble for {userId}");
    }
}
