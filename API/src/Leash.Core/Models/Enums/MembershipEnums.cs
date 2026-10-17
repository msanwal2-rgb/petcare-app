namespace Leash.Core.Models.Enums;

/// <summary>
/// What Leash Plus entitles a member to (REQUIREMENTS.md M11). Each is
/// enforced at the point of use — the quote, the appointment, the lead time —
/// and none is a badge.
/// </summary>
public static class Entitlements
{
    public const string FreeShipping = "free_shipping";
    public const string VetConsultDiscount = "vet_consult_discount";
    public const string PriorityBooking = "priority_booking";

    /// <summary>
    /// How long benefits survive a failed renewal (M12).
    ///
    /// A business decision, stated here so it can be argued with rather than
    /// discovered: Stripe retries a failed charge over about three weeks, and
    /// stripping somebody's free shipping the moment their card expires —
    /// mid-order, while the retry is still pending — punishes them for a bank's
    /// timing.
    /// </summary>
    public const int DunningGraceDays = 7;
}

/// <summary>
/// Stripe's own subscription vocabulary (M10) rather than a parallel one —
/// every value arrives from a webhook, and a translation layer is somewhere
/// for the two to drift.
/// </summary>
public static class SubscriptionStatuses
{
    public const string Incomplete = "incomplete";
    public const string IncompleteExpired = "incomplete_expired";
    public const string Trialing = "trialing";
    public const string Active = "active";
    public const string PastDue = "past_due";
    public const string Unpaid = "unpaid";
    public const string Canceled = "canceled";

    public static readonly string[] All =
        [Incomplete, IncompleteExpired, Trialing, Active, PastDue, Unpaid, Canceled];

    /// <summary>Statuses that can still carry benefits, before the period and grace checks.</summary>
    public static readonly string[] Live = [Trialing, Active, PastDue];

    /// <summary>Anything Stripe sends that is not ours is treated as the nearest safe one.</summary>
    public static string Normalise(string status) => All.Contains(status) ? status : Incomplete;
}

/// <summary>What a <c>payments</c> row is for.</summary>
public static class PaymentKinds
{
    public const string Order = "order";
    public const string SubscriptionInvoice = "subscription_invoice";
    public const string AdoptionFee = "adoption_fee";
}
