using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// <c>orders</c>, <c>order_items</c> and <c>order_events</c> — one aggregate,
/// because nothing ever writes an order without its lines or moves it without
/// writing its event.
///
/// Items and events are read in <b>batches</b> keyed on a set of order ids
/// rather than per order: a page of twenty orders is three queries, not
/// forty-one.
/// </summary>
public interface IOrderRepository
{
    /// <summary>The order, its lines and its opening event, in the caller's transaction.</summary>
    Task CreateAsync(
        OrderEntity order, IReadOnlyList<OrderItemEntity> items, OrderEventEntity firstEvent,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<OrderEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<OrderItemEntity>> ListItemsAsync(
        IReadOnlyCollection<string> orderIds,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Oldest first within each order — a timeline reads downward.</summary>
    Task<IReadOnlyList<OrderEventEntity>> ListEventsAsync(
        IReadOnlyCollection<string> orderIds,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>A customer's orders, newest first, keyset on <c>(placedAt, id)</c>.</summary>
    Task<(IReadOnlyList<OrderEntity> Rows, string? NextCursor)> ListByUserAsync(
        string userId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Orders awaiting fulfilment, <b>oldest first</b> — the ops queue, and the
    /// fulfilment job's work list.
    ///
    /// <c>pending_payment</c> is excluded: an unpaid basket is not a parcel, and
    /// without the exclusion the queue fills with abandoned checkouts nobody
    /// should be picking. Terminal and delivered orders are excluded because
    /// there is nothing left to do to them.
    /// </summary>
    Task<(IReadOnlyList<OrderEntity> Rows, string? NextCursor)> ListForFulfilmentAsync(
        string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move <paramref name="id"/> from <paramref name="from"/> to
    /// <paramref name="to"/> — <b>only if it is still at <paramref name="from"/></b>.
    /// False when somebody else moved it first.
    ///
    /// There are three writers — the ops console, the fulfilment job and the
    /// payment settlement — and a read-then-write with no guard lets two of
    /// them both pass the transition check and both apply. The conditional
    /// <c>WHERE status = @from</c> is the guard.
    /// </summary>
    Task<bool> TryMoveStatusAsync(
        string id, string from, string to,
        string? carrier, string? trackingNumber, DateTimeOffset? deliveredAt, bool clearHold,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task AddEventAsync(
        OrderEventEntity orderEvent,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Record the payment's state on the order. <paramref name="releaseHold"/>
    /// clears <c>reservationExpiresAt</c> — the goods are sold, or the stock has
    /// gone back, and either way the hold has done its job.
    /// </summary>
    Task SetPaymentAsync(
        string id, string paymentStatus, string? paymentRef, bool releaseHold,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Claim every unpaid order whose stock hold has lapsed and which holds any
    /// of <paramref name="productIds"/> (or any product at all, when null):
    /// marks it <c>cancelled</c>, clears its hold, and returns the ids claimed.
    ///
    /// One <c>UPDATE … RETURNING</c>, so it is race-safe on its own: a
    /// concurrent claim of the same order waits on the row lock, then finds
    /// <c>reservationExpiresAt</c> already null and matches nothing. The caller
    /// restocks exactly what this returns and nothing else, which is what stops
    /// abandoned stock being given back twice.
    /// </summary>
    Task<IReadOnlyList<string>> ClaimExpiredReservationsAsync(
        IReadOnlyCollection<string>? productIds, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// <c>payments</c> — the ledger. M6 writes one row per order through the demo
/// provider; M7 grows this into the full ledger with its own transition table.
/// </summary>
public interface IPaymentRepository
{
    Task CreateAsync(
        PaymentEntity payment, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The order's most recent payment, if it has one.</summary>
    Task<PaymentEntity?> GetCurrentForOrderAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetStatusAsync(
        string id, string status, int amountRefundedCents,
        DateTimeOffset? succeededAt, DateTimeOffset updatedAt,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
