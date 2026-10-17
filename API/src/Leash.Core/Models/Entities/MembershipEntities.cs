using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>A <c>plans</c> row. Leash Plus is the one the app sells.</summary>
public class PlanEntity
{
    public string Id { get; set; } = "";
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int PriceCents { get; set; }
    public string Currency { get; set; } = "";
    public string Interval { get; set; } = "";
    public string StripeProductId { get; set; } = "";
    public string StripePriceId { get; set; } = "";
    public string[] Entitlements { get; set; } = [];
    public int ConsultDiscountPct { get; set; }
    public bool Active { get; set; }

    /// <param name="purchasable">
    /// Whether the installed provider can sell it — decided by the provider,
    /// because "has a Stripe price" means nothing to the demo one.
    /// </param>
    public PlanDto ToDto(bool purchasable) => new(
        Id, Key, Name, Description, PriceCents, Currency, Interval,
        Entitlements, ConsultDiscountPct, Active, purchasable);
}

/// <summary>
/// A <c>subscriptions</c> row. Every field is written from provider truth, by
/// <c>SubscriptionReconciler</c> only — the billing authority is the
/// provider, not this table.
/// </summary>
public class SubscriptionEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string PlanId { get; set; } = "";
    public string Provider { get; set; } = "";
    public string ProviderRef { get; set; } = "";
    public string ProviderCustomerId { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTimeOffset CurrentPeriodStart { get; set; }
    public DateTimeOffset CurrentPeriodEnd { get; set; }
    public bool CancelAtPeriodEnd { get; set; }
    public DateTimeOffset? CanceledAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
    public DateTimeOffset? GraceEndsAt { get; set; }
    public string LatestInvoiceRef { get; set; } = "";
    public DateTimeOffset? LastEventAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>A subscription with its plan, as the entitlement read needs it.</summary>
public sealed class SubscriptionWithPlanEntity : SubscriptionEntity
{
    public string PlanKey { get; set; } = "";
    public string PlanName { get; set; } = "";
    public string[] PlanEntitlements { get; set; } = [];
    public int PlanConsultDiscountPct { get; set; }
}

/// <summary>
/// A <c>refunds</c> row. Written <c>pending</c> before the provider is called;
/// <c>settledAt</c> is set exactly once, when the amount is folded into the
/// payment — which is also how a second settle knows not to count it again.
/// </summary>
public class RefundEntity
{
    public string Id { get; set; } = "";
    public string PaymentId { get; set; } = "";
    public string? ProviderRef { get; set; }
    public int AmountCents { get; set; }
    public string Status { get; set; } = "";
    public string Reason { get; set; } = "";
    public string InitiatedBy { get; set; } = "";
    public string Note { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? SettledAt { get; set; }
}

/// <summary>A <c>webhook_events</c> row, without its payload.</summary>
public class WebhookEventEntity
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";
    public int Attempts { get; set; }
    public DateTimeOffset? LockedAt { get; set; }
}
