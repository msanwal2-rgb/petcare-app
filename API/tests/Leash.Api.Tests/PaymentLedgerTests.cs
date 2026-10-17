using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The port of the M7 half of <c>tests/orders.test.ts</c> (lines 434–868):
/// "the payment provider is a real seam", "refund accounting" and "payment
/// state machine". Written before the implementation, as BUILD_PLAN.md asks.
///
/// ── The fake provider is asynchronous, which is the point ──
///
/// The demo provider settles inline, so no test written against it could
/// express an out-of-order event, a duplicate delivery or a webhook that never
/// arrives — the three things that actually go wrong with real payments.
/// <see cref="FakeStripe"/> hands back a <c>requires_payment_method</c> intent
/// and lets the test decide when, and in what order, the truth turns up.
///
/// ── Departures ──
///
///  1. <b>Refunds are retryable.</b> Two cases the reference has no counterpart
///     for: a provider that times out leaves the refund <c>pending</c> (it may
///     have gone through) and the sweep re-sends it under the same idempotency
///     key; a provider that refuses outright marks it <c>failed</c>.
///  2. <b>Concurrent refunds.</b> The "already refunding" check runs under a
///     lock on the payment, so two at once produce one refund.
///  3. <b>A late settlement of a cancelled order is refunded</b>, rather than
///     money sitting against an order whose stock was already released.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class PaymentLedgerTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Maya = "u1";
    private const string Admin = "u22";

    private CoreHost _core = null!;
    private FakeStripe _stripe = null!;
    private IOrderService _orders = null!;
    private IOrderLifecycle _lifecycle = null!;
    private IPaymentLedger _ledger = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _stripe = new FakeStripe();
        _core = new CoreHost(db.ConnectionString,
            services => services.AddSingleton<IPaymentProvider>(_stripe));
        _orders = _core.Get<IOrderService>();
        _lifecycle = _core.Get<IOrderLifecycle>();
        _ledger = _core.Get<IPaymentLedger>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static readonly ShippingAddressDto Address = new(
        "Maya Chen", "1204 Grove Street", "Apt 3B", "Austin", "TX", "78704", "US",
        "(512) 555-0142");

    private Task<CreateOrderOutcome> PlaceAsync(string productId = "prod13", int quantity = 1)
        => _orders.CreateAsync(Maya, new CreateOrderRequest(
            [new CartLineInput(productId, quantity)], Address, null, null));

    private async Task<PlacedOrderDto> PlacedAsync(string productId = "prod13", int quantity = 1)
    {
        var outcome = await PlaceAsync(productId, quantity);
        Assert.Null(outcome.Failure);
        return outcome.Placed!;
    }

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private async Task Exec(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    private Task<(string Status, int AmountCents, int AmountRefundedCents, string FailureCode)> PaymentByRef(string reference)
        => One<(string, int, int, string)>(
            """SELECT status, "amountCents", "amountRefundedCents", "failureCode" FROM payments WHERE "providerRef" = @reference""",
            new { reference });

    private Task<(string Id, string Status, int AmountCents, int AmountRefundedCents)> PaymentForOrder(string orderId)
        => One<(string, string, int, int)>(
            """SELECT id, status, "amountCents", "amountRefundedCents" FROM payments WHERE "orderId" = @orderId ORDER BY "createdAt" DESC LIMIT 1""",
            new { orderId });

    // ── The payment provider is a real seam ──────────────────────────────

    [Fact]
    public async Task Creates_the_intent_for_the_servers_total_keyed_on_the_order()
    {
        var placed = await PlacedAsync();

        Assert.Equal([$"createIntent:{placed.Order.TotalCents}:{placed.Order.Id}"], _stripe.Calls);

        // The clientSecret reaches this one response and is never stored (M5).
        Assert.EndsWith("_secret", placed.Payment.ClientSecret);
        var stored = await One<string>(
            """SELECT row_to_json(p)::text FROM payments p WHERE "providerRef" = @r""",
            new { r = placed.Payment.Ref });
        Assert.DoesNotContain("_secret", stored);
    }

    [Fact]
    public async Task Leaves_the_order_unpaid_until_the_payment_actually_succeeds()
    {
        var placed = await PlacedAsync();

        // The state the old design could never occupy: an order exists, stock
        // is held, and no money has moved.
        Assert.Equal(OrderStatuses.PendingPayment, placed.Order.Status);
        Assert.Equal(PaymentStatuses.Unpaid, placed.Order.PaymentStatus);

        await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref));
        await _lifecycle.SettleAsync(placed.Order.Id);

        var after = await _lifecycle.LoadAsync(placed.Order.Id);
        Assert.Equal(OrderStatuses.Paid, after!.Status);
        Assert.Equal(PaymentStatuses.Paid, after.PaymentStatus);
    }

    [Fact]
    public async Task Settling_an_unpaid_order_does_nothing()
    {
        var placed = await PlacedAsync();

        await _lifecycle.SettleAsync(placed.Order.Id);

        Assert.Equal(OrderStatuses.PendingPayment, (await _lifecycle.LoadAsync(placed.Order.Id))!.Status);
    }

    [Fact]
    public async Task Reserves_stock_at_checkout_before_the_money_arrives()
    {
        var before = await One<int>("""SELECT "stockQty" FROM products WHERE id = 'prod13'""");
        await PlacedAsync(quantity: 2);
        var after = await One<int>("""SELECT "stockQty" FROM products WHERE id = 'prod13'""");

        // Deferring this to the webhook would let two customers both be told
        // "order placed" for the last unit.
        Assert.Equal(before - 2, after);
    }

    [Fact]
    public async Task Charges_nobody_when_a_stock_race_is_lost()
    {
        var stock = await One<int>("""SELECT "stockQty" FROM products WHERE id = 'prod6'""");

        // Each buyer wants more than half of what is left, so both cannot win.
        var quantity = stock / 2 + 1;
        var results = await Task.WhenAll(PlaceAsync("prod6", quantity), PlaceAsync("prod6", quantity));

        Assert.Single(results, r => r.Failure is null);
        // The loser never had an intent created — there is nothing to give back.
        Assert.Single(_stripe.Calls, c => c.StartsWith("createIntent", StringComparison.Ordinal));
        Assert.DoesNotContain(_stripe.Calls, c => c.StartsWith("refund", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Records_a_failed_payment_without_cancelling_the_order()
    {
        var placed = await PlacedAsync();

        await _ledger.ApplyIntentStateAsync(_stripe.Fail(placed.Payment.Ref));

        var payment = await PaymentByRef(placed.Payment.Ref);
        Assert.Equal(PaymentStatuses.Failed, payment.Status);
        Assert.Equal("card_declined", payment.FailureCode);

        // Stripe keeps a failed intent retryable, so the order stays where it is.
        Assert.Equal(OrderStatuses.PendingPayment, (await _lifecycle.LoadAsync(placed.Order.Id))!.Status);
    }

    [Fact]
    public async Task A_failed_payment_can_still_succeed_on_a_second_card()
    {
        var placed = await PlacedAsync();
        await _ledger.ApplyIntentStateAsync(_stripe.Fail(placed.Payment.Ref), At("10:00"));

        var retried = await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref), At("10:05"));
        await _lifecycle.SettleAsync(placed.Order.Id);

        Assert.True(retried.Ok);
        Assert.Equal(OrderStatuses.Paid, (await _lifecycle.LoadAsync(placed.Order.Id))!.Status);
    }

    [Fact]
    public async Task Refuses_to_mark_an_order_paid_for_the_wrong_amount()
    {
        var placed = await PlacedAsync();

        var applied = await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref, amountCents: 1));

        Assert.False(applied.Ok);
        Assert.Equal(ApplyFailure.AmountMismatch, applied.Failure);
        Assert.Equal(PaymentStatuses.Failed, (await PaymentByRef(placed.Payment.Ref)).Status);
    }

    [Fact]
    public async Task Is_idempotent_the_same_event_twice_has_one_effect()
    {
        var placed = await PlacedAsync();
        var success = _stripe.Succeed(placed.Payment.Ref);

        var first = await _ledger.ApplyIntentStateAsync(success, At("10:00"));
        var second = await _ledger.ApplyIntentStateAsync(success, At("10:00"));

        Assert.True(first is { Ok: true, Changed: true });
        Assert.True(second is { Ok: true, Changed: false });
    }

    [Fact]
    public async Task Ignores_an_event_older_than_one_it_has_already_applied()
    {
        var placed = await PlacedAsync();

        await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref), At("12:00"));

        // A failure notice created *before* the success, arriving after it.
        // Without the guard this would un-pay a paid order.
        var stale = await _ledger.ApplyIntentStateAsync(_stripe.Fail(placed.Payment.Ref), At("11:00"));

        Assert.Equal(ApplyFailure.StaleEvent, stale.Failure);
        Assert.Equal(PaymentStatuses.Paid, (await PaymentByRef(placed.Payment.Ref)).Status);
    }

    [Fact]
    public async Task Refuses_an_illegal_transition_and_leaves_the_payment_alone()
    {
        var placed = await PlacedAsync();
        await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref), At("10:00"));
        await Exec("""UPDATE payments SET status = 'refunded' WHERE "providerRef" = @r""",
            new { r = placed.Payment.Ref });

        var applied = await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref), At("11:00"));

        Assert.Equal(ApplyFailure.IllegalTransition, applied.Failure);
        Assert.Equal(PaymentStatuses.Refunded, (await PaymentByRef(placed.Payment.Ref)).Status);
    }

    [Fact]
    public async Task An_intent_it_has_no_record_of_is_refused()
    {
        var applied = await _ledger.ApplyIntentStateAsync(
            new PaymentIntent("pi_nobody", IntentStatuses.Succeeded, 100, "usd", null));

        Assert.Equal(ApplyFailure.UnknownPayment, applied.Failure);
    }

    [Fact]
    public async Task Records_the_card_brand_and_last_four_for_the_receipt()
    {
        var placed = await PlacedAsync();
        await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref));

        var (brand, last4) = await One<(string, string)>(
            """SELECT "methodBrand", "methodLast4" FROM payments WHERE "providerRef" = @r""",
            new { r = placed.Payment.Ref });
        Assert.Equal(("visa", "4242"), (brand, last4));
    }

    [Fact]
    public async Task Refunds_when_a_paid_order_is_cancelled()
    {
        // o3 is seeded `processing` and paid — late enough to have been charged,
        // early enough that cancelling is still a legal move.
        var (_, failure) = await _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled);
        Assert.Null(failure);

        // The bug this covers: cancelling used to restock and set `cancelled`
        // while leaving paymentStatus "paid" — the customer's money stayed with us.
        Assert.Single(_stripe.Calls, c => c.StartsWith("refund", StringComparison.Ordinal));
        var payment = await PaymentForOrder("o3");
        Assert.Equal(PaymentStatuses.Refunded, payment.Status);
        Assert.Equal(payment.AmountCents, payment.AmountRefundedCents);
        Assert.Equal(PaymentStatuses.Refunded, (await _lifecycle.LoadAsync("o3"))!.PaymentStatus);
    }

    [Fact]
    public async Task Refunds_when_an_order_is_refunded()
    {
        var (_, failure) = await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded);

        Assert.Null(failure);
        Assert.Single(_stripe.Calls, c => c.StartsWith("refund", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Writes_the_refund_row_before_calling_the_provider()
    {
        // The whole point of the ordering: when the provider is called, the row
        // that says money is owed already exists.
        int? rowsWhenCalled = null;
        _stripe.OnRefund = async () => rowsWhenCalled = await One<int>(
            """SELECT count(*)::int FROM refunds WHERE "paymentId" = 'pay_seed_o1' AND status = 'pending'""");

        await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded);

        Assert.Equal(1, rowsWhenCalled);
    }

    [Fact]
    public async Task A_refund_the_provider_could_not_confirm_stays_pending_and_is_retried()
    {
        _stripe.RefundFailure = new PaymentProviderException("timeout", definitive: false);

        var outcome = await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1"));

        Assert.Equal(RefundFailure.ProviderUnavailable, outcome.Failure);
        Assert.Equal("pending", await One<string>(
            """SELECT status FROM refunds WHERE "paymentId" = 'pay_seed_o1'"""));

        // Not yet old enough to retry.
        _stripe.RefundFailure = null;
        Assert.Equal(0, await _ledger.RetryUnacknowledgedRefundsAsync(DateTimeOffset.UtcNow, TimeSpan.FromMinutes(10)));

        var retried = await _ledger.RetryUnacknowledgedRefundsAsync(
            DateTimeOffset.UtcNow.AddMinutes(11), TimeSpan.FromMinutes(10));

        Assert.Equal(1, retried);
        var payment = await PaymentForOrder("o1");
        Assert.Equal(PaymentStatuses.Refunded, payment.Status);

        // Both calls carried the same key, so a provider that did take the first
        // one does not refund twice.
        var keys = _stripe.RefundKeys;
        Assert.Equal(2, keys.Count);
        Assert.Equal(keys[0], keys[1]);
    }

    [Fact]
    public async Task A_refund_the_provider_refused_is_recorded_as_failed()
    {
        _stripe.RefundFailure = new PaymentProviderException("charge_already_refunded", definitive: true);

        var outcome = await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1"));

        Assert.Equal(RefundFailure.ProviderFailed, outcome.Failure);
        Assert.Equal("failed", await One<string>(
            """SELECT status FROM refunds WHERE "paymentId" = 'pay_seed_o1'"""));
        Assert.Equal(PaymentStatuses.Paid, (await PaymentForOrder("o1")).Status);
    }

    [Fact]
    public async Task Does_not_restock_goods_that_already_reached_the_customer()
    {
        var item = await One<(string ProductId, int Quantity)>(
            """SELECT "productId", quantity FROM order_items WHERE "orderId" = 'o1' LIMIT 1""");
        var before = await One<int>("""SELECT "stockQty" FROM products WHERE id = @id""", new { id = item.ProductId });

        await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded);

        // delivered → refunded is legal, and restocking on it would credit
        // inventory for a bag of food sitting in somebody's kitchen.
        Assert.Equal(before, await One<int>("""SELECT "stockQty" FROM products WHERE id = @id""", new { id = item.ProductId }));
    }

    [Fact]
    public async Task Restocks_a_returned_order_when_told_the_goods_came_back()
    {
        var item = await One<(string ProductId, int Quantity)>(
            """SELECT "productId", quantity FROM order_items WHERE "orderId" = 'o1' LIMIT 1""");
        var before = await One<int>("""SELECT "stockQty" FROM products WHERE id = @id""", new { id = item.ProductId });

        await _lifecycle.MoveAsync("o1", OrderStatuses.Refunded, new OrderMove(Restock: true));

        Assert.Equal(before + item.Quantity,
            await One<int>("""SELECT "stockQty" FROM products WHERE id = @id""", new { id = item.ProductId }));
    }

    [Fact]
    public async Task Refuses_a_second_concurrent_move_of_the_same_order()
    {
        // o3 is processing; both moves are individually legal, so the loser can
        // only be losing the race. Applied exactly once — the money went back once.
        var results = await Task.WhenAll(
            _lifecycle.MoveAsync("o3", OrderStatuses.Cancelled),
            _lifecycle.MoveAsync("o3", OrderStatuses.Refunded));

        Assert.Single(results, r => r.Failure is null);
        Assert.Single(_stripe.Calls, c => c.StartsWith("refund", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_payment_that_settles_after_its_order_was_cancelled_is_refunded()
    {
        // The hold expired while the customer sat in a 3-D Secure challenge;
        // the reaper released the stock and cancelled the order; then the card
        // went through. The reference left that money against a dead order.
        var placed = await PlacedAsync();
        await _lifecycle.MoveAsync(placed.Order.Id, OrderStatuses.Cancelled);

        await _ledger.ApplyIntentStateAsync(_stripe.Succeed(placed.Payment.Ref));
        await _lifecycle.SettleAsync(placed.Order.Id);

        Assert.Equal(OrderStatuses.Cancelled, (await _lifecycle.LoadAsync(placed.Order.Id))!.Status);
        Assert.Equal(PaymentStatuses.Refunded, (await PaymentByRef(placed.Payment.Ref)).Status);
    }

    // ── Refund accounting ────────────────────────────────────────────────

    [Fact]
    public async Task Supports_a_partial_refund_and_tracks_the_remainder()
    {
        var payment = await PaymentForOrder("o1");
        var half = payment.AmountCents / 2;

        var first = await _ledger.RequestRefundAsync(new RefundRequest(
            PaymentId: payment.Id, AmountCents: half, InitiatedBy: Admin));
        Assert.True(first.Ok);

        var after = await PaymentForOrder("o1");
        Assert.Equal(PaymentStatuses.PartiallyRefunded, after.Status);
        Assert.Equal(half, after.AmountRefundedCents);

        // The order's mirrored status follows the ledger.
        Assert.Equal(PaymentStatuses.PartiallyRefunded, (await _lifecycle.LoadAsync("o1"))!.PaymentStatus);
    }

    [Fact]
    public async Task Two_partial_refunds_make_a_full_one()
    {
        var payment = await PaymentForOrder("o1");
        var half = payment.AmountCents / 2;

        await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: payment.Id, AmountCents: half));
        await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: payment.Id));

        var after = await PaymentForOrder("o1");
        Assert.Equal(PaymentStatuses.Refunded, after.Status);
        Assert.Equal(payment.AmountCents, after.AmountRefundedCents);
    }

    [Fact]
    public async Task Refuses_to_refund_more_than_was_captured()
    {
        var payment = await PaymentForOrder("o1");

        var result = await _ledger.RequestRefundAsync(new RefundRequest(
            PaymentId: payment.Id, AmountCents: payment.AmountCents + 1));

        Assert.Equal(RefundFailure.ExceedsCaptured, result.Failure);
        Assert.Equal(payment.AmountCents, result.RemainingCents);
    }

    [Fact]
    public async Task Refuses_a_second_refund_while_one_is_pending()
    {
        await Exec(
            """
            INSERT INTO refunds (id, "paymentId", "amountCents", status, "createdAt")
            VALUES ('rfnd_inflight', 'pay_seed_o1', 100, 'pending', now())
            """);

        var result = await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1", AmountCents: 100));

        Assert.Equal(RefundFailure.AlreadyRefunding, result.Failure);
    }

    [Fact]
    public async Task Two_refunds_at_once_produce_one()
    {
        var results = await Task.WhenAll(
            _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1")),
            _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1")));

        Assert.Single(results, r => r.Ok);
        Assert.Equal(1, await One<int>("""SELECT count(*)::int FROM refunds WHERE "paymentId" = 'pay_seed_o1'"""));
    }

    [Fact]
    public async Task Records_who_issued_it()
    {
        await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: "pay_seed_o1", InitiatedBy: Admin));

        Assert.Equal(Admin, await One<string>(
            """SELECT "initiatedBy" FROM refunds WHERE "paymentId" = 'pay_seed_o1'"""));
    }

    [Fact]
    public async Task Reports_when_there_is_no_payment_to_refund()
    {
        var result = await _ledger.RequestRefundAsync(new RefundRequest(OrderId: "nope"));

        Assert.Equal(RefundFailure.NoPayment, result.Failure);
    }

    [Fact]
    public async Task Settling_a_refund_twice_counts_it_once()
    {
        var payment = await PaymentForOrder("o1");
        var outcome = await _ledger.RequestRefundAsync(new RefundRequest(PaymentId: payment.Id, AmountCents: 100));

        await _ledger.SettleRefundAsync(outcome.RefundId!);
        await _ledger.SettleRefundAsync(outcome.RefundId!);

        Assert.Equal(100, (await PaymentForOrder("o1")).AmountRefundedCents);
    }

    // ── Payment state machine ────────────────────────────────────────────

    [Theory]
    [InlineData("unpaid", "pending")]
    [InlineData("pending", "requires_action")]
    [InlineData("requires_action", "paid")]
    [InlineData("paid", "refunded")]
    public void Allows_the_normal_card_path(string from, string to)
        => Assert.True(PaymentTransitions.CanTransition(from, to));

    [Theory]
    [InlineData("unpaid", "authorized")]
    [InlineData("authorized", "paid")]
    public void Still_allows_the_manual_capture_path(string from, string to)
        => Assert.True(PaymentTransitions.CanTransition(from, to));

    [Fact]
    public void Allows_a_partial_refund_to_become_a_full_one()
    {
        Assert.True(PaymentTransitions.CanTransition("paid", "partially_refunded"));
        Assert.True(PaymentTransitions.CanTransition("partially_refunded", "refunded"));
    }

    [Fact]
    public void Lets_a_dispute_be_won_as_well_as_lost()
    {
        Assert.True(PaymentTransitions.CanTransition("paid", "disputed"));
        Assert.True(PaymentTransitions.CanTransition("disputed", "paid"));
        Assert.True(PaymentTransitions.CanTransition("disputed", "refunded"));
    }

    [Fact]
    public void Refuses_to_un_refund_or_re_charge_a_refunded_payment()
    {
        Assert.False(PaymentTransitions.CanTransition("refunded", "paid"));
        Assert.False(PaymentTransitions.CanTransition("refunded", "authorized"));
    }

    [Fact]
    public void Lets_a_failed_payment_be_retried_because_stripe_keeps_the_intent_alive()
    {
        Assert.True(PaymentTransitions.CanTransition("failed", "pending"));
        Assert.True(PaymentTransitions.CanTransition("failed", "paid"));
    }

    [Fact]
    public void Treats_a_no_op_as_allowed()
        => Assert.True(PaymentTransitions.CanTransition("paid", "paid"));

    private static DateTimeOffset At(string hhmm)
        => DateTimeOffset.Parse($"2026-09-09T{hhmm}:00.000Z");
}

/// <summary>
/// An asynchronous provider that records what it was asked and lets the test
/// decide what the truth is. See <see cref="PaymentLedgerTests"/>.
/// </summary>
public sealed class FakeStripe : IPaymentProvider
{
    private readonly Dictionary<string, int> _intents = [];
    private int _n;

    public List<string> Calls { get; } = [];
    public List<string> RefundKeys { get; } = [];

    /// <summary>Thrown from <see cref="RefundAsync"/> while set.</summary>
    public Exception? RefundFailure { get; set; }

    /// <summary>Runs inside <see cref="RefundAsync"/>, before it answers.</summary>
    public Func<Task>? OnRefund { get; set; }

    public string Name => "stripe";
    public bool Asynchronous => true;

    public Task<PaymentIntent> CreateIntentAsync(IntentRequest request, CancellationToken ct = default)
    {
        lock (Calls)
        {
            var reference = $"pi_test_{++_n}";
            Calls.Add($"createIntent:{request.AmountCents}:{request.IdempotencyKey}");
            _intents[reference] = request.AmountCents;
            return Task.FromResult(new PaymentIntent(
                reference, IntentStatuses.RequiresPaymentMethod, request.AmountCents,
                request.Currency, $"{reference}_secret"));
        }
    }

    public Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default)
    {
        lock (Calls) Calls.Add($"getIntent:{reference}");
        return Task.FromResult(new PaymentIntent(
            reference, IntentStatuses.RequiresPaymentMethod, _intents.GetValueOrDefault(reference), "usd", null));
    }

    public Task<PaymentIntent> CancelIntentAsync(string reference, CancellationToken ct = default)
    {
        lock (Calls) Calls.Add($"cancelIntent:{reference}");
        return Task.FromResult(new PaymentIntent(reference, IntentStatuses.Canceled, 0, "usd", null));
    }

    public async Task<ProviderRefund> RefundAsync(
        string reference, int amountCents, string? reason, string idempotencyKey,
        CancellationToken ct = default)
    {
        lock (Calls)
        {
            Calls.Add($"refund:{reference}:{amountCents}");
            RefundKeys.Add(idempotencyKey);
        }

        if (OnRefund is not null) await OnRefund();
        if (RefundFailure is not null) throw RefundFailure;

        return new ProviderRefund($"re_{idempotencyKey}", RefundStatuses.Succeeded, amountCents);
    }

    /// <summary>What the webhook would carry when the customer's card goes through.</summary>
    public PaymentIntent Succeed(string reference, int? amountCents = null)
        => new(reference, IntentStatuses.Succeeded, amountCents ?? _intents[reference], "usd", null,
            MethodBrand: "visa", MethodLast4: "4242");

    public PaymentIntent Fail(string reference, string code = "card_declined")
        => new(reference, IntentStatuses.Failed, _intents[reference], "usd", null,
            FailureCode: code, FailureMessage: "Your card was declined.");
}
