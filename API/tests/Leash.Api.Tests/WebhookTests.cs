using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/webhooks.test.ts</c>: the claim protocol
/// (REQUIREMENTS.md M7), what each Stripe event does, and retention.
///
/// Events are built as Stripe-shaped JSON and parsed by Stripe.net itself, so
/// the fixtures are real <c>Stripe.Event</c>s rather than look-alikes. Only the
/// fields that matter are filled in: <c>id</c> (idempotency), <c>created</c>
/// (ordering) and <c>type</c> (dispatch), plus each object's own.
///
/// One addition: <c>payment_intent.payment_failed</c> now tells the customer
/// (<c>order_payment_failed</c>), which the reference did and M8 left a kind for.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class WebhookTests(DatabaseFixture db) : IAsyncLifetime
{
    private CoreHost _core = null!;
    private IWebhookEventStore _store = null!;
    private IStripeWebhookHandler _handler = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _store = _core.Get<IWebhookEventStore>();
        _handler = _core.Get<IStripeWebhookHandler>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static int _seq;

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

    private static Stripe.Event Event(string type, object data, long created = 1_800_000_000)
        => StripeEvents.Parse(StripeEvents.Json($"evt_test_{Interlocked.Increment(ref _seq)}", type, data, created));

    private static IncomingEvent Incoming(Stripe.Event e)
        => new(e.Id, e.Type, e.Created, e.ApiVersion ?? "", e.ToJson());

    /// <summary>Put o1 back to the state a real checkout leaves it in, paying through <paramref name="intent"/>.</summary>
    private async Task<int> AwaitingPaymentAsync(string intent)
    {
        await Exec("UPDATE orders SET status = 'pending_payment', \"paymentStatus\" = 'unpaid' WHERE id = 'o1'");
        await Exec(
            """UPDATE payments SET status = 'pending', "providerRef" = @intent, "lastEventAt" = NULL WHERE "orderId" = 'o1'""",
            new { intent });
        return await One<int>("SELECT \"totalCents\" FROM orders WHERE id = 'o1'");
    }

    private static object Intent(string id, int amount, string status = "succeeded", object? error = null)
        => new
        {
            id,
            @object = "payment_intent",
            amount,
            currency = "usd",
            status,
            metadata = new { orderId = "o1" },
            last_payment_error = error,
        };

    // ── Claiming an event ────────────────────────────────────────────────

    [Fact]
    public async Task Claims_one_nobody_has_seen()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        Assert.Equal(ClaimKind.New, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Reports_a_second_delivery_of_a_processed_event_as_a_duplicate()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);
        await _store.MarkProcessedAsync(e.Id);

        Assert.Equal(ClaimKind.Duplicate, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Holds_off_a_second_worker_while_the_first_is_still_going()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);

        // The route answers 500, so the provider brings it back later rather
        // than two workers applying the same event at once.
        Assert.Equal(ClaimKind.InFlight, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Two_simultaneous_deliveries_are_claimed_once()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });

        var claims = await Task.WhenAll(
            _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow),
            _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow));

        Assert.Single(claims, c => c.Kind == ClaimKind.New);
        Assert.Single(claims, c => c.Kind == ClaimKind.InFlight);
    }

    [Fact]
    public async Task Re_claims_an_event_whose_worker_died_mid_flight()
    {
        // Insert `received`, crash, and a naive dedupe-on-insert tells the retry
        // everything is fine. The event is then lost for good, and the only
        // symptom is an order that never got paid.
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);

        var later = DateTimeOffset.UtcNow + WebhookEventStore.LockTtl + TimeSpan.FromSeconds(1);
        var claim = await _store.ClaimAsync(Incoming(e), later);

        Assert.Equal(ClaimKind.Retry, claim.Kind);
        Assert.Equal(2, claim.Attempts);
    }

    [Fact]
    public async Task Re_claims_one_that_failed()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);
        await _store.MarkFailedAsync(e.Id, "database was away");

        Assert.Equal(ClaimKind.Retry, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Gives_up_after_enough_attempts_rather_than_retrying_forever()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_1", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);
        await Exec("UPDATE webhook_events SET attempts = @max, status = 'failed' WHERE id = @id",
            new { max = WebhookEventStore.MaxAttempts, id = e.Id });

        Assert.Equal(ClaimKind.Exhausted, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Treats_a_skipped_event_as_settled()
    {
        var e = Event("customer.discount.created", new { id = "di_1", @object = "discount" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);
        await _store.MarkSkippedAsync(e.Id, "unknown_type");

        Assert.Equal(ClaimKind.Duplicate, (await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow)).Kind);
    }

    [Fact]
    public async Task Keeps_the_payload_so_a_human_can_replay_what_automation_gave_up_on()
    {
        var e = Event("payment_intent.succeeded", new { id = "pi_keep", @object = "payment_intent" });
        await _store.ClaimAsync(Incoming(e), DateTimeOffset.UtcNow);

        Assert.Contains("pi_keep", await One<string>("SELECT payload::text FROM webhook_events WHERE id = @id", new { id = e.Id }));
    }

    // ── Handling an event ────────────────────────────────────────────────

    [Fact]
    public async Task Ignores_a_type_nobody_subscribed_to()
    {
        // Stripe endpoints receive types you did not ask for. Not an error, and
        // answering 500 would buy a three-day retry storm.
        var result = await _handler.HandleAsync(Event("customer.discount.created", new { id = "di_1", @object = "discount" }));

        Assert.Equal(new WebhookHandled(false, null, WebhookSkipReasons.UnknownType), result);
    }

    [Fact]
    public async Task Ignores_an_intent_it_has_no_record_of()
    {
        var result = await _handler.HandleAsync(Event("payment_intent.succeeded", Intent("pi_unknown", 100)));

        Assert.Equal(WebhookSkipReasons.UnknownSubject, result.SkipReason);
    }

    [Fact]
    public async Task Marks_an_order_paid_when_its_intent_succeeds()
    {
        var total = await AwaitingPaymentAsync("pi_live");

        var result = await _handler.HandleAsync(Event("payment_intent.succeeded", Intent("pi_live", total)));

        Assert.True(result.Handled);
        Assert.Equal(("paid", "paid"), await One<(string, string)>(
            "SELECT status, \"paymentStatus\" FROM orders WHERE id = 'o1'"));
    }

    [Fact]
    public async Task Refuses_to_mark_an_order_paid_for_the_wrong_amount()
    {
        await AwaitingPaymentAsync("pi_wrong");

        var result = await _handler.HandleAsync(Event("payment_intent.succeeded", Intent("pi_wrong", 1)));

        Assert.Equal(WebhookSkipReasons.NoopTransition, result.SkipReason);
        Assert.Equal("pending_payment", await One<string>("SELECT status FROM orders WHERE id = 'o1'"));
    }

    [Fact]
    public async Task Has_one_effect_when_the_same_event_arrives_twice()
    {
        var total = await AwaitingPaymentAsync("pi_twice");

        // The seeded order carries the timeline of a delivered parcel, including
        // a `paid` event. Clear it, so what is counted is what the handler wrote.
        await Exec("DELETE FROM order_events WHERE \"orderId\" = 'o1'");

        var e = Event("payment_intent.succeeded", Intent("pi_twice", total));
        await _handler.HandleAsync(e);
        await _handler.HandleAsync(e);

        Assert.Equal(1, await One<int>(
            "SELECT count(*)::int FROM order_events WHERE \"orderId\" = 'o1' AND status = 'paid'"));
    }

    [Fact]
    public async Task Ignores_an_event_older_than_one_already_applied()
    {
        var total = await AwaitingPaymentAsync("pi_order");

        await _handler.HandleAsync(Event("payment_intent.succeeded", Intent("pi_order", total), 1_800_000_100));

        // A failure notice *created* before the success, arriving after it.
        var stale = await _handler.HandleAsync(Event("payment_intent.payment_failed",
            Intent("pi_order", total, "requires_payment_method", new { code = "card_declined", message = "Declined" }),
            1_800_000_000));

        Assert.Equal(WebhookSkipReasons.Stale, stale.SkipReason);
        Assert.Equal("paid", await One<string>("SELECT status FROM payments WHERE \"providerRef\" = 'pi_order'"));
    }

    [Fact]
    public async Task Leaves_an_order_alone_when_a_payment_merely_fails_and_tells_the_customer()
    {
        var total = await AwaitingPaymentAsync("pi_declined");

        // Stripe reverts a declined intent to requires_payment_method to keep it
        // retryable. The event type, not the object's status, says what happened.
        await _handler.HandleAsync(Event("payment_intent.payment_failed",
            Intent("pi_declined", total, "requires_payment_method", new { code = "card_declined", message = "Declined" })));

        Assert.Equal("pending_payment", await One<string>("SELECT status FROM orders WHERE id = 'o1'"));
        Assert.Equal(("failed", "card_declined"), await One<(string, string)>(
            "SELECT status, \"failureCode\" FROM payments WHERE \"providerRef\" = 'pi_declined'"));

        var notice = await One<(string Kind, string Href)>(
            "SELECT kind, href FROM notifications WHERE \"userId\" = 'u1'");
        Assert.Equal((NotificationKinds.OrderPaymentFailed, "/store/orders/o1"), notice);
    }

    [Fact]
    public async Task Gives_the_stock_back_when_an_intent_is_cancelled_outright()
    {
        var total = await AwaitingPaymentAsync("pi_cancelled");

        await _handler.HandleAsync(Event("payment_intent.canceled", Intent("pi_cancelled", total, "canceled")));

        Assert.Equal("cancelled", await One<string>("SELECT status FROM orders WHERE id = 'o1'"));
    }

    [Fact]
    public async Task Records_a_refund_that_was_issued_from_the_providers_own_dashboard()
    {
        var amount = await One<int>("SELECT \"amountCents\" FROM payments WHERE id = 'pay_seed_o1'");

        var result = await _handler.HandleAsync(Event("charge.refunded", new
        {
            id = "ch_1",
            @object = "charge",
            payment_intent = "demo_pay_o1",
            refunds = new
            {
                @object = "list",
                data = new[]
                {
                    new
                    {
                        id = "re_dashboard", @object = "refund", amount, status = "succeeded",
                        reason = "requested_by_customer", created = 1_800_000_000,
                    },
                },
            },
        }));

        Assert.True(result.Handled);
        Assert.Equal(("refunded", amount), await One<(string, int)>(
            "SELECT status, \"amountRefundedCents\" FROM payments WHERE id = 'pay_seed_o1'"));
        // And the order followed.
        Assert.Equal("refunded", await One<string>("SELECT status FROM orders WHERE id = 'o1'"));
        // Recorded as the provider's doing, not ours.
        Assert.Equal("stripe", await One<string>("SELECT \"initiatedBy\" FROM refunds WHERE \"providerRef\" = 're_dashboard'"));
    }

    [Fact]
    public async Task A_refund_event_for_one_of_our_refunds_settles_it_rather_than_adding_another()
    {
        await Exec(
            """
            INSERT INTO refunds (id, "paymentId", "providerRef", "amountCents", status, "createdAt")
            VALUES ('rfnd_ours', 'pay_seed_o1', 're_ours', 500, 'pending', now())
            """);

        await _handler.HandleAsync(Event("charge.refunded", new
        {
            id = "ch_1",
            @object = "charge",
            payment_intent = "demo_pay_o1",
            refunds = new
            {
                @object = "list",
                data = new[] { new { id = "re_ours", @object = "refund", amount = 500, status = "succeeded", created = 1_800_000_000 } },
            },
        }));

        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM refunds WHERE \"paymentId\" = 'pay_seed_o1'"));
        Assert.Equal(("partially_refunded", 500), await One<(string, int)>(
            "SELECT status, \"amountRefundedCents\" FROM payments WHERE id = 'pay_seed_o1'"));
    }

    [Fact]
    public async Task Marks_a_payment_disputed_on_a_chargeback()
    {
        await _handler.HandleAsync(Event("charge.dispute.created", new
        {
            id = "dp_1", @object = "dispute", payment_intent = "demo_pay_o1", status = "needs_response",
        }));

        Assert.Equal("disputed", await One<string>("SELECT status FROM payments WHERE id = 'pay_seed_o1'"));
    }

    [Fact]
    public async Task Restores_a_payment_when_a_dispute_is_won()
    {
        await _handler.HandleAsync(Event("charge.dispute.created", new
        {
            id = "dp_2", @object = "dispute", payment_intent = "demo_pay_o1", status = "needs_response",
        }, 1_800_000_000));
        await _handler.HandleAsync(Event("charge.dispute.closed", new
        {
            id = "dp_2", @object = "dispute", payment_intent = "demo_pay_o1", status = "won",
        }, 1_800_000_100));

        Assert.Equal("paid", await One<string>("SELECT status FROM payments WHERE id = 'pay_seed_o1'"));
    }

    [Fact]
    public async Task A_lost_dispute_counts_the_money_as_gone()
    {
        await _handler.HandleAsync(Event("charge.dispute.created", new
        {
            id = "dp_3", @object = "dispute", payment_intent = "demo_pay_o1", status = "needs_response",
        }, 1_800_000_000));
        await _handler.HandleAsync(Event("charge.dispute.closed", new
        {
            id = "dp_3", @object = "dispute", payment_intent = "demo_pay_o1", status = "lost",
        }, 1_800_000_100));

        var (status, amount, refunded) = await One<(string, int, int)>(
            "SELECT status, \"amountCents\", \"amountRefundedCents\" FROM payments WHERE id = 'pay_seed_o1'");
        Assert.Equal("refunded", status);
        Assert.Equal(amount, refunded);
    }

    // ── Subscription events ──────────────────────────────────────────────

    private const string PriceId = "price_test_leash_plus";

    private async Task WithStripePriceAsync()
        => await Exec("UPDATE plans SET \"stripePriceId\" = @PriceId WHERE id = 'plan_leash_plus'", new { PriceId });

    private static object Subscription(string status = "active", string priceId = PriceId)
        => new
        {
            id = "sub_stripe_1",
            @object = "subscription",
            customer = "cus_test_1",
            status,
            cancel_at_period_end = false,
            latest_invoice = "in_1",
            metadata = new { userId = "u2" },
            items = new
            {
                @object = "list",
                data = new[]
                {
                    new
                    {
                        id = "si_1", @object = "subscription_item",
                        price = new { id = priceId, @object = "price" },
                        current_period_start = 1_800_000_000,
                        current_period_end = 1_802_592_000,
                    },
                },
            },
        };

    private Task<(string UserId, string Status, DateTimeOffset? GraceEndsAt)> SubscriptionRow()
        => One<(string, string, DateTimeOffset?)>(
            "SELECT \"userId\", status, \"graceEndsAt\" FROM subscriptions WHERE \"providerRef\" = 'sub_stripe_1'");

    [Fact]
    public async Task Creates_a_membership_from_a_subscription_event()
    {
        await WithStripePriceAsync();

        var result = await _handler.HandleAsync(Event("customer.subscription.created", Subscription()));

        Assert.True(result.Handled);
        var row = await SubscriptionRow();
        Assert.Equal(("u2", "active"), (row.UserId, row.Status));

        // And says so (N2).
        Assert.Equal(NotificationKinds.MembershipStarted,
            await One<string>("SELECT kind FROM notifications WHERE \"userId\" = 'u2'"));
    }

    [Fact]
    public async Task Ignores_a_subscription_for_a_price_we_dont_sell()
    {
        await WithStripePriceAsync();

        var result = await _handler.HandleAsync(Event("customer.subscription.created",
            Subscription(priceId: "price_something_else")));

        Assert.Equal(WebhookSkipReasons.UnknownSubject, result.SkipReason);
    }

    [Fact]
    public async Task Does_not_let_a_delayed_past_due_overwrite_a_newer_active()
    {
        // A delayed dunning notice landing after a later renewal would silently
        // strip a paying member's benefits.
        await WithStripePriceAsync();
        await _handler.HandleAsync(Event("customer.subscription.created", Subscription(), 1_800_000_200));

        var stale = await _handler.HandleAsync(Event("customer.subscription.updated",
            Subscription("past_due"), 1_800_000_100));

        Assert.Equal(WebhookSkipReasons.Stale, stale.SkipReason);
        Assert.Equal("active", (await SubscriptionRow()).Status);
    }

    [Fact]
    public async Task Opens_a_grace_window_when_a_renewal_fails()
    {
        await WithStripePriceAsync();
        await _handler.HandleAsync(Event("customer.subscription.created", Subscription(), 1_800_000_000));
        await _handler.HandleAsync(Event("customer.subscription.updated", Subscription("past_due"), 1_800_000_100));

        var row = await SubscriptionRow();
        Assert.Equal("past_due", row.Status);
        Assert.NotNull(row.GraceEndsAt);
        Assert.Contains(NotificationKinds.MembershipPaymentFailed,
            await One<string>("SELECT string_agg(kind, ',') FROM notifications WHERE \"userId\" = 'u2'"));
    }

    [Fact]
    public async Task Ends_a_membership_when_the_subscription_is_deleted()
    {
        await WithStripePriceAsync();
        await _handler.HandleAsync(Event("customer.subscription.created", Subscription(), 1_800_000_000));
        await _handler.HandleAsync(Event("customer.subscription.deleted", Subscription(), 1_800_000_200));

        Assert.Equal("canceled", (await SubscriptionRow()).Status);
        Assert.Contains(NotificationKinds.MembershipEnded,
            await One<string>("SELECT string_agg(kind, ',') FROM notifications WHERE \"userId\" = 'u2'"));
    }

    [Fact]
    public async Task Links_a_customer_id_on_a_completed_checkout()
    {
        await _handler.HandleAsync(Event("checkout.session.completed", new
        {
            id = "cs_1", @object = "checkout.session", mode = "subscription",
            client_reference_id = "u2", customer = "cus_test_1",
        }));

        Assert.Equal("cus_test_1", await One<string>("SELECT \"stripeCustomerId\" FROM users WHERE id = 'u2'"));
    }

    [Fact]
    public async Task Records_a_renewal_invoice_without_pestering_the_member_about_it()
    {
        await Exec("UPDATE users SET \"stripeCustomerId\" = 'cus_test_1' WHERE id = 'u2'");

        await _handler.HandleAsync(Event("invoice.paid", new
        {
            id = "in_renewal", @object = "invoice", customer = "cus_test_1", amount_paid = 999, currency = "usd",
        }));

        Assert.Equal(("subscription_invoice", 999), await One<(string, int)>(
            "SELECT kind, \"amountCents\" FROM payments WHERE \"providerRef\" = 'in_renewal'"));
        // Nobody wants a monthly "we charged you" in their bell.
        Assert.Equal(0, await One<int>("SELECT count(*)::int FROM notifications WHERE \"userId\" = 'u2'"));
    }

    [Fact]
    public async Task A_renewal_invoice_delivered_twice_is_recorded_once()
    {
        await Exec("UPDATE users SET \"stripeCustomerId\" = 'cus_test_1' WHERE id = 'u2'");
        var e = Event("invoice.paid", new
        {
            id = "in_twice", @object = "invoice", customer = "cus_test_1", amount_paid = 999, currency = "usd",
        });

        await _handler.HandleAsync(e);
        await _handler.HandleAsync(e);

        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM payments WHERE \"providerRef\" = 'in_twice'"));
    }

    // ── Retention ────────────────────────────────────────────────────────

    [Fact]
    public async Task Drops_the_payloads_of_old_settled_events()
    {
        // They carry email addresses and card last-fours; there is no reason to
        // keep them once nobody is going to replay them.
        await Exec(
            """
            INSERT INTO webhook_events (id, type, "eventAt", payload, status, "receivedAt") VALUES
              ('evt_old', 'payment_intent.succeeded', now() - interval '200 days', '{}', 'processed', now() - interval '200 days'),
              ('evt_recent', 'payment_intent.succeeded', now(), '{}', 'processed', now())
            """);

        Assert.Equal(1, await _store.PurgeOldEventsAsync(DateTimeOffset.UtcNow, 90));
        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM webhook_events WHERE id = 'evt_recent'"));
    }

    [Fact]
    public async Task Keeps_a_failed_event_which_is_the_one_somebody_may_still_need()
    {
        await Exec(
            """
            INSERT INTO webhook_events (id, type, "eventAt", payload, status, "receivedAt") VALUES
              ('evt_failed_old', 'payment_intent.succeeded', now() - interval '200 days', '{}', 'failed', now() - interval '200 days')
            """);

        Assert.Equal(0, await _store.PurgeOldEventsAsync(DateTimeOffset.UtcNow, 90));
    }
}

/// <summary>Stripe-shaped event JSON for the webhook suites.</summary>
public static class StripeEvents
{
    public static string Json(string id, string type, object data, long created = 1_800_000_000)
        => JsonSerializer.Serialize(new
        {
            id,
            @object = "event",
            api_version = "2025-08-27.basil",
            created,
            data = new { @object = data },
            livemode = false,
            pending_webhooks = 0,
            type,
        });

    public static Stripe.Event Parse(string json)
        => Stripe.EventUtility.ParseEvent(json, throwOnApiVersionMismatch: false);
}
