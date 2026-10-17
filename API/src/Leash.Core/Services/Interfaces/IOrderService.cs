using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>Why an order operation was refused.</summary>
public enum OrderFailure
{
    /// <summary>No such order, or not the caller's. 404 — order ids are sequential.</summary>
    NotFound,

    /// <summary>The named pet is not the caller's. 403. See <see cref="IOrderService"/>.</summary>
    NotYourPet,

    /// <summary>Nothing in the basket. 400.</summary>
    Empty,

    /// <summary>A line cannot be sold as asked. 409, with the quote saying which.</summary>
    Unavailable,

    /// <summary>Somebody else took the stock between the quote and the purchase. 409, with the product.</summary>
    StockRace,

    /// <summary>The order exists and holds its stock; only the payment step failed. 502, with the order id.</summary>
    PaymentSetupFailed,

    /// <summary>Only store operations may do that. 403.</summary>
    NotOps,

    /// <summary>Not on the transition table (REQUIREMENTS.md §11.3). 409.</summary>
    InvalidTransition,

    /// <summary>Somebody else moved this order while we were deciding. 409.</summary>
    ConcurrentChange,

    /// <summary>Past the customer cancellation window — it is with the carrier. 409.</summary>
    NotCancellable,
}

/// <summary>
/// The outcome of placing an order. Several failures carry something the client
/// needs to recover — the re-priced quote, the product that sold out, the order
/// whose payment can be retried — so this is a record rather than a tuple.
/// </summary>
public sealed record CreateOrderOutcome(
    PlacedOrderDto? Placed,
    OrderFailure? Failure,
    CartQuoteDto? Quote = null,
    string? ProductId = null,
    string? OrderId = null);

/// <summary>
/// The store's checkout and order history, as a customer or a member of staff
/// reaches it. <b>Every method here authorizes</b>; the state machine beneath it
/// (<see cref="IOrderLifecycle"/>) does not.
///
/// ── The one High-severity defect, and where it is closed ──
///
/// REQUIREMENTS.md S9. The reference implementation's <c>POST /orders</c>
/// passed the request's <c>petId</c> straight to the prescription check, while
/// <c>quote</c> checked ownership first. So a stranger's pet id would buy that
/// animal's Rx-only food, and the 201-versus-409 difference told the caller
/// which prescriptions the animal held — a probe of somebody else's medical
/// record through a shopping cart.
///
/// Here the ownership check is in <see cref="QuoteAsync"/> <i>and</i>
/// <see cref="CreateAsync"/>, inside the service rather than the controller, and
/// it runs <b>before</b> the pet is used for anything. A new route that forgot
/// to check would still be checked.
/// </summary>
public interface IOrderService
{
    /// <summary>
    /// Price a cart against the live catalogue. Signed-in only, because a named
    /// pet's prescriptions and allergies shape the answer.
    /// </summary>
    Task<(CartQuoteDto? Quote, OrderFailure? Failure)> QuoteAsync(
        string callerId, QuoteRequest input, CancellationToken ct = default);

    /// <summary>
    /// Place an order: re-quote, reserve stock, open the order at
    /// <c>pending_payment</c>, then hand off to the payment provider.
    /// </summary>
    Task<CreateOrderOutcome> CreateAsync(
        string callerId, CreateOrderRequest input, CancellationToken ct = default);

    Task<OrderPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>The order, to its customer or to store operations. Anyone else: <see cref="OrderFailure.NotFound"/>.</summary>
    Task<(OrderDto? Order, OrderFailure? Failure)> GetAsync(
        string callerId, string orderId, CancellationToken ct = default);

    /// <summary>
    /// A customer cancelling their own order, inside the window
    /// (REQUIREMENTS.md S15). A paid order is refunded as it is cancelled.
    /// </summary>
    Task<(OrderDto? Order, OrderFailure? Failure)> CancelAsync(
        string callerId, string orderId, CancellationToken ct = default);

    /// <summary>A member of store operations moving an order along. Ops only.</summary>
    Task<(OrderDto? Order, OrderFailure? Failure)> UpdateStatusAsync(
        string callerId, string orderId, UpdateOrderStatusRequest input,
        CancellationToken ct = default);

    /// <summary>The fulfilment queue, oldest first. Null when the caller is not ops.</summary>
    Task<OrderPage?> ListForFulfilmentAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>
    /// Ask the provider where this order's payment stands, and settle it if it
    /// has succeeded. Also the retry path after a 502 from
    /// <see cref="CreateAsync"/>: an order with no payment yet gets its intent
    /// created here (REQUIREMENTS.md S17).
    /// </summary>
    Task<(PlacedOrderDto? Placed, OrderFailure? Failure)> SyncPaymentAsync(
        string callerId, string orderId, CancellationToken ct = default);
}

/// <summary>Optional details that ride along on a status move.</summary>
public sealed record OrderMove(
    string? Location = null,
    string? Carrier = null,
    string? TrackingNumber = null,
    DateTimeOffset? OccurredAt = null,
    /// <summary>
    /// Force a restock — a physical return that has actually come back.
    /// Null means the default: restock if the goods never left the building.
    /// </summary>
    bool? Restock = null,
    /// <summary>Who is recorded against the refund a move to cancelled or refunded issues: a staff id, or <c>system</c>.</summary>
    string? InitiatedBy = null);

/// <summary>
/// The order state machine (REQUIREMENTS.md §11.3), with <b>no caller</b>.
///
/// It is its own service so that the fulfilment job and the payment settlement
/// can move an order without pretending to be somebody — and so that no
/// controller is ever handed it. Controllers get <see cref="IOrderService"/>,
/// which authorizes and then calls this. Same split as a repository: the thing
/// that writes does not decide who may.
/// </summary>
public interface IOrderLifecycle
{
    /// <summary>
    /// Move an order and append its timeline event. Legal transitions only;
    /// conditional on the status that was read, so a concurrent move loses
    /// cleanly. Leaving for <c>cancelled</c> or <c>refunded</c> restocks goods
    /// that never shipped and refunds a settled payment.
    /// </summary>
    Task<(OrderDto? Order, OrderFailure? Failure)> MoveAsync(
        string orderId, string to, OrderMove? move = null, CancellationToken ct = default);

    /// <summary>
    /// Settle an order whose payment the ledger already records as paid: mirror
    /// it, release the hold, and move <c>pending_payment</c> to <c>paid</c>. Does
    /// nothing while the payment is not paid. Safe to call twice: an order already
    /// past <c>pending_payment</c> is left where it is. An order that was
    /// cancelled before its money arrived is refunded instead.
    /// </summary>
    Task SettleAsync(string orderId, CancellationToken ct = default);

    /// <summary>
    /// Give back the stock held by abandoned checkouts — those touching
    /// <paramref name="productIds"/>, or every one when null — and close the
    /// orders out. Runs in the caller's transaction when one is passed, which
    /// is how checkout makes the reclaim and the purchase that triggered it
    /// atomic. Returns the order ids released.
    /// </summary>
    Task<IReadOnlyList<string>> ReleaseExpiredAsync(
        IReadOnlyCollection<string>? productIds, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Assemble the full order — lines and timeline — for one id.</summary>
    Task<OrderDto?> LoadAsync(
        string orderId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Assemble a page of orders in three queries rather than one per order.</summary>
    Task<OrderDto[]> LoadManyAsync(
        IReadOnlyList<Models.Entities.OrderEntity> rows, CancellationToken ct = default);
}

/// <summary>What one run of the fulfilment job did.</summary>
public sealed record FulfilmentReport(
    int Scanned,
    IReadOnlyList<(string OrderId, string From, string To)> Advanced,
    IReadOnlyList<string> AbandonedReleased);

/// <summary>
/// Automatic order progress (REQUIREMENTS.md S16). There is no warehouse, so
/// something has to move orders along: the ops console by hand, and this on a
/// schedule.
/// </summary>
public interface IFulfilmentService
{
    /// <summary>
    /// Move every in-flight order to the stage its age has earned, and close out
    /// abandoned checkouts. <paramref name="now"/> is injectable so the
    /// behaviour is testable without waiting three days.
    /// </summary>
    Task<FulfilmentReport> RunAsync(DateTimeOffset now, CancellationToken ct = default);
}
