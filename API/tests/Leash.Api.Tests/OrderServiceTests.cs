using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of the M6 half of <c>tests/orders.test.ts</c> (lines 1–433) and of
/// <c>tests/fulfillment.test.ts</c>, plus the S9 cases the reference has no
/// counterpart for — because the reference had the bug.
///
/// ── What is deliberately not here ──
///
/// The second half of <c>orders.test.ts</c> — "the payment provider is a real
/// seam", "refund accounting", "payment state machine" — exercises asynchronous
/// intents, webhook idempotency, partial refunds and the payment transition
/// table. Those are M7 (BUILD_PLAN.md week 7), and that suite should be ported
/// <i>before</i> M7's implementation is written, as the plan says. The
/// fulfilment suite's "notifies the customer" case is M8's.
///
/// ── Fixtures ──
///
/// u1 owns o1 (delivered), o2 (out for delivery) and o3 (processing). u3 owns
/// Luna (p4), who holds an active prescription for prod19 and is allergic to
/// chicken. u21 is ops; u22 is admin; u23 is support and finance but not ops.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class OrderServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Maya = "u1";
    private const string Priya = "u3";      // owns Luna (p4)
    private const string Ops = "u21";
    private const string Admin = "u22";
    private const string NotOps = "u23";

    private CoreHost _core = null!;
    private IOrderService _orders = null!;
    private IOrderLifecycle _lifecycle = null!;
    private IFulfilmentService _fulfilment = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _orders = _core.Get<IOrderService>();
        _lifecycle = _core.Get<IOrderLifecycle>();
        _fulfilment = _core.Get<IFulfilmentService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static readonly ShippingAddressDto Address = new(
        "Maya Chen", "1204 Grove Street", "Apt 3B", "Austin", "TX", "78704", "US",
        "(512) 555-0142");

    private static CreateOrderRequest Order(string productId, int quantity, string? petId = null)
        => new([new CartLineInput(productId, quantity)], Address, null, petId);

    private Task<(CartQuoteDto? Quote, OrderFailure? Failure)> Quote(
        string caller, string? petId, params (string Id, int Qty)[] lines)
        => _orders.QuoteAsync(caller, new QuoteRequest(
            [.. lines.Select(l => new CartLineInput(l.Id, l.Qty))], petId));

    // ── Pricing rules ────────────────────────────────────────────────────

    [Fact]
    public void Charges_flat_shipping_below_the_free_threshold()
    {
        Assert.Equal(
            StorePricing.FlatShippingCents,
            StorePricing.ShippingFor(StorePricing.DefaultFreeShippingThresholdCents - 1,
                StorePricing.DefaultFreeShippingThresholdCents));
    }

    [Fact]
    public void Ships_free_at_and_above_the_threshold()
    {
        var threshold = StorePricing.DefaultFreeShippingThresholdCents;
        Assert.Equal(0, StorePricing.ShippingFor(threshold, threshold));
        Assert.Equal(0, StorePricing.ShippingFor(threshold + 5000, threshold));
    }

    [Theory]
    // 1999 × 8.25% = 164.9175 → 165, the reference's own fixture.
    [InlineData(1999, 165)]
    [InlineData(1299, 107)]
    [InlineData(6499, 536)]
    // A half cent rounds up, as JavaScript's Math.round does for positives.
    [InlineData(200, 17)]
    public void Computes_tax_as_whole_cents(int subtotal, int expected)
        => Assert.Equal(expected, StorePricing.TaxFor(subtotal));

    [Fact]
    public void A_member_is_never_told_to_spend_more_for_free_delivery()
    {
        // REQUIREMENTS.md S6.
        Assert.Equal(0, StorePricing.AmountToFreeShipping(100, 4900, freeShipping: true));
        Assert.Equal(4800, StorePricing.AmountToFreeShipping(100, 4900));
    }

    // ── Quoting ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Prices_a_line_from_the_catalogue_not_the_caller()
    {
        var (quote, _) = await Quote(Maya, null, ("prod13", 2));

        Assert.Equal(1299, quote!.Lines[0].UnitPriceCents);
        Assert.Equal(2598, quote.Lines[0].LineTotalCents);
        Assert.Empty(quote.Problems);
    }

    [Fact]
    public async Task Totals_subtotal_shipping_and_tax()
    {
        var (quote, _) = await Quote(Maya, null, ("prod13", 1));

        Assert.Equal(1299, quote!.SubtotalCents);
        Assert.Equal(StorePricing.FlatShippingCents, quote.ShippingCents);
        Assert.Equal(StorePricing.TaxFor(1299), quote.TaxCents);
        Assert.Equal(1299 + StorePricing.FlatShippingCents + StorePricing.TaxFor(1299), quote.TotalCents);
        Assert.Equal(4900 - 1299, quote.AmountToFreeShippingCents);
    }

    [Fact]
    public async Task Reports_an_unknown_product_rather_than_silently_dropping_it()
    {
        var (quote, _) = await Quote(Maya, null, ("ghost", 1));

        Assert.Equal(CartProblemCodes.NotFound, quote!.Problems[0].Code);
        Assert.Empty(quote.Lines);
    }

    [Fact]
    public async Task Reports_a_sold_out_product()
    {
        // prod25, the slow-feeder bowl, is seeded with zero stock.
        var (quote, _) = await Quote(Maya, null, ("prod25", 1));
        Assert.Equal(CartProblemCodes.OutOfStock, quote!.Problems[0].Code);
    }

    [Fact]
    public async Task Reports_insufficient_stock_with_the_quantity_actually_available()
    {
        // prod20 has 12. It is also Rx-only — and stock is reported first,
        // because sending somebody to their vet for a product that is sold out
        // anyway is a wasted trip.
        var (quote, _) = await Quote(Maya, null, ("prod20", 99));

        Assert.Equal(CartProblemCodes.InsufficientStock, quote!.Problems[0].Code);
        Assert.Contains("12", quote.Problems[0].Message);
    }

    [Fact]
    public async Task Blocks_an_rx_only_product_when_no_pet_is_named()
    {
        var (quote, _) = await Quote(Maya, null, ("prod19", 1));
        Assert.Equal(CartProblemCodes.PrescriptionRequired, quote!.Problems[0].Code);
    }

    [Fact]
    public async Task Blocks_an_rx_only_product_for_a_pet_without_that_prescription()
    {
        // Biscuit (p1) has vaccinations but no prescriptions.
        var (quote, _) = await Quote(Maya, "p1", ("prod19", 1));
        Assert.Equal(CartProblemCodes.PrescriptionRequired, quote!.Problems[0].Code);
    }

    [Fact]
    public async Task Allows_an_rx_only_product_for_a_pet_whose_vet_prescribed_it()
    {
        // Luna holds a current prescription for the hypoallergenic cat diet.
        var (quote, _) = await Quote(Priya, "p4", ("prod19", 1));

        Assert.Empty(quote!.Problems);
        Assert.True(quote.Lines[0].RequiresPrescription);
    }

    [Fact]
    public async Task Still_blocks_a_different_rx_product_the_prescription_does_not_name()
    {
        var (quote, _) = await Quote(Priya, "p4", ("prod21", 1));
        Assert.Equal(CartProblemCodes.PrescriptionRequired, quote!.Problems[0].Code);
    }

    [Fact]
    public async Task Quotes_an_empty_cart_to_zero_shipping_included()
    {
        var (quote, _) = await Quote(Maya, null);

        Assert.Empty(quote!.Lines);
        Assert.Equal(0, quote.TotalCents);
        Assert.Equal(0, quote.ShippingCents);
        Assert.Equal(0, quote.TaxCents);
    }

    [Fact]
    public async Task Charges_nothing_when_every_line_is_unavailable()
    {
        // Every line refused is an empty basket, not a $5.99 shipping charge.
        var (quote, _) = await Quote(Maya, null, ("prod25", 1));

        Assert.Empty(quote!.Lines);
        Assert.Equal(0, quote.TotalCents);
    }

    [Fact]
    public async Task Warns_about_an_ingredient_the_pet_reacts_to()
    {
        // REQUIREMENTS.md S8, from the one matcher (S18). prod8 lists chicken;
        // Luna is allergic to it. A warning, not a refusal — the line is priced.
        // prod7 is the control: fish only, which Luna does not react to. (Not
        // prod13 — its "Certain grains" matches Luna's, which the loose match
        // rightly catches.)
        var (quote, _) = await Quote(Priya, "p4", ("prod8", 1), ("prod7", 1));

        Assert.Single(quote!.Lines, l => l.ProductId == "prod8");
        var warning = Assert.Single(quote.AllergenWarnings);
        Assert.Equal("prod8", warning.ProductId);
        Assert.Contains("Chicken", warning.Allergens);
    }

    [Fact]
    public async Task Gives_no_allergen_warnings_without_a_pet()
    {
        var (quote, _) = await Quote(Maya, null, ("prod8", 1));
        Assert.Empty(quote!.AllergenWarnings);
    }

    // ── REQUIREMENTS.md S9 — the High-severity defect ────────────────────

    [Fact]
    public async Task Refuses_to_quote_against_somebody_elses_pet()
    {
        var (quote, failure) = await Quote(Maya, "p4", ("prod19", 1));

        Assert.Null(quote);
        Assert.Equal(OrderFailure.NotYourPet, failure);
    }

    [Fact]
    public async Task Refuses_to_place_an_order_against_somebody_elses_pet()
    {
        // The reference checked ownership on quote and forgot it here. Maya
        // naming Luna would have bought Luna's prescription diet — and the
        // 201-versus-409 told her which prescriptions Luna holds.
        var outcome = await _orders.CreateAsync(Maya, Order("prod19", 1, petId: "p4"));

        Assert.Null(outcome.Placed);
        Assert.Equal(OrderFailure.NotYourPet, outcome.Failure);
    }

    [Fact]
    public async Task The_refusal_is_the_same_whatever_the_pet_holds()
    {
        // The probe S9 describes: compare the answers for an Rx product the pet
        // is authorised for and one it is not. Both must be the same refusal,
        // or the difference reads somebody else's medical record.
        var authorised = await _orders.CreateAsync(Maya, Order("prod19", 1, petId: "p4"));
        var unauthorised = await _orders.CreateAsync(Maya, Order("prod21", 1, petId: "p4"));

        Assert.Equal(authorised.Failure, unauthorised.Failure);
        Assert.Null(authorised.Quote);
        Assert.Null(unauthorised.Quote);
    }

    [Fact]
    public async Task A_refused_pet_takes_no_stock()
    {
        var before = await StockAsync("prod19");
        await _orders.CreateAsync(Maya, Order("prod19", 1, petId: "p4"));

        Assert.Equal(before, await StockAsync("prod19"));
    }

    // ── Placing an order ─────────────────────────────────────────────────

    [Fact]
    public async Task Creates_a_paid_order_with_a_snapshotted_line_item()
    {
        var outcome = await _orders.CreateAsync(Maya, Order("prod13", 2));
        var order = outcome.Placed!.Order;

        Assert.Null(outcome.Failure);
        Assert.StartsWith("o_", order.Id);
        Assert.Equal(OrderStatuses.Paid, order.Status);
        Assert.Equal(PaymentStatuses.Paid, order.PaymentStatus);
        Assert.False(string.IsNullOrEmpty(order.PaymentRef));

        var item = Assert.Single(order.Items);
        Assert.Equal("Peanut Butter Biscuits", item.Name);
        Assert.Equal(1299, item.UnitPriceCents);
        Assert.Equal(2598, item.LineTotalCents);
    }

    [Fact]
    public async Task Opens_the_tracking_timeline_honestly_in_two_steps()
    {
        // Placed, then paid — which is what actually happened. The order exists
        // before any money moves.
        var order = (await _orders.CreateAsync(Maya, Order("prod13", 1))).Placed!.Order;

        Assert.Equal(
            [OrderStatuses.PendingPayment, OrderStatuses.Paid],
            order.Events.Select(e => e.Status));
    }

    [Fact]
    public async Task Writes_a_payment_row_to_the_ledger()
    {
        var order = (await _orders.CreateAsync(Maya, Order("prod13", 1))).Placed!.Order;

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var (provider, status, amount) = await conn.QuerySingleAsync<(string, string, int)>(
            """SELECT provider, status, "amountCents" FROM payments WHERE "orderId" = @id""",
            new { id = order.Id });

        Assert.Equal("demo", provider);
        Assert.Equal(PaymentStatuses.Paid, status);
        Assert.Equal(order.TotalCents, amount);
    }

    [Fact]
    public async Task Releases_the_stock_hold_once_paid()
    {
        var order = (await _orders.CreateAsync(Maya, Order("prod13", 1))).Placed!.Order;

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var hold = await conn.ExecuteScalarAsync<DateTime?>(
            """SELECT "reservationExpiresAt" FROM orders WHERE id = @id""", new { id = order.Id });

        // The goods are sold. A hold left set would let the reaper give the
        // stock back once fifteen minutes passed.
        Assert.Null(hold);
    }

    [Fact]
    public async Task Decrements_stock_by_the_quantity_ordered()
    {
        var before = await StockAsync("prod13");
        await _orders.CreateAsync(Maya, Order("prod13", 3));

        Assert.Equal(before - 3, await StockAsync("prod13"));
    }

    [Fact]
    public async Task Charges_the_catalogues_price_and_nothing_else()
    {
        // There is no price field on the request to tamper with (S10); this
        // asserts the total is derived purely from the catalogue.
        var order = (await _orders.CreateAsync(Maya, Order("prod1", 1))).Placed!.Order;

        Assert.Equal(6499, order.SubtotalCents);
        Assert.Equal(0, order.ShippingCents);   // over the free-shipping threshold
        Assert.Equal(6499 + StorePricing.TaxFor(6499), order.TotalCents);
    }

    [Fact]
    public async Task Refuses_an_empty_cart()
    {
        var outcome = await _orders.CreateAsync(Maya, new CreateOrderRequest([], Address, null, null));
        Assert.Equal(OrderFailure.Empty, outcome.Failure);
    }

    [Fact]
    public async Task Refuses_an_unavailable_line_and_hands_back_the_quote()
    {
        var outcome = await _orders.CreateAsync(Maya, Order("prod25", 1));

        Assert.Equal(OrderFailure.Unavailable, outcome.Failure);
        Assert.Equal(CartProblemCodes.OutOfStock, outcome.Quote!.Problems[0].Code);
    }

    [Fact]
    public async Task Refuses_an_rx_product_without_a_prescription_and_leaves_stock_alone()
    {
        var before = await StockAsync("prod19");
        var outcome = await _orders.CreateAsync(Maya, Order("prod19", 1));

        Assert.Equal(OrderFailure.Unavailable, outcome.Failure);
        Assert.Equal(before, await StockAsync("prod19"));
    }

    [Fact]
    public async Task Accepts_an_rx_product_when_the_named_pet_is_authorised()
    {
        // REQUIREMENTS.md §8.4, the positive half: a pet with an active
        // prescription can buy its Rx-only food.
        var outcome = await _orders.CreateAsync(Priya, Order("prod19", 1, petId: "p4"));

        Assert.Null(outcome.Failure);
        Assert.Equal(OrderStatuses.Paid, outcome.Placed!.Order.Status);
    }

    [Fact]
    public async Task Cannot_oversell_the_last_units_under_concurrency()
    {
        // REQUIREMENTS.md §8.4. prod6 has 19. Two customers race for 12 each:
        // exactly one wins, the other gets the stock race, and stock never goes
        // negative.
        var results = await Task.WhenAll(
            _orders.CreateAsync(Maya, Order("prod6", 12)),
            _orders.CreateAsync(Maya, Order("prod6", 12)));

        Assert.Single(results, r => r.Failure is null);
        Assert.Single(results, r => r.Failure is OrderFailure.StockRace or OrderFailure.Unavailable);
        Assert.Equal(7, await StockAsync("prod6"));
    }

    [Fact]
    public async Task A_refused_order_writes_nothing()
    {
        var before = (await _orders.ListMineAsync(Maya, null, 100)).Items.Length;

        await _orders.CreateAsync(Maya, Order("prod25", 1));

        Assert.Equal(before, (await _orders.ListMineAsync(Maya, null, 100)).Items.Length);
    }

    // ── Abandoned checkouts ──────────────────────────────────────────────

    [Fact]
    public async Task An_expired_hold_gives_its_stock_back_to_the_next_buyer()
    {
        // An unpaid order holding the last 15 units of prod19, whose hold
        // lapsed an hour ago. The next checkout for that product reclaims it in
        // the same transaction as its own purchase.
        var abandoned = await SeedAbandonedCheckoutAsync("prod19", 15, Ids.Now().AddHours(-1));

        var outcome = await _orders.CreateAsync(Priya, Order("prod19", 1, petId: "p4"));

        Assert.Null(outcome.Failure);
        Assert.Equal(14, await StockAsync("prod19"));

        var released = await _lifecycle.LoadAsync(abandoned);
        Assert.Equal(OrderStatuses.Cancelled, released!.Status);
        Assert.Equal("Checkout expired", released.Events[^1].Label);
    }

    [Fact]
    public async Task A_live_hold_is_respected()
    {
        // Still inside its fifteen minutes: the stock is genuinely taken.
        await SeedAbandonedCheckoutAsync("prod19", 15, Ids.Now().AddMinutes(10));

        var outcome = await _orders.CreateAsync(Priya, Order("prod19", 1, petId: "p4"));

        Assert.Equal(OrderFailure.Unavailable, outcome.Failure);
        Assert.Equal(CartProblemCodes.OutOfStock, outcome.Quote!.Problems[0].Code);
    }

    [Fact]
    public async Task An_expired_hold_is_returned_exactly_once()
    {
        // The reaper and a checkout racing for the same abandoned order must not
        // both restock it — the claim clears the hold in the same statement.
        await SeedAbandonedCheckoutAsync("prod19", 15, Ids.Now().AddHours(-1));

        await Task.WhenAll(
            _lifecycle.ReleaseExpiredAsync(null, Ids.Now()),
            _lifecycle.ReleaseExpiredAsync(["prod19"], Ids.Now()));

        Assert.Equal(15, await StockAsync("prod19"));
    }

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_a_users_orders_newest_first()
    {
        var orders = (await _orders.ListMineAsync(Maya, null, 20)).Items;

        Assert.Equal(3, orders.Length);
        for (var i = 1; i < orders.Length; i++)
            Assert.True(orders[i - 1].PlacedAt >= orders[i].PlacedAt);
    }

    [Fact]
    public async Task Pages_a_users_orders_without_repeating_or_skipping()
    {
        var all = (await _orders.ListMineAsync(Maya, null, 100)).Items.Select(o => o.Id).ToArray();

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _orders.ListMineAsync(Maya, cursor, 1);
            seen.AddRange(page.Items.Select(o => o.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all, seen);
    }

    [Fact]
    public async Task Returns_an_empty_page_for_a_user_with_no_orders()
    {
        Assert.Empty((await _orders.ListMineAsync("u7", null, 20)).Items);
    }

    [Fact]
    public async Task Returns_the_tracking_timeline_in_chronological_order()
    {
        var (order, _) = await _orders.GetAsync(Maya, "o1");
        var times = order!.Events.Select(e => e.OccurredAt).ToArray();

        Assert.Equal(times.Order(), times);
        Assert.Equal(OrderStatuses.Delivered, order.Events[^1].Status);
    }

    [Fact]
    public async Task Rebuilds_the_nested_shipping_address()
    {
        var (order, _) = await _orders.GetAsync(Maya, "o1");

        Assert.Equal("Austin", order!.ShippingAddress.City);
        Assert.Equal("Apt 3B", order.ShippingAddress.Line2);
    }

    [Fact]
    public async Task An_order_is_visible_to_its_customer_and_to_ops_only()
    {
        Assert.NotNull((await _orders.GetAsync(Maya, "o1")).Order);
        Assert.NotNull((await _orders.GetAsync(Ops, "o1")).Order);
        Assert.NotNull((await _orders.GetAsync(Admin, "o1")).Order);

        // Anybody else gets the answer an order that does not exist gets.
        Assert.Equal(OrderFailure.NotFound, (await _orders.GetAsync(Priya, "o1")).Failure);
        Assert.Equal(OrderFailure.NotFound, (await _orders.GetAsync(NotOps, "o1")).Failure);
        Assert.Equal(OrderFailure.NotFound, (await _orders.GetAsync(Maya, "nope")).Failure);
    }

    [Fact]
    public async Task Excludes_finished_and_unpaid_orders_from_the_fulfilment_queue()
    {
        var queue = (await _orders.ListForFulfilmentAsync(Ops, null, 100))!.Items
            .Select(o => o.Id).ToArray();

        Assert.DoesNotContain("o1", queue);   // delivered
        Assert.Contains("o2", queue);         // out for delivery
    }

    [Fact]
    public async Task Orders_the_fulfilment_queue_oldest_first()
    {
        var queue = (await _orders.ListForFulfilmentAsync(Ops, null, 100))!.Items;
        for (var i = 1; i < queue.Length; i++)
            Assert.True(queue[i - 1].PlacedAt <= queue[i].PlacedAt);
    }

    [Fact]
    public async Task The_fulfilment_queue_is_for_ops_only()
    {
        Assert.Null(await _orders.ListForFulfilmentAsync(Maya, null, 100));
        Assert.Null(await _orders.ListForFulfilmentAsync(NotOps, null, 100));
        Assert.NotNull(await _orders.ListForFulfilmentAsync(Admin, null, 100));
    }

    // ── The status machine ───────────────────────────────────────────────

    [Fact]
    public async Task Advances_a_step_and_appends_a_timeline_event()
    {
        var (order, failure) = await _orders.UpdateStatusAsync(
            Ops, "o3", new UpdateOrderStatusRequest(OrderStatuses.Packed, "Austin, TX", null, null));

        Assert.Null(failure);
        Assert.Equal(OrderStatuses.Packed, order!.Status);
        Assert.Equal(OrderStatuses.Packed, order.Events[^1].Status);
        Assert.Equal("Austin, TX", order.Events[^1].Location);
    }

    [Fact]
    public async Task Records_the_carrier_and_tracking_number_when_shipping()
    {
        await _lifecycle.MoveAsync("o3", OrderStatuses.Packed);
        var (order, _) = await _lifecycle.MoveAsync(
            "o3", OrderStatuses.Shipped, new OrderMove(Carrier: "Leash Delivery", TrackingNumber: "LEASH-1"));

        Assert.Equal("Leash Delivery", order!.Carrier);
        Assert.Equal("LEASH-1", order.TrackingNumber);
    }

    [Fact]
    public async Task Walks_the_full_journey_to_delivered_and_stamps_delivered_at()
    {
        foreach (var status in new[]
                 {
                     OrderStatuses.Packed, OrderStatuses.Shipped,
                     OrderStatuses.OutForDelivery, OrderStatuses.Delivered,
                 })
            await _lifecycle.MoveAsync("o3", status);

        var order = await _lifecycle.LoadAsync("o3");
        Assert.Equal(OrderStatuses.Delivered, order!.Status);
        Assert.NotNull(order.DeliveredAt);
        Assert.Equal(6, order.Events.Length);
    }

    [Fact]
    public async Task Rejects_skipping_ahead()
    {
        var (_, failure) = await _lifecycle.MoveAsync("o3", OrderStatuses.Delivered);
        Assert.Equal(OrderFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_going_backwards()
    {
        var (_, failure) = await _lifecycle.MoveAsync("o2", OrderStatuses.Packed);
        Assert.Equal(OrderFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_changing_a_delivered_order_except_to_refunded()
    {
        Assert.Equal(OrderFailure.InvalidTransition,
            (await _lifecycle.MoveAsync("o1", OrderStatuses.Shipped)).Failure);
        Assert.Null((await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded)).Failure);
    }

    [Fact]
    public async Task Returns_stock_when_an_order_that_never_shipped_is_cancelled()
    {
        var item = (await _lifecycle.LoadAsync("o3"))!.Items[0];
        var before = await StockAsync(item.ProductId);

        await _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled);

        Assert.Equal(before + item.Quantity, await StockAsync(item.ProductId));
    }

    [Fact]
    public async Task Does_not_restock_goods_that_already_reached_the_customer()
    {
        // delivered → refunded is legal. The bag is in somebody's kitchen;
        // crediting it to inventory would sell it twice.
        var item = (await _lifecycle.LoadAsync("o1"))!.Items[0];
        var before = await StockAsync(item.ProductId);

        await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded);

        Assert.Equal(before, await StockAsync(item.ProductId));
    }

    [Fact]
    public async Task Restocks_a_returned_order_when_told_the_goods_came_back()
    {
        var item = (await _lifecycle.LoadAsync("o1"))!.Items[0];
        var before = await StockAsync(item.ProductId);

        await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded, new OrderMove(Restock: true));

        Assert.Equal(before + item.Quantity, await StockAsync(item.ProductId));
    }

    [Fact]
    public async Task Marks_the_payment_refunded_on_a_refund()
    {
        var (order, _) = await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded);
        Assert.Equal(PaymentStatuses.Refunded, order!.PaymentStatus);
    }

    [Fact]
    public async Task Cancelling_a_paid_order_refunds_it()
    {
        // The reference's original bug: it restocked, set cancelled, and left
        // the payment at "paid" — the customer's money simply stayed with us.
        var (order, _) = await _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled);
        Assert.Equal(PaymentStatuses.Refunded, order!.PaymentStatus);
    }

    [Fact]
    public async Task Reports_not_found_for_an_unknown_order()
    {
        Assert.Equal(OrderFailure.NotFound, (await _lifecycle.MoveAsync("ghost", OrderStatuses.Packed)).Failure);
    }

    [Fact]
    public async Task Treats_a_no_op_same_status_update_as_valid()
    {
        var (order, failure) = await _lifecycle.MoveAsync("o3", OrderStatuses.Processing);

        Assert.Null(failure);
        Assert.Equal(OrderStatuses.Processing, order!.Status);
    }

    [Fact]
    public async Task Two_concurrent_moves_of_the_same_order_apply_once()
    {
        // Two writers move o3 to packed at once. Depending on timing the second
        // either reads "processing" and loses the conditional UPDATE
        // (ConcurrentChange), or reads "packed" and takes the no-op path. Both
        // are correct. What must hold either way is that the move happened
        // exactly once — one event, not two.
        var results = await Task.WhenAll(
            _lifecycle.MoveAsync("o3", OrderStatuses.Packed),
            _lifecycle.MoveAsync("o3", OrderStatuses.Packed));

        Assert.All(results, r => Assert.True(
            r.Failure is null or OrderFailure.ConcurrentChange, $"unexpected {r.Failure}"));

        var order = (await _lifecycle.LoadAsync("o3"))!;
        Assert.Equal(OrderStatuses.Packed, order.Status);
        Assert.Single(order.Events, e => e.Status == OrderStatuses.Packed);
    }

    [Fact]
    public async Task Two_concurrent_moves_to_different_places_never_both_apply()
    {
        // The race the conditional UPDATE exists for: both read "processing",
        // one packs it and the other cancels it. Whichever wins, the order is
        // in exactly one of the two states and has exactly one of the events.
        var results = await Task.WhenAll(
            _lifecycle.MoveAsync("o3", OrderStatuses.Packed),
            _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled));

        var order = (await _lifecycle.LoadAsync("o3"))!;
        var moves = order.Events.Count(e =>
            e.Status is OrderStatuses.Packed or OrderStatuses.Cancelled);

        // Packed-then-cancelled is a legal sequence if the second read after
        // the first committed, so up to two events is fine — but never a
        // cancelled order that also says it was packed after cancelling.
        Assert.InRange(moves, 1, 2);
        Assert.Contains(order.Status, new[] { OrderStatuses.Packed, OrderStatuses.Cancelled });
        if (order.Status == OrderStatuses.Packed)
            Assert.DoesNotContain(order.Events, e => e.Status == OrderStatuses.Cancelled);
        Assert.Contains(results, r => r.Failure is null);
    }

    [Fact]
    public async Task A_catch_up_run_still_reads_in_journey_order()
    {
        // Four stages stamped with the same instant must not come back sorted
        // by their random ids.
        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 72));

        var statuses = (await _lifecycle.LoadAsync("o3"))!.Events.Select(e => e.Status).ToArray();
        var ranks = statuses.Select(s => Array.IndexOf(OrderStatuses.All, s)).ToArray();

        Assert.Equal(ranks.Order(), ranks);
    }

    [Fact]
    public async Task Only_ops_may_move_an_order()
    {
        var (_, failure) = await _orders.UpdateStatusAsync(
            Maya, "o3", new UpdateOrderStatusRequest(OrderStatuses.Delivered, null, null, null));

        // NotOps even though the move is illegal too. Authority first here,
        // deliberately: a customer learns nothing about an order's state from
        // this route, including whether a move from it would be legal.
        Assert.Equal(OrderFailure.NotOps, failure);
    }

    // ── The customer cancellation window ─────────────────────────────────

    [Fact]
    public void Allows_cancelling_up_to_and_including_packed()
    {
        Assert.True(Delivery.CanCustomerCancel(OrderStatuses.PendingPayment));
        Assert.True(Delivery.CanCustomerCancel(OrderStatuses.Paid));
        Assert.True(Delivery.CanCustomerCancel(OrderStatuses.Processing));
        Assert.True(Delivery.CanCustomerCancel(OrderStatuses.Packed));
    }

    [Fact]
    public void Closes_the_window_once_it_is_with_the_carrier()
    {
        Assert.False(Delivery.CanCustomerCancel(OrderStatuses.Shipped));
        Assert.False(Delivery.CanCustomerCancel(OrderStatuses.OutForDelivery));
        Assert.False(Delivery.CanCustomerCancel(OrderStatuses.Delivered));
    }

    [Fact]
    public async Task A_customer_cancels_their_own_order_inside_the_window()
    {
        var (order, failure) = await _orders.CancelAsync(Maya, "o3");

        Assert.Null(failure);
        Assert.Equal(OrderStatuses.Cancelled, order!.Status);
    }

    [Fact]
    public async Task A_customer_cannot_cancel_once_it_has_shipped()
    {
        Assert.Equal(OrderFailure.NotCancellable, (await _orders.CancelAsync(Maya, "o2")).Failure);
    }

    [Fact]
    public async Task Nobody_cancels_somebody_elses_order()
    {
        Assert.Equal(OrderFailure.NotFound, (await _orders.CancelAsync(Priya, "o3")).Failure);
    }

    // ── Fulfilment — tests/fulfillment.test.ts ───────────────────────────

    [Fact]
    public void Is_still_paid_before_the_first_threshold()
    {
        var at = new DateTimeOffset(2026, 7, 8, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(OrderStatuses.Paid, Delivery.EarnedStatus(at, at.AddMinutes(30)));
    }

    [Fact]
    public void Walks_the_schedule_as_time_passes()
    {
        var at = new DateTimeOffset(2026, 7, 8, 9, 0, 0, TimeSpan.Zero);
        foreach (var (status, hours) in Delivery.Schedule)
            Assert.Equal(status, Delivery.EarnedStatus(at, at.AddHours(hours)));
    }

    [Fact]
    public void Stops_at_delivered_however_long_it_has_been()
    {
        var at = new DateTimeOffset(2026, 7, 8, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(OrderStatuses.Delivered, Delivery.EarnedStatus(at, at.AddHours(10_000)));
    }

    /// <summary><paramref name="hours"/> after o3 was actually placed — derived, not assumed.</summary>
    private async Task<DateTimeOffset> AfterPlacementAsync(string orderId, double hours)
        => (await _lifecycle.LoadAsync(orderId))!.PlacedAt.AddHours(hours);

    [Fact]
    public async Task Moves_an_order_through_every_intermediate_stage_not_just_the_last()
    {
        var before = (await _lifecycle.LoadAsync("o3"))!;
        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 72));

        var after = (await _lifecycle.LoadAsync("o3"))!;
        Assert.Equal(OrderStatuses.Delivered, after.Status);

        // The customer still sees it was packed before it shipped.
        var seen = after.Events.Select(e => e.Status).ToArray();
        foreach (var (status, _) in Delivery.Schedule.Skip(1))
            Assert.Contains(status, seen);
        Assert.True(after.Events.Length > before.Events.Length);
    }

    [Fact]
    public async Task Is_idempotent_a_second_run_changes_nothing()
    {
        var now = await AfterPlacementAsync("o3", 72);
        await _fulfilment.RunAsync(now);
        var first = (await _lifecycle.LoadAsync("o3"))!;

        await _fulfilment.RunAsync(now);
        var second = (await _lifecycle.LoadAsync("o3"))!;

        Assert.Equal(first.Status, second.Status);
        Assert.Equal(first.Events.Length, second.Events.Length);
    }

    [Fact]
    public async Task Reaches_the_same_place_whether_run_often_or_once()
    {
        foreach (var (_, hours) in Delivery.Schedule)
            await _fulfilment.RunAsync(await AfterPlacementAsync("o3", hours));
        var stepwise = (await _lifecycle.LoadAsync("o3"))!;

        await db.ResetAsync();

        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 72));
        var catchUp = (await _lifecycle.LoadAsync("o3"))!;

        Assert.Equal(stepwise.Status, catchUp.Status);
        Assert.Equal(stepwise.Events.Select(e => e.Status), catchUp.Events.Select(e => e.Status));
    }

    [Fact]
    public async Task Leaves_an_order_alone_until_it_has_earned_the_next_stage()
    {
        var report = await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 0.25));

        Assert.Equal(OrderStatuses.Processing, (await _lifecycle.LoadAsync("o3"))!.Status);
        Assert.DoesNotContain(report.Advanced, a => a.OrderId == "o3");
    }

    [Fact]
    public async Task Never_touches_a_cancelled_order()
    {
        await _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled);
        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 500));

        Assert.Equal(OrderStatuses.Cancelled, (await _lifecycle.LoadAsync("o3"))!.Status);
    }

    [Fact]
    public async Task Never_touches_a_delivered_order()
    {
        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 500));

        var delivered = (await _lifecycle.LoadAsync("o1"))!;
        Assert.Equal(OrderStatuses.Delivered, delivered.Status);
        Assert.Single(delivered.Events, e => e.Status == OrderStatuses.Delivered);
    }

    [Fact]
    public async Task Never_touches_an_unpaid_order()
    {
        // An unpaid basket is a payment problem a timer cannot fix.
        var unpaid = await SeedAbandonedCheckoutAsync("prod13", 1, Ids.Now().AddDays(30));
        await _fulfilment.RunAsync(Ids.Now().AddDays(10));

        Assert.Equal(OrderStatuses.PendingPayment, (await _lifecycle.LoadAsync(unpaid))!.Status);
    }

    [Fact]
    public async Task Stamps_a_carrier_and_tracking_number_when_it_ships()
    {
        await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 30));

        var order = (await _lifecycle.LoadAsync("o3"))!;
        Assert.Equal(OrderStatuses.Shipped, order.Status);
        Assert.Equal(FulfilmentService.Carrier, order.Carrier);
        Assert.Matches(@"^LEASH-\d{4}-\d{4}$", order.TrackingNumber!);
    }

    [Fact]
    public async Task Reports_what_it_scanned_and_what_it_moved()
    {
        var report = await _fulfilment.RunAsync(await AfterPlacementAsync("o3", 72));

        Assert.True(report.Scanned > 0);
        Assert.NotEmpty(report.Advanced);
        Assert.All(report.Advanced, move => Assert.NotEqual(move.From, move.To));
    }

    [Fact]
    public async Task Closes_out_abandoned_checkouts_on_the_way()
    {
        var abandoned = await SeedAbandonedCheckoutAsync("prod13", 2, Ids.Now().AddHours(-1));
        var before = await StockAsync("prod13");

        var report = await _fulfilment.RunAsync(Ids.Now());

        Assert.Contains(abandoned, report.AbandonedReleased);
        Assert.Equal(before + 2, await StockAsync("prod13"));
    }

    // ── refillsLeft — REQUIREMENTS.md P9, as the owner decided it ────────
    //
    // Luna's mr2 covers prod19 with three refills. Zero means exhausted, null
    // means no limit, and checkout spends them in the stock's transaction.

    [Fact]
    public async Task Buying_an_rx_product_spends_a_refill_per_unit()
    {
        await _orders.CreateAsync(Priya, Order("prod19", 2, petId: "p4"));

        Assert.Equal(1, await RefillsAsync("mr2"));
    }

    [Fact]
    public async Task A_prescription_covers_only_as_many_units_as_it_has_refills()
    {
        var (quote, _) = await Quote(Priya, "p4", ("prod19", 4));

        var problem = Assert.Single(quote!.Problems);
        Assert.Equal(CartProblemCodes.PrescriptionRequired, problem.Code);
        Assert.Contains("covers 3 more", problem.Message);
    }

    [Fact]
    public async Task An_exhausted_prescription_stops_authorising()
    {
        // Three refills, three purchases — the fourth is refused, which is the
        // whole of what P9 asked for. Before M6 this would have succeeded until
        // the prescription expired.
        for (var i = 0; i < 3; i++)
            Assert.Null((await _orders.CreateAsync(Priya, Order("prod19", 1, petId: "p4"))).Failure);

        Assert.Equal(0, await RefillsAsync("mr2"));

        var fourth = await _orders.CreateAsync(Priya, Order("prod19", 1, petId: "p4"));
        Assert.Equal(OrderFailure.Unavailable, fourth.Failure);
        Assert.Equal(CartProblemCodes.PrescriptionRequired, fourth.Quote!.Problems[0].Code);
    }

    [Fact]
    public async Task A_prescription_with_no_limit_is_never_used_up()
    {
        await ExecuteAsync("""UPDATE medical_records SET "refillsLeft" = NULL WHERE id = 'mr2'""");

        var outcome = await _orders.CreateAsync(Priya, Order("prod19", 5, petId: "p4"));

        Assert.Null(outcome.Failure);
        Assert.Null(await RefillsAsync("mr2"));
    }

    [Fact]
    public async Task A_refused_order_spends_no_refills()
    {
        // Rx line covered, second line sold out: the whole order is refused, and
        // the refill the Rx line would have used is still there.
        await _orders.CreateAsync(Priya,
            new CreateOrderRequest(
                [new CartLineInput("prod19", 1), new CartLineInput("prod25", 1)],
                Address, null, "p4"));

        Assert.Equal(3, await RefillsAsync("mr2"));
    }

    [Fact]
    public async Task Two_checkouts_cannot_both_spend_the_last_refills()
    {
        // Three refills, two checkouts for two units each. Exactly one can be
        // covered; the prescription lock makes the second re-count and refuse.
        var results = await Task.WhenAll(
            _orders.CreateAsync(Priya, Order("prod19", 2, petId: "p4")),
            _orders.CreateAsync(Priya, Order("prod19", 2, petId: "p4")));

        Assert.Single(results, r => r.Failure is null);
        Assert.Equal(1, await RefillsAsync("mr2"));

        // And the loser's stock went back with its transaction.
        Assert.Equal(15 - 2, await StockAsync("prod19"));
    }

    [Fact]
    public void Spends_unlimited_cover_first_then_the_soonest_to_expire()
    {
        var soon = Rx("rx-soon", refills: 1, expiresInDays: 10);
        var later = Rx("rx-later", refills: 5, expiresInDays: 300);

        var cover = new PrescriptionCover([later, soon]);
        var result = cover.Cover("food", 3);

        // The refill about to lapse is spent before the one that will keep.
        Assert.Equal(
            [new PrescriptionCover.Use("rx-soon", 1), new PrescriptionCover.Use("rx-later", 2)],
            result.Uses);

        var unlimited = new PrescriptionCover([later, Rx("rx-open", refills: null, expiresInDays: 30)]);
        var free = unlimited.Cover("food", 50);
        Assert.Equal(PrescriptionCover.Outcome.Covered, free.Outcome);
        Assert.Empty(free.Uses);
    }

    [Fact]
    public void Two_products_on_one_prescription_share_its_refills()
    {
        // One prescription naming two products cannot cover both from the same
        // refills — the tally runs across the whole basket.
        var shared = Rx("rx", refills: 2, expiresInDays: 60, slugs: ["wet", "dry"]);
        var cover = new PrescriptionCover([shared]);

        Assert.Equal(PrescriptionCover.Outcome.Covered, cover.Cover("wet", 2).Outcome);
        Assert.Equal(PrescriptionCover.Outcome.Insufficient, cover.Cover("dry", 1).Outcome);
    }

    private static Leash.Core.Models.Entities.MedicalRecordEntity Rx(
        string id, int? refills, int expiresInDays, string[]? slugs = null) => new()
    {
        Id = id,
        Type = MedicalRecordTypes.Prescription,
        RefillsLeft = refills,
        ExpiresAt = Ids.Now().AddDays(expiresInDays),
        OccurredAt = Ids.Now().AddDays(-1),
        ProductSlugs = slugs ?? ["food"],
    };

    private async Task<int?> RefillsAsync(string recordId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<int?>(
            """SELECT "refillsLeft" FROM medical_records WHERE id = @recordId""", new { recordId });
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(sql);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<int> StockAsync(string productId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<int>(
            """SELECT "stockQty" FROM products WHERE id = @productId""", new { productId });
    }

    /// <summary>
    /// An unpaid order holding <paramref name="quantity"/> of a product, with
    /// the stock already taken, whose hold lapses at <paramref name="expiresAt"/>.
    /// Written as rows rather than through checkout, because checkout would pay
    /// for it — and the point is an order that was never paid for.
    /// </summary>
    private async Task<string> SeedAbandonedCheckoutAsync(
        string productId, int quantity, DateTimeOffset expiresAt)
    {
        var id = Ids.New("o");
        await using var conn = await db.DataSource.OpenConnectionAsync();

        await conn.ExecuteAsync(
            """
            UPDATE products SET "stockQty" = "stockQty" - @quantity WHERE id = @productId;

            INSERT INTO orders (
                id, "userId", status, "paymentStatus", "subtotalCents", "shippingCents",
                "taxCents", "totalCents", "shipName", "shipLine1", "shipCity", "shipState",
                "shipPostalCode", "placedAt", "reservationExpiresAt")
            VALUES (
                @id, 'u2', 'pending_payment', 'unpaid', 0, 0, 0, 0, 'Daniel Reyes',
                '1 Main St', 'Austin', 'TX', '78701', @placedAt, @expiresAt);

            INSERT INTO order_items (
                id, "orderId", "productId", name, brand, "imageUrl", slug,
                "unitPriceCents", quantity, "lineTotalCents")
            SELECT @itemId, @id, id, name, brand, "imageUrl", slug, "priceCents", @quantity, 0
            FROM products WHERE id = @productId;
            """,
            new
            {
                id,
                itemId = Ids.New("oi"),
                productId,
                quantity,
                placedAt = expiresAt.UtcDateTime.AddMinutes(-15),
                expiresAt = expiresAt.UtcDateTime,
            });

        return id;
    }
}
