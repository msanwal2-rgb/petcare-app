using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;

namespace Leash.Core.Payments;

/// <summary>A subscription as the provider reports it.</summary>
/// <param name="PlanId">Set by a provider that knows our plan directly (the demo); Stripe identifies it by price.</param>
public sealed record ProviderSubscription(
    string Ref,
    string Status,
    DateTimeOffset CurrentPeriodStart,
    DateTimeOffset CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    string CustomerRef,
    string PriceId,
    string? PlanId = null);

/// <summary>A paid invoice, as a synchronous provider reports it at checkout.</summary>
public sealed record ProviderInvoice(string Ref, int AmountCents, string Currency);

public sealed record SubscriptionCheckoutRequest(
    string? CustomerRef, PlanEntity Plan, string UserId, string SuccessUrl, string CancelUrl);

/// <summary>
/// Where to send the browser, and — for a provider that settles inline — what
/// it settled. Stripe returns only the URL; the webhook brings the rest.
/// </summary>
public sealed record SubscriptionCheckout(string Url, ProviderSubscription? Settled, ProviderInvoice? Invoice);

/// <summary>
/// Recurring billing — a separate interface from <see cref="IPaymentProvider"/>.
///
/// One fat interface would force a provider to stub methods it cannot honestly
/// implement. So a capability a provider lacks is a null answer the caller
/// turns into a 503, never a plausible-looking stand-in: the demo has no
/// customers and no billing portal, and says so.
/// </summary>
public interface ISubscriptionProvider
{
    string Name { get; }

    /// <summary>False for the demo, which settles a checkout inline.</summary>
    bool Asynchronous { get; }

    /// <summary>Whether this provider can sell the plan at all (M14).</summary>
    bool CanSell(PlanEntity plan);

    /// <summary>Whether there is a billing portal to send a member to.</summary>
    bool HasBillingPortal { get; }

    /// <summary>
    /// The person's customer at the provider, created if needed. Null when the
    /// provider has no notion of customers.
    /// </summary>
    Task<string?> EnsureCustomerAsync(string userId, string email, string name, CancellationToken ct = default);

    Task<SubscriptionCheckout> StartCheckoutAsync(SubscriptionCheckoutRequest request, CancellationToken ct = default);

    Task SetCancelAtPeriodEndAsync(string reference, bool value, CancellationToken ct = default);

    /// <summary>Null when the provider keeps no state to ask (the demo — ours is the record).</summary>
    Task<ProviderSubscription?> GetSubscriptionAsync(string reference, CancellationToken ct = default);

    /// <summary>Null when the provider has no billing portal.</summary>
    Task<string?> PortalUrlAsync(string customerRef, string returnUrl, CancellationToken ct = default);
}

/// <summary>
/// Leash Plus without a card. Selling it is what makes membership walkable on
/// a machine with no Stripe keys — the reference could not, and answered 503 —
/// and it settles through <c>ISubscriptionReconciler</c>, the same path the
/// <c>customer.subscription.created</c> and <c>invoice.paid</c> webhooks take
/// (REQUIREMENTS.md M3). No money moves, exactly as with the demo store
/// provider. A month from now, cancellable, renewing nowhere: there is no
/// billing loop behind it, and the period simply runs out.
/// </summary>
public sealed class DemoSubscriptionProvider : ISubscriptionProvider
{
    public string Name => "demo";

    public bool Asynchronous => false;

    public bool CanSell(PlanEntity plan) => plan.Active;

    public bool HasBillingPortal => false;

    public Task<string?> EnsureCustomerAsync(string userId, string email, string name, CancellationToken ct = default)
        => Task.FromResult<string?>(null);

    public Task<SubscriptionCheckout> StartCheckoutAsync(SubscriptionCheckoutRequest request, CancellationToken ct = default)
    {
        var now = Ids.Now();
        var reference = Ids.New("demo_sub");

        return Task.FromResult(new SubscriptionCheckout(
            request.SuccessUrl,
            new ProviderSubscription(
                reference, SubscriptionStatuses.Active, now, now.AddMonths(1),
                CancelAtPeriodEnd: false, CustomerRef: "", PriceId: "", PlanId: request.Plan.Id),
            new ProviderInvoice(Ids.New("demo_in"), request.Plan.PriceCents, request.Plan.Currency)));
    }

    /// <summary>Nothing to tell: the subscription row is the only record there is.</summary>
    public Task SetCancelAtPeriodEndAsync(string reference, bool value, CancellationToken ct = default)
        => Task.CompletedTask;

    public Task<ProviderSubscription?> GetSubscriptionAsync(string reference, CancellationToken ct = default)
        => Task.FromResult<ProviderSubscription?>(null);

    public Task<string?> PortalUrlAsync(string customerRef, string returnUrl, CancellationToken ct = default)
        => Task.FromResult<string?>(null);
}
