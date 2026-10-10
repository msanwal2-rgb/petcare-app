using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Checkout, order history and the ops queue.
///
/// Every failure maps to a status code in one place
/// (<see cref="OrderError"/>). The ones the client reads structured extras
/// from, per REQUIREMENTS.md §2.1:
///
///  - <b>409 + <c>quote</c></b> — the basket cannot be sold as asked; the
///    re-priced quote says which lines and why.
///  - <b>409 + <c>productId</c></b> — the sold-out race (S12).
///  - <b>502 + <c>orderId</c></b> — the order exists and holds its stock, only
///    the payment step failed (S17); the client retries
///    <c>POST /orders/{id}/payment/sync</c>, not the whole cart.
///
/// The authorization itself is in <see cref="IOrderService"/>, never here — in
/// particular the S9 ownership check on <c>petId</c>, which the reference
/// implementation had on <c>quote</c> and forgot on <c>POST /orders</c>.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class OrdersController(IOrderService orders) : ControllerBase
{
    /// <summary>
    /// Price a basket. A POST because it carries a body, not because it
    /// changes anything — it does not.
    /// </summary>
    [HttpPost("orders/quote")]
    public async Task<IActionResult> Quote([FromBody] QuoteRequest input, CancellationToken ct)
    {
        var (quote, failure) = await orders.QuoteAsync(User.RequireUserId(), input, ct);
        return failure is null ? Ok(quote) : OrderError(failure.Value, null);
    }

    /// <summary>The caller's own orders, newest first. No user id in the path — a self-only list reads itself from the principal.</summary>
    [HttpGet("orders")]
    public async Task<IActionResult> ListMine(
        [FromQuery] string? cursor, [FromQuery] int? limit, CancellationToken ct)
        => Ok(await orders.ListMineAsync(User.RequireUserId(), cursor, limit ?? 20, ct));

    [HttpPost("orders")]
    public async Task<IActionResult> Create([FromBody] CreateOrderRequest input, CancellationToken ct)
    {
        var outcome = await orders.CreateAsync(User.RequireUserId(), input, ct);

        return outcome.Failure switch
        {
            null => CreatedAtAction(
                nameof(Get), new { id = outcome.Placed!.Order.Id },
                // Flattened to the shape web/src/types declares as PlacedOrder:
                // the order's own fields, plus `payment` beside them.
                Flatten(outcome.Placed)),

            OrderFailure.Unavailable => ApiResults.Conflict(
                "Some items can't be bought as they are in your cart.",
                new { quote = outcome.Quote }),

            OrderFailure.StockRace => ApiResults.Conflict(
                "Someone else just bought the last of one of your items.",
                new { productId = outcome.ProductId }),

            OrderFailure.PaymentSetupFailed => ApiResults.BadGateway(
                "Your order is saved, but we couldn't start the payment. Try paying again.",
                new { orderId = outcome.OrderId }),

            var other => OrderError(other.Value, null),
        };
    }

    [HttpGet("orders/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var (order, failure) = await orders.GetAsync(User.RequireUserId(), id, ct);
        return failure is null ? Ok(order) : OrderError(failure.Value, id);
    }

    [HttpPost("orders/{id}/cancel")]
    public async Task<IActionResult> Cancel(string id, CancellationToken ct)
    {
        var (order, failure) = await orders.CancelAsync(User.RequireUserId(), id, ct);
        return failure is null ? Ok(order) : OrderError(failure.Value, id);
    }

    /// <summary>Store operations moving an order along. Ops only — see <see cref="IOrderService.UpdateStatusAsync"/>.</summary>
    [HttpPatch("orders/{id}/status")]
    public async Task<IActionResult> UpdateStatus(
        string id, [FromBody] UpdateOrderStatusRequest input, CancellationToken ct)
    {
        var (order, failure) = await orders.UpdateStatusAsync(User.RequireUserId(), id, input, ct);
        return failure is null ? Ok(order) : OrderError(failure.Value, id);
    }

    /// <summary>
    /// Ask where the payment stands and settle it if it has succeeded. Also the
    /// retry after a 502 from checkout.
    /// </summary>
    [HttpPost("orders/{id}/payment/sync")]
    public async Task<IActionResult> SyncPayment(string id, CancellationToken ct)
    {
        var (placed, failure) = await orders.SyncPaymentAsync(User.RequireUserId(), id, ct);

        return failure switch
        {
            null => Ok(Flatten(placed!)),
            OrderFailure.PaymentSetupFailed => ApiResults.BadGateway(
                "We still couldn't start the payment. Try again in a moment.",
                new { orderId = id }),
            var other => OrderError(other.Value, id),
        };
    }

    /// <summary>The fulfilment queue, oldest first. Ops only.</summary>
    [HttpGet("ops/orders")]
    public async Task<IActionResult> OpsQueue(
        [FromQuery] string? cursor, [FromQuery] int? limit, CancellationToken ct)
    {
        var page = await orders.ListForFulfilmentAsync(User.RequireUserId(), cursor, limit ?? 50, ct);
        return page is null
            ? ApiResults.Forbidden("Only store operations can see the fulfilment queue")
            : Ok(page);
    }

    /// <summary>
    /// <c>{ ...order, payment }</c>. The order fields at the top level match
    /// <c>PlacedOrder extends Order</c> in the web contract, so the checkout
    /// page can treat the response as the order it just placed.
    /// </summary>
    private static Dictionary<string, object?> Flatten(PlacedOrderDto placed)
    {
        var o = placed.Order;
        return new Dictionary<string, object?>
        {
            ["id"] = o.Id,
            ["userId"] = o.UserId,
            ["status"] = o.Status,
            ["paymentStatus"] = o.PaymentStatus,
            ["paymentRef"] = o.PaymentRef,
            ["subtotalCents"] = o.SubtotalCents,
            ["shippingCents"] = o.ShippingCents,
            ["taxCents"] = o.TaxCents,
            ["totalCents"] = o.TotalCents,
            ["shippingAddress"] = o.ShippingAddress,
            ["deliveryInstructions"] = o.DeliveryInstructions,
            ["carrier"] = o.Carrier,
            ["trackingNumber"] = o.TrackingNumber,
            ["placedAt"] = o.PlacedAt,
            ["estimatedDeliveryAt"] = o.EstimatedDeliveryAt,
            ["deliveredAt"] = o.DeliveredAt,
            ["items"] = o.Items,
            ["events"] = o.Events,
            ["payment"] = placed.Payment,
        };
    }

    private static IActionResult OrderError(OrderFailure failure, string? id) => failure switch
    {
        OrderFailure.NotFound => ApiResults.NotFound($"Order {id} not found"),

        // 403 rather than 404, matching bookings and appointments: the caller
        // named a pet that is not theirs, and saying so reveals nothing about
        // the pet — in particular nothing about its prescriptions, which is the
        // leak S9 closes.
        OrderFailure.NotYourPet => ApiResults.Forbidden("You can only shop for your own pets"),

        OrderFailure.Empty => ApiResults.BadRequest("Your basket is empty"),

        OrderFailure.NotOps => ApiResults.Forbidden("Only store operations can move an order"),

        OrderFailure.InvalidTransition => ApiResults.Conflict(
            "That status change isn't allowed from where this order is now.",
            new { orderId = id }),

        OrderFailure.ConcurrentChange => ApiResults.Conflict(
            "This order changed while you were looking at it. Refresh and try again.",
            new { orderId = id }),

        OrderFailure.NotCancellable => ApiResults.Conflict(
            "This order is already with the carrier, so it can't be cancelled. "
            + "You can refuse the delivery or ask for a refund.",
            new { orderId = id }),

        _ => ApiResults.NotFound($"Order {id} not found"),
    };
}
