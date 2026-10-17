using System.Net;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Stripe;
using SubscriptionStatuses = Leash.Core.Models.Enums.SubscriptionStatuses;

namespace Leash.Core.Payments;

/// <summary>
/// Stripe, behind the app's own payment interface.
///
/// Nothing here persists anything. Every state change lands in the ledger
/// through <c>PaymentLedger.ApplyIntentStateAsync</c>, whether it arrived from
/// a webhook, from the order page's sync, or from a staff refund.
///
/// Every SDK failure leaves as a <see cref="PaymentProviderException"/>:
/// <i>definitive</i> for a 4xx Stripe refused (other than 429), transient for
/// anything else — so a refund that timed out is retried rather than recorded
/// as failed.
/// </summary>
public sealed class StripePaymentProvider(IStripeClient client) : IPaymentProvider
{
    public string Name => "stripe";

    public bool Asynchronous => true;

    public Task<PaymentIntent> CreateIntentAsync(IntentRequest request, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            var intent = await new PaymentIntentService(client).CreateAsync(
                new PaymentIntentCreateOptions
                {
                    Amount = request.AmountCents,
                    Currency = request.Currency,
                    AutomaticPaymentMethods = new PaymentIntentAutomaticPaymentMethodsOptions { Enabled = true },
                    Customer = request.CustomerRef,
                    // The webhook resolves an event back to an order through
                    // this. Not decoration — it is the join key.
                    Metadata = new Dictionary<string, string>
                    {
                        ["orderId"] = request.OrderId,
                        ["userId"] = request.UserId,
                    },
                },
                // Keyed on the order: a retried checkout reuses the intent
                // rather than minting a second charge for one basket.
                new RequestOptions { IdempotencyKey = $"order_{request.IdempotencyKey}" },
                ct);
            return ToIntent(intent);
        });

    public Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default)
        => StripeCalls.Wrap(async () => ToIntent(await new PaymentIntentService(client).GetAsync(
            reference, new PaymentIntentGetOptions { Expand = ["latest_charge"] }, cancellationToken: ct)));

    public Task<PaymentIntent> CancelIntentAsync(string reference, CancellationToken ct = default)
        => StripeCalls.Wrap(async () => ToIntent(
            await new PaymentIntentService(client).CancelAsync(reference, cancellationToken: ct)));

    public Task<ProviderRefund> RefundAsync(
        string reference, int amountCents, string? reason, string idempotencyKey,
        CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            // Stripe accepts a narrower vocabulary than ours; anything outside
            // it goes without a reason, and our own row keeps the full one.
            var stripeReason = reason is RefundReasons.Duplicate or RefundReasons.Fraudulent
                or RefundReasons.RequestedByCustomer ? reason : null;

            var refund = await new RefundService(client).CreateAsync(
                new RefundCreateOptions { PaymentIntent = reference, Amount = amountCents, Reason = stripeReason },
                new RequestOptions { IdempotencyKey = $"refund_{idempotencyKey}" },
                ct);

            return new ProviderRefund(refund.Id, refund.Status switch
            {
                "succeeded" => RefundStatuses.Succeeded,
                "failed" => RefundStatuses.Failed,
                "canceled" => RefundStatuses.Canceled,
                // Anything not settled yet; charge.refunded finishes it.
                _ => RefundStatuses.Pending,
            }, (int)refund.Amount);
        });

    /// <summary>Stripe's intent statuses onto ours. Shared with the webhook handler.</summary>
    public static string IntentStatus(string? stripeStatus) => stripeStatus switch
    {
        "requires_payment_method" => IntentStatuses.RequiresPaymentMethod,
        "requires_action" or "requires_confirmation" => IntentStatuses.RequiresAction,
        "processing" => IntentStatuses.Processing,
        // Manual capture only — unused, kept mapped so it is a config change.
        "requires_capture" => IntentStatuses.Authorized,
        "succeeded" => IntentStatuses.Succeeded,
        "canceled" => IntentStatuses.Canceled,
        _ => IntentStatuses.Failed,
    };

    public static PaymentIntent ToIntent(Stripe.PaymentIntent pi, string? statusOverride = null)
    {
        var card = pi.LatestCharge?.PaymentMethodDetails?.Card;
        return new PaymentIntent(
            pi.Id,
            statusOverride ?? IntentStatus(pi.Status),
            (int)pi.Amount,
            pi.Currency ?? "usd",
            // Only ever returned to the browser about to confirm this payment.
            pi.ClientSecret,
            pi.LastPaymentError?.Code,
            pi.LastPaymentError?.Message,
            card?.Brand,
            card?.Last4);
    }
}

/// <summary>
/// Leash Plus through Stripe Checkout and the Billing Portal. Card details,
/// SCA, receipts and card updates all stay on Stripe's pages — every one of
/// those screens is somewhere for card data to end up, and not handling it is
/// safer than any version of handling it.
/// </summary>
public sealed class StripeSubscriptionProvider(IStripeClient client) : ISubscriptionProvider
{
    public string Name => "stripe";

    public bool Asynchronous => true;

    /// <summary>A plan with no price in Stripe cannot be bought (M14).</summary>
    public bool CanSell(PlanEntity plan) => plan.Active && plan.StripePriceId.Length > 0;

    public bool HasBillingPortal => true;

    public Task<string?> EnsureCustomerAsync(string userId, string email, string name, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            var customer = await new CustomerService(client).CreateAsync(
                new CustomerCreateOptions
                {
                    Email = email,
                    Name = name,
                    Metadata = new Dictionary<string, string> { ["userId"] = userId },
                },
                // Keyed on the user: a double-clicked button cannot make two
                // customers for one person.
                new RequestOptions { IdempotencyKey = $"customer_{userId}" },
                ct);
            return (string?)customer.Id;
        });

    public Task<SubscriptionCheckout> StartCheckoutAsync(SubscriptionCheckoutRequest request, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            var session = await new Stripe.Checkout.SessionService(client).CreateAsync(
                new Stripe.Checkout.SessionCreateOptions
                {
                    Mode = "subscription",
                    Customer = request.CustomerRef,
                    LineItems = [new Stripe.Checkout.SessionLineItemOptions { Price = request.Plan.StripePriceId, Quantity = 1 }],
                    // How the webhook knows whose subscription this is.
                    ClientReferenceId = request.UserId,
                    SubscriptionData = new Stripe.Checkout.SessionSubscriptionDataOptions
                    {
                        Metadata = new Dictionary<string, string> { ["userId"] = request.UserId },
                    },
                    SuccessUrl = request.SuccessUrl,
                    CancelUrl = request.CancelUrl,
                    AllowPromotionCodes = true,
                },
                cancellationToken: ct);

            return new SubscriptionCheckout(
                session.Url ?? throw new PaymentProviderException("Stripe returned a session with no URL", true),
                null, null);
        });

    public Task SetCancelAtPeriodEndAsync(string reference, bool value, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            await new SubscriptionService(client).UpdateAsync(
                reference, new SubscriptionUpdateOptions { CancelAtPeriodEnd = value }, cancellationToken: ct);
            return true;
        });

    public Task<ProviderSubscription?> GetSubscriptionAsync(string reference, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            var sub = await new SubscriptionService(client).GetAsync(reference, cancellationToken: ct);
            return (ProviderSubscription?)ToSubscription(sub);
        });

    public Task<string?> PortalUrlAsync(string customerRef, string returnUrl, CancellationToken ct = default)
        => StripeCalls.Wrap(async () =>
        {
            var session = await new Stripe.BillingPortal.SessionService(client).CreateAsync(
                new Stripe.BillingPortal.SessionCreateOptions { Customer = customerRef, ReturnUrl = returnUrl },
                cancellationToken: ct);
            return (string?)session.Url;
        });

    /// <summary>Since API version 2025-03-31 the period lives on the item, not the subscription.</summary>
    public static ProviderSubscription ToSubscription(Subscription sub)
    {
        var item = sub.Items?.Data?.FirstOrDefault();
        return new ProviderSubscription(
            sub.Id,
            SubscriptionStatuses.Normalise(sub.Status ?? ""),
            StripeCalls.Utc(item?.CurrentPeriodStart),
            StripeCalls.Utc(item?.CurrentPeriodEnd),
            sub.CancelAtPeriodEnd,
            sub.CustomerId ?? "",
            item?.Price?.Id ?? "");
    }
}

internal static class StripeCalls
{
    public static async Task<T> Wrap<T>(Func<Task<T>> call)
    {
        try
        {
            return await call();
        }
        catch (StripeException e)
        {
            var status = (int)e.HttpStatusCode;
            var definitive = status is >= 400 and < 500 && e.HttpStatusCode != HttpStatusCode.TooManyRequests;
            throw new PaymentProviderException(e.StripeError?.Message ?? e.Message, definitive, e);
        }
        catch (HttpRequestException e)
        {
            throw new PaymentProviderException(e.Message, definitive: false, e);
        }
    }

    public static async Task Wrap(Func<Task> call) => await Wrap(async () => { await call(); return true; });

    public static DateTimeOffset Utc(DateTime? value)
        => value is { } v ? new DateTimeOffset(DateTime.SpecifyKind(v, DateTimeKind.Utc)) : DateTimeOffset.UnixEpoch;
}
