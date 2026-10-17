using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace Leash.Core.Services;

/// <summary>
/// The order state machine. See <see cref="IOrderLifecycle"/> for why it has no
/// caller and why controllers never see it.
/// </summary>
public sealed class OrderLifecycle(
    IOrderRepository orders,
    ICatalogRepository catalog,
    IPaymentRepository payments,
    IPaymentLedger ledger,
    IPaymentProvider provider,
    INotifier notifier,
    IUnitOfWork unitOfWork,
    ILogger<OrderLifecycle> log) : IOrderLifecycle
{
    /// <summary>
    /// What may follow what (REQUIREMENTS.md §11.3).
    ///
    /// Once an order is with the carrier the customer cancels by refusing
    /// delivery, so from <c>shipped</c> onward the only way back is a refund.
    /// <c>cancelled</c> and <c>refunded</c> are terminal.
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new()
    {
        [OrderStatuses.PendingPayment] = [OrderStatuses.Paid, OrderStatuses.Cancelled],
        [OrderStatuses.Paid] =
            [OrderStatuses.Processing, OrderStatuses.Cancelled, OrderStatuses.Refunded],
        [OrderStatuses.Processing] =
            [OrderStatuses.Packed, OrderStatuses.Cancelled, OrderStatuses.Refunded],
        [OrderStatuses.Packed] =
            [OrderStatuses.Shipped, OrderStatuses.Cancelled, OrderStatuses.Refunded],
        [OrderStatuses.Shipped] = [OrderStatuses.OutForDelivery, OrderStatuses.Refunded],
        [OrderStatuses.OutForDelivery] = [OrderStatuses.Delivered, OrderStatuses.Refunded],
        [OrderStatuses.Delivered] = [OrderStatuses.Refunded],
        [OrderStatuses.Cancelled] = [],
        [OrderStatuses.Refunded] = [],
    };

    /// <summary>The customer-facing copy for each step of the journey (REQUIREMENTS.md S14).</summary>
    private static readonly Dictionary<string, (string Label, string Description)> EventCopy = new()
    {
        [OrderStatuses.PendingPayment] = ("Order placed", "We're waiting for your payment to clear."),
        [OrderStatuses.Paid] = ("Payment confirmed", "We've received your payment."),
        [OrderStatuses.Processing] = ("Preparing your order", "Picking items in the fulfilment centre."),
        [OrderStatuses.Packed] = ("Packed", "Your order is boxed and labelled."),
        [OrderStatuses.Shipped] = ("Shipped", "Handed to the carrier."),
        [OrderStatuses.OutForDelivery] = ("Out for delivery", "On the van and heading your way."),
        [OrderStatuses.Delivered] = ("Delivered", "Left at the delivery address."),
        [OrderStatuses.Cancelled] = ("Cancelled", "This order was cancelled and any stock returned."),
        [OrderStatuses.Refunded] = ("Refunded", "The payment has been returned."),
    };

    /// <summary>A payment in one of these has taken no money yet; leaving the order cancels its intent.</summary>
    private static readonly string[] NotYetTaken =
    [
        PaymentStatuses.Unpaid, PaymentStatuses.Pending, PaymentStatuses.RequiresAction, PaymentStatuses.Failed,
    ];

    public static OrderEventEntity EventFor(
        string orderId, string status, DateTimeOffset at, string? location = null)
    {
        var (label, description) = EventCopy[status];
        return new OrderEventEntity
        {
            Id = Ids.New("oe"),
            OrderId = orderId,
            Status = status,
            Label = label,
            Description = description,
            Location = location,
            OccurredAt = at,
        };
    }

    /// <summary>
    /// Move an order.
    ///
    /// Three things here are money bugs in the reference implementation that
    /// were fixed there and must not come back:
    ///
    ///  1. <b>Cancelling a paid order refunds it.</b> The original restocked
    ///     the items, set <c>cancelled</c>, and left <c>paymentStatus</c> at
    ///     <c>paid</c> — the customer's money simply stayed with us.
    ///  2. <b>Restocking happens only if the goods never shipped</b> (see
    ///     <see cref="Delivery.ShippedOut"/>). A refund on a delivered order
    ///     returns money, not stock.
    ///  3. <b>The move is conditional on the status that was read.</b> Three
    ///     writers can move an order, and without the guard two of them both
    ///     pass the transition check.
    ///
    /// The refund happens <i>after</i> the status commits, because it is a call
    /// to a third party and a database transaction must not be held open across
    /// one. That is safe because <see cref="IPaymentLedger.RequestRefundAsync"/>
    /// writes its pending row before it calls anybody: a provider that times out
    /// leaves a refund the housekeeping job retries, not money nobody knows is owed.
    /// </summary>
    public async Task<(OrderDto? Order, OrderFailure? Failure)> MoveAsync(
        string orderId, string to, OrderMove? move = null, CancellationToken ct = default)
    {
        move ??= new OrderMove();

        var order = await orders.GetByIdAsync(orderId, ct: ct);
        if (order is null) return (null, OrderFailure.NotFound);

        var from = order.Status;
        if (from == to) return (await LoadAsync(orderId, ct: ct), null);

        if (!Transitions.TryGetValue(from, out var allowed) || !allowed.Contains(to))
            return (null, OrderFailure.InvalidTransition);

        var at = move.OccurredAt ?? Ids.Now();
        var leaving = to is OrderStatuses.Cancelled or OrderStatuses.Refunded;
        var restock = move.Restock ?? (leaving && !Delivery.ShippedOut.Contains(from));

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            var moved = await orders.TryMoveStatusAsync(
                orderId, from, to,
                move.Carrier, move.TrackingNumber,
                to == OrderStatuses.Delivered ? at : null,
                clearHold: leaving,
                scope, ct);

            if (!moved) return (null, OrderFailure.ConcurrentChange);

            if (restock)
            {
                foreach (var item in await orders.ListItemsAsync([orderId], scope, ct))
                    await catalog.ReturnStockAsync(item.ProductId, item.Quantity, scope, ct);
            }

            await orders.AddEventAsync(EventFor(orderId, to, at, move.Location), scope, ct);

            // The delivery milestones (REQUIREMENTS.md S16, N2), to the customer —
            // never to whoever moved the order. In the move's transaction, so the
            // ops console, the fulfilment job and settlement all announce through
            // this one line, and a move that loses its race announces nothing.
            if (Notices.ForOrder(orderId, to) is { } notice)
                await notifier.NotifyAsync(order.UserId, notice, scope, ct);

            await scope.CommitAsync(ct);
        }

        if (leaving) await ReleasePaymentAsync(orderId, to, move.InitiatedBy, ct);

        return (await LoadAsync(orderId, ct: ct), null);
    }

    /// <summary>
    /// What leaving an order does to its money.
    ///
    /// Money taken goes back, through the ledger — a full refund of whatever is
    /// left, recorded against whoever moved the order. Money not yet taken is
    /// stopped: an asynchronous provider's intent is cancelled, so a customer
    /// still sitting in a card challenge cannot pay for an order that no longer
    /// exists. Best-effort; if the cancel does not land and the payment
    /// succeeds anyway, <see cref="SettleAsync"/> refunds it.
    /// </summary>
    private async Task ReleasePaymentAsync(string orderId, string to, string? initiatedBy, CancellationToken ct)
    {
        var payment = await payments.GetCurrentForOrderAsync(orderId, ct: ct)
                      ?? await payments.GetLatestForOrderAsync(orderId, ct: ct);
        if (payment is null) return;

        if (PaymentTransitions.Refundable.Contains(payment.Status))
        {
            var outcome = await ledger.RequestRefundAsync(new RefundRequest(
                PaymentId: payment.Id,
                Reason: to == OrderStatuses.Cancelled ? RefundReasons.OrderCancelled : RefundReasons.RequestedByCustomer,
                InitiatedBy: initiatedBy ?? "system"), ct);

            if (!outcome.Ok && outcome.Failure is not RefundFailure.AlreadyRefunding)
                log.LogWarning("Order {OrderId} left for {Status} but its refund did not complete: {Failure}",
                    orderId, to, outcome.Failure);
            return;
        }

        if (provider.Asynchronous && NotYetTaken.Contains(payment.Status))
        {
            try
            {
                await provider.CancelIntentAsync(payment.ProviderRef, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "Could not cancel intent {Ref} for order {OrderId}", payment.ProviderRef, orderId);
            }
        }
    }

    public async Task SettleAsync(string orderId, CancellationToken ct = default)
    {
        // The ledger is the truth; this only acts on what it already says.
        var payment = await payments.GetCurrentForOrderAsync(orderId, ct: ct);
        if (payment?.Status != PaymentStatuses.Paid) return;

        var order = await orders.GetByIdAsync(orderId, ct: ct);
        if (order is null) return;

        // Paid for an order that is already gone — its hold expired while the
        // customer was in a card challenge, or it was cancelled meanwhile. The
        // stock was released, so the money goes back rather than sitting
        // against a dead order. The reference had no answer for this.
        if (order.Status is OrderStatuses.Cancelled or OrderStatuses.Refunded)
        {
            log.LogWarning("Payment {PaymentId} settled after order {OrderId} was {Status}; refunding",
                payment.Id, orderId, order.Status);
            await ledger.RequestRefundAsync(new RefundRequest(
                PaymentId: payment.Id, Reason: RefundReasons.OrderCancelled, InitiatedBy: "system",
                Note: $"Paid after the order was {order.Status}"), ct);
            return;
        }

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            // The hold has done its job; the goods are sold.
            await orders.SetPaymentAsync(
                orderId, PaymentStatuses.Paid, payment.ProviderRef, releaseHold: true, scope, ct);
            await scope.CommitAsync(ct);
        }

        // Only from pending_payment. An order already further along — settled
        // by an earlier call, or moved on by fulfilment — stays where it is,
        // which is what makes a duplicate settlement harmless.
        if (order.Status == OrderStatuses.PendingPayment)
            await MoveAsync(orderId, OrderStatuses.Paid, ct: ct);
    }

    /// <summary>
    /// Release abandoned checkouts.
    ///
    /// "Reclaimable rather than reclaimed": the claim runs inside checkout, on
    /// exactly the products somebody is trying to buy, at the only moment the
    /// answer matters — and the daily job sweeps the rest so dead orders stop
    /// sitting in a customer's list. The reference was forced into this by a
    /// once-a-day cron limit; it is also simply correct, because a fifteen-minute
    /// reaper is still wrong for up to fifteen minutes.
    /// </summary>
    public async Task<IReadOnlyList<string>> ReleaseExpiredAsync(
        IReadOnlyCollection<string>? productIds, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var owned = scope is null;
        var tx = scope ?? await unitOfWork.BeginAsync(ct);

        try
        {
            var claimed = await orders.ClaimExpiredReservationsAsync(productIds, now, tx, ct);

            if (claimed.Count > 0)
            {
                foreach (var item in await orders.ListItemsAsync(claimed, tx, ct))
                    await catalog.ReturnStockAsync(item.ProductId, item.Quantity, tx, ct);

                foreach (var orderId in claimed)
                {
                    await orders.AddEventAsync(new OrderEventEntity
                    {
                        Id = Ids.New("oe"),
                        OrderId = orderId,
                        Status = OrderStatuses.Cancelled,
                        Label = "Checkout expired",
                        Description =
                            "This order was never paid for, so the items were returned to the shop.",
                        Location = null,
                        OccurredAt = now,
                    }, tx, ct);
                }
            }

            if (owned) await tx.CommitAsync(ct);
            return claimed;
        }
        finally
        {
            if (owned) await tx.DisposeAsync();
        }
    }

    public async Task<OrderDto?> LoadAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var order = await orders.GetByIdAsync(orderId, scope, ct);
        if (order is null) return null;

        var items = await orders.ListItemsAsync([orderId], scope, ct);
        var events = await orders.ListEventsAsync([orderId], scope, ct);

        return order.ToDto(items, Timeline(events));
    }

    /// <summary>Assemble a page of orders in three queries, not one per order.</summary>
    public async Task<OrderDto[]> LoadManyAsync(
        IReadOnlyList<OrderEntity> rows, CancellationToken ct = default)
    {
        if (rows.Count == 0) return [];

        var ids = rows.Select(o => o.Id).ToArray();
        var items = (await orders.ListItemsAsync(ids, ct: ct)).ToLookup(i => i.OrderId);
        var events = (await orders.ListEventsAsync(ids, ct: ct)).ToLookup(e => e.OrderId);

        return [.. rows.Select(o => o.ToDto([.. items[o.Id]], Timeline([.. events[o.Id]])))];
    }

    /// <summary>
    /// The order's events as a customer should read them: by time, and — when
    /// two share a timestamp — by where the status falls in the lifecycle.
    ///
    /// The tie is not hypothetical. The fulfilment job catching up on an order
    /// walks four stages in one run, stamped with the same instant, and the
    /// only remaining tie-break in the database is the event id — a random
    /// UUID. Sorted by that, a customer read "shipped, delivered, out for
    /// delivery". (The reference got away with it because its ids were
    /// time-ordered cuids.) Checkout can hit it too: placed and paid can land in
    /// the same millisecond.
    ///
    /// The lifecycle position is a correct tie-break, not merely a plausible
    /// one: an order's statuses only move forward and each appears at most
    /// once, so their order in <see cref="OrderStatuses.All"/> <i>is</i> the
    /// causal order. The terminal two sort last, as they must.
    /// </summary>
    private static List<OrderEventEntity> Timeline(IEnumerable<OrderEventEntity> events)
        => [.. events
            .OrderBy(e => e.OccurredAt)
            .ThenBy(e => Array.IndexOf(OrderStatuses.All, e.Status))
            .ThenBy(e => e.Id, StringComparer.Ordinal)];
}
