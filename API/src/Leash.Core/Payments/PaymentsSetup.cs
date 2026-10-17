using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Leash.Core.Payments;

/// <summary>
/// Which payment provider this deployment runs (REQUIREMENTS.md M1), chosen
/// once at startup and <b>failing closed</b> (M2).
///
/// <c>Payments:Provider</c> is <c>demo</c> (the default) or <c>stripe</c>.
/// <c>stripe</c> without <c>Payments:Stripe:SecretKey</c> throws here rather
/// than quietly falling back to the demo — the failure mode of that fallback is
/// taking pretend money for real orders and telling customers they are paid.
/// An unknown value throws for the same reason: a typo must not choose for us.
///
/// The webhook's signing secret (<c>Payments:Stripe:WebhookSecret</c>) is read
/// by the webhook intake, which refuses every request while it is unset (M6).
/// The browser's publishable key is the SPA's own setting
/// (<c>web/public/config.js</c>), not the API's.
/// </summary>
public static class PaymentsSetup
{
    public const string Demo = "demo";
    public const string Stripe = "stripe";

    public static IServiceCollection AddLeashPayments(this IServiceCollection services, IConfiguration config)
    {
        var mode = (config["Payments:Provider"] ?? Demo).Trim().ToLowerInvariant();

        switch (mode)
        {
            case Demo:
                services.AddSingleton<IPaymentProvider, DemoPaymentProvider>();
                services.AddSingleton<ISubscriptionProvider, DemoSubscriptionProvider>();
                break;

            case Stripe:
                var key = config["Payments:Stripe:SecretKey"];
                if (string.IsNullOrWhiteSpace(key))
                {
                    throw new InvalidOperationException(
                        "Payments:Provider is \"stripe\" but Payments:Stripe:SecretKey is not set. " +
                        "Set the key, or run with Payments:Provider=demo — the app will not start " +
                        "taking payments it cannot actually take.");
                }

                // One client for the process: it pools its HTTP connections.
                // The API version is the library's own pin, so an account's
                // dashboard default moving cannot reshape what we receive.
                services.AddSingleton<global::Stripe.IStripeClient>(new global::Stripe.StripeClient(key));
                services.AddSingleton<IPaymentProvider, StripePaymentProvider>();
                services.AddSingleton<ISubscriptionProvider, StripeSubscriptionProvider>();
                break;

            default:
                throw new InvalidOperationException(
                    $"Unknown Payments:Provider \"{mode}\". Use \"{Demo}\" or \"{Stripe}\".");
        }

        return services;
    }
}
