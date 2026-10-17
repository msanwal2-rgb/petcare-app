using Leash.Core.Persistence;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Http;

/// <summary>
/// The 409 for a request that starts too soon (REQUIREMENTS.md C13), carrying
/// when this caller could have asked and when a member could — so the screen
/// can offer the upgrade rather than only refusing. The reference's shape:
/// <c>earliestAt</c>, <c>memberEarliestAt</c>, <c>isMember</c>, plus the hours.
/// </summary>
public static class LeadTimeRefusal
{
    public static async Task<IActionResult> For(
        IEntitlementService entitlements, string callerId, string what, CancellationToken ct)
    {
        var window = await entitlements.LeadTimeWindowAsync(callerId, Ids.Now(), ct);

        return ApiResults.Conflict(
            $"{what} need at least {window.LeadTimeHours} hours' notice.",
            new
            {
                leadTimeHours = window.LeadTimeHours,
                earliestAt = window.EarliestAt,
                memberEarliestAt = window.MemberEarliestAt,
                isMember = window.IsMember,
            });
    }
}
