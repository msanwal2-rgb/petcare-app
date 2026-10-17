namespace Leash.Core.Models.Dtos;

/// <summary>A plan, as <c>web/src/types</c> declares <c>Plan</c>.</summary>
public sealed record PlanDto(
    string Id,
    string Key,
    string Name,
    string Description,
    int PriceCents,
    string Currency,
    string Interval,
    string[] Entitlements,
    int ConsultDiscountPct,
    bool Active,
    /// <summary>False until the installed provider can sell it.</summary>
    bool Purchasable);

/// <summary>
/// "What is this customer entitled to, right now?" — <c>Membership</c> in the
/// web contract. Read from the database on every request that prices
/// something; never a token claim (REQUIREMENTS.md M11).
/// </summary>
public sealed record MembershipDto(
    bool Active,
    string? PlanKey,
    string? PlanName,
    string? Status,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    /// <summary>True while a failed renewal is still being retried (M12).</summary>
    bool InGrace,
    string[] Entitlements,
    int ConsultDiscountPct)
{
    public static readonly MembershipDto None = new(false, null, null, null, null, false, false, [], 0);
}

/// <summary><c>GET /membership</c>: what you have, and what you could have.</summary>
public sealed record MembershipViewDto(MembershipDto Membership, PlanDto? Plan);

/// <summary>Where to send the browser next — the provider's page, or back to ours.</summary>
public sealed record RedirectDto(string Url);

public sealed record MembershipCancelledDto(bool Ok, DateTimeOffset EndsAt);

/// <summary>
/// When a refused booking could have started (REQUIREMENTS.md C13): for this
/// caller, and for a member — so the screen can offer the upgrade rather than
/// only refusing.
/// </summary>
public sealed record LeadTimeWindow(
    bool IsMember, int LeadTimeHours, DateTimeOffset EarliestAt, DateTimeOffset MemberEarliestAt);
