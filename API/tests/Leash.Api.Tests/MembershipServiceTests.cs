using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Leash Plus as a member drives it (REQUIREMENTS.md M13–M15) — the
/// reference's <c>app/api/membership/*</c> routes, which it had no suite for.
///
/// ── The deliberate departure ──
///
/// The reference had no demo subscription provider: without Stripe,
/// membership checkout was always a 503, so nothing about Leash Plus could be
/// seen working on a machine with no keys. Here the demo provider sells it, and
/// it settles <b>through the same reconciler the webhook uses</b> (M3) — a
/// snapshot applied by <see cref="ISubscriptionReconciler"/> and an invoice
/// recorded in the ledger, exactly the two things <c>customer.subscription.created</c>
/// and <c>invoice.paid</c> do. M14's 503 is kept where it means something:
/// Stripe selected but the plan has no price in it.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class MembershipServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Maya = "u1";       // not a member
    private const string Member = "u5";     // active

    private CoreHost _core = null!;
    private IMembershipService _membership = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _membership = _core.Get<IMembershipService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

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

    private async Task<string[]> KindsAsync(string userId)
        => [.. (await _core.Get<INotificationService>().ListMineAsync(userId, null)).Items.Select(n => n.Kind)];

    // ── Reading ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Shows_a_non_member_the_plan_they_could_buy()
    {
        var view = await _membership.GetViewAsync(Maya);

        Assert.False(view.Membership.Active);
        Assert.Equal("leash_plus", view.Plan!.Key);
        Assert.Equal(999, view.Plan.PriceCents);
        Assert.True(view.Plan.Purchasable);
    }

    [Fact]
    public async Task Shows_a_member_their_membership()
    {
        var view = await _membership.GetViewAsync(Member);

        Assert.True(view.Membership.Active);
        Assert.Equal("Leash Plus", view.Membership.PlanName);
    }

    // ── Checkout on the demo provider ────────────────────────────────────

    [Fact]
    public async Task Buying_on_the_demo_provider_makes_you_a_member_at_once()
    {
        var (started, failure) = await _membership.CheckoutAsync(Maya);

        Assert.Null(failure);
        Assert.Equal($"{CoreHost.TestOrigin}/account/membership?checkout=success", started!.Url);

        var view = await _membership.GetViewAsync(Maya);
        Assert.True(view.Membership.Active);
        Assert.Equal("active", view.Membership.Status);
        Assert.Contains(Entitlements.VetConsultDiscount, view.Membership.Entitlements);
    }

    [Fact]
    public async Task The_demo_checkout_records_the_first_invoice_in_the_ledger()
    {
        await _membership.CheckoutAsync(Maya);

        var (kind, status, amount, provider) = await One<(string, string, int, string)>(
            "SELECT kind, status, \"amountCents\", provider FROM payments WHERE \"userId\" = 'u1' AND kind = 'subscription_invoice'");
        Assert.Equal(("subscription_invoice", "paid", 999, "demo"), (kind, status, amount, provider));
    }

    [Fact]
    public async Task The_demo_checkout_announces_the_membership_like_the_webhook_does()
    {
        await _membership.CheckoutAsync(Maya);

        Assert.Equal([NotificationKinds.MembershipStarted], await KindsAsync(Maya));
    }

    [Fact]
    public async Task A_member_cannot_buy_it_twice()
    {
        var (_, failure) = await _membership.CheckoutAsync(Member);

        Assert.Equal(MembershipFailure.AlreadyMember, failure);
        Assert.Equal(1, await One<int>("SELECT count(*)::int FROM subscriptions WHERE \"userId\" = 'u5'"));
    }

    [Fact]
    public async Task Somebody_whose_membership_ended_can_rejoin()
    {
        var (_, failure) = await _membership.CheckoutAsync("u8");

        Assert.Null(failure);
        Assert.True((await _membership.GetViewAsync("u8")).Membership.Active);
    }

    [Fact]
    public async Task An_inactive_plan_cannot_be_bought()
    {
        await Exec("UPDATE plans SET active = false WHERE key = 'leash_plus'");

        var (_, failure) = await _membership.CheckoutAsync(Maya);

        Assert.Equal(MembershipFailure.NotAvailable, failure);
    }

    // ── Cancel and resume ────────────────────────────────────────────────

    [Fact]
    public async Task Cancelling_keeps_the_benefits_to_the_end_of_the_period()
    {
        var (cancelled, failure) = await _membership.CancelAsync(Member);

        Assert.Null(failure);
        var view = await _membership.GetViewAsync(Member);
        Assert.True(view.Membership.Active);
        Assert.True(view.Membership.CancelAtPeriodEnd);
        Assert.Equal(view.Membership.CurrentPeriodEnd, cancelled!.EndsAt);
        Assert.Equal([NotificationKinds.MembershipCancelled], await KindsAsync(Member));
    }

    [Fact]
    public async Task Resuming_undoes_a_scheduled_cancellation()
    {
        await _membership.CancelAsync(Member);

        Assert.Null(await _membership.ResumeAsync(Member));
        Assert.False((await _membership.GetViewAsync(Member)).Membership.CancelAtPeriodEnd);
    }

    [Fact]
    public async Task There_is_nothing_to_cancel_without_a_membership()
        => Assert.Equal(MembershipFailure.NoMembership, (await _membership.CancelAsync(Maya)).Failure);

    [Fact]
    public async Task There_is_nothing_to_resume_without_a_scheduled_cancellation()
        => Assert.Equal(MembershipFailure.NothingToResume, await _membership.ResumeAsync(Member));

    [Fact]
    public async Task The_demo_provider_has_no_billing_portal()
    {
        // Not pretended: the portal is the provider's, and the demo has none.
        Assert.Equal(MembershipFailure.NotAvailable, (await _membership.PortalAsync(Member)).Failure);
    }

    [Fact]
    public async Task Syncing_on_the_demo_provider_answers_with_the_membership()
    {
        var (membership, failure) = await _membership.SyncAsync(Member);

        Assert.Null(failure);
        Assert.True(membership!.Active);
    }

    // ── Stripe-shaped behaviour, with a fake provider ────────────────────

    private (CoreHost Core, FakeSubscriptions Fake) WithStripe()
    {
        var fake = new FakeSubscriptions();
        var core = new CoreHost(db.ConnectionString,
            services => services.AddSingleton<ISubscriptionProvider>(fake));
        return (core, fake);
    }

    [Fact]
    public async Task On_stripe_without_a_price_the_plan_is_not_for_sale()
    {
        // M14: fails closed rather than signing somebody up to nothing.
        var (core, _) = WithStripe();
        await using var _ = core;

        Assert.False((await core.Get<IMembershipService>().GetViewAsync(Maya)).Plan!.Purchasable);
        Assert.Equal(MembershipFailure.NotAvailable,
            (await core.Get<IMembershipService>().CheckoutAsync(Maya)).Failure);
    }

    [Fact]
    public async Task On_stripe_checkout_hands_over_to_the_provider_and_waits_for_the_webhook()
    {
        await Exec("UPDATE plans SET \"stripePriceId\" = 'price_live' WHERE key = 'leash_plus'");
        var (core, fake) = WithStripe();
        await using var _ = core;

        var (started, failure) = await core.Get<IMembershipService>().CheckoutAsync(Maya);

        Assert.Null(failure);
        Assert.StartsWith("https://checkout.stripe.test/", started!.Url);
        Assert.Contains($"{CoreHost.TestOrigin}/account/membership?checkout=success", fake.SuccessUrls);

        // The redirect is not the truth; nothing is a member until the webhook.
        Assert.False((await core.Get<IMembershipService>().GetViewAsync(Maya)).Membership.Active);
    }

    [Fact]
    public async Task A_returning_customer_is_not_billed_as_a_stranger()
    {
        // M15: one provider customer per person, stored and reused.
        await Exec("UPDATE plans SET \"stripePriceId\" = 'price_live' WHERE key = 'leash_plus'");
        var (core, fake) = WithStripe();
        await using var _ = core;

        await core.Get<IMembershipService>().CheckoutAsync(Maya);
        await core.Get<IMembershipService>().CheckoutAsync(Maya);

        Assert.Equal(1, fake.CustomersCreated);
        Assert.Equal("cus_fake_u1", await One<string>("SELECT \"stripeCustomerId\" FROM users WHERE id = 'u1'"));
    }

    [Fact]
    public async Task On_stripe_the_portal_needs_billing_history()
    {
        var (core, _) = WithStripe();
        await using var _ = core;

        Assert.Equal(MembershipFailure.NoBillingHistory,
            (await core.Get<IMembershipService>().PortalAsync(Maya)).Failure);

        await Exec("UPDATE users SET \"stripeCustomerId\" = 'cus_known' WHERE id = 'u1'");
        var (url, failure) = await core.Get<IMembershipService>().PortalAsync(Maya);
        Assert.Null(failure);
        Assert.Equal("https://billing.stripe.test/cus_known", url!.Url);
    }

    [Fact]
    public async Task On_stripe_cancelling_tells_the_provider()
    {
        var (core, fake) = WithStripe();
        await using var _ = core;

        await core.Get<IMembershipService>().CancelAsync(Member);

        Assert.Equal(["demo_sub_active:True"], fake.CancelCalls);
    }

    [Fact]
    public async Task A_provider_that_will_not_cancel_leaves_the_membership_untouched()
    {
        var (core, fake) = WithStripe();
        await using var _ = core;
        fake.Fail = true;

        var (_, failure) = await core.Get<IMembershipService>().CancelAsync(Member);

        Assert.Equal(MembershipFailure.ProviderFailed, failure);
        Assert.False((await core.Get<IMembershipService>().GetViewAsync(Member)).Membership.CancelAtPeriodEnd);
    }

    // ── Configuration fails closed (M2) ──────────────────────────────────

    [Fact]
    public void Stripe_without_a_secret_key_refuses_to_start()
    {
        var e = Assert.Throws<InvalidOperationException>(() =>
            new CoreHost(db.ConnectionString, settings: new Dictionary<string, string?>
            {
                ["Payments:Provider"] = "stripe",
            }));

        Assert.Contains("Payments:Stripe:SecretKey", e.Message);
    }

    [Fact]
    public void An_unknown_provider_refuses_to_start()
        => Assert.Throws<InvalidOperationException>(() =>
            new CoreHost(db.ConnectionString, settings: new Dictionary<string, string?>
            {
                ["Payments:Provider"] = "paypal",
            }));

    [Fact]
    public async Task Stripe_with_a_key_selects_the_stripe_providers()
    {
        await using var core = new CoreHost(db.ConnectionString, settings: new Dictionary<string, string?>
        {
            ["Payments:Provider"] = "stripe",
            ["Payments:Stripe:SecretKey"] = "sk_test_not_a_real_key",
        });

        Assert.Equal("stripe", core.Get<IPaymentProvider>().Name);
        Assert.True(core.Get<IPaymentProvider>().Asynchronous);
        Assert.Equal("stripe", core.Get<ISubscriptionProvider>().Name);
    }
}

/// <summary>A Stripe-like subscription provider that records what it was asked.</summary>
public sealed class FakeSubscriptions : ISubscriptionProvider
{
    public int CustomersCreated { get; private set; }
    public List<string> SuccessUrls { get; } = [];
    public List<string> CancelCalls { get; } = [];
    public bool Fail { get; set; }

    public string Name => "stripe";
    public bool Asynchronous => true;

    public bool CanSell(PlanEntity plan) => plan.Active && plan.StripePriceId != "";

    public bool HasBillingPortal => true;

    public Task<string?> EnsureCustomerAsync(string userId, string email, string name, CancellationToken ct = default)
    {
        CustomersCreated++;
        return Task.FromResult<string?>($"cus_fake_{userId}");
    }

    public Task<SubscriptionCheckout> StartCheckoutAsync(SubscriptionCheckoutRequest request, CancellationToken ct = default)
    {
        SuccessUrls.Add(request.SuccessUrl);
        return Task.FromResult(new SubscriptionCheckout($"https://checkout.stripe.test/{request.UserId}", null, null));
    }

    public Task SetCancelAtPeriodEndAsync(string reference, bool value, CancellationToken ct = default)
    {
        if (Fail) throw new PaymentProviderException("Stripe is down", definitive: false);
        CancelCalls.Add($"{reference}:{value}");
        return Task.CompletedTask;
    }

    public Task<ProviderSubscription?> GetSubscriptionAsync(string reference, CancellationToken ct = default)
        => Task.FromResult<ProviderSubscription?>(null);

    public Task<string?> PortalUrlAsync(string customerRef, string returnUrl, CancellationToken ct = default)
        => Task.FromResult<string?>($"https://billing.stripe.test/{customerRef}");
}
