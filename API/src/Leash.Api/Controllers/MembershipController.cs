using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Leash Plus (REQUIREMENTS.md M13). Every route acts on the caller's own
/// membership — there is no id in any of them. Failures map to a status in
/// one place (<see cref="MembershipError"/>).
/// </summary>
[ApiController]
[Route("api/v1/membership")]
[Authorize]
public sealed class MembershipController(
    IMembershipService membership,
    IRateLimitService rateLimits) : ControllerBase
{
    /// <summary>GET /membership → <c>{ membership, plan }</c>. Read fresh on every call; never a token claim.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
        => Ok(await membership.GetViewAsync(User.RequireUserId(), ct));

    /// <summary>POST /membership/checkout → <c>{ url }</c>. Send the browser there.</summary>
    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout(CancellationToken ct)
    {
        if (await Throttle(RateLimits.Checkout, ct) is { } limited) return limited;

        var (redirect, failure) = await membership.CheckoutAsync(User.RequireUserId(), ct);
        return failure is null ? Ok(redirect) : MembershipError(failure.Value);
    }

    /// <summary>POST /membership/cancel → <c>{ ok, endsAt }</c>. At the end of the period, not now.</summary>
    [HttpPost("cancel")]
    public async Task<IActionResult> Cancel(CancellationToken ct)
    {
        var (cancelled, failure) = await membership.CancelAsync(User.RequireUserId(), ct);
        return failure is null ? Ok(cancelled) : MembershipError(failure.Value);
    }

    /// <summary>POST /membership/resume → <c>{ ok }</c>. Undo a cancellation that has not taken effect.</summary>
    [HttpPost("resume")]
    public async Task<IActionResult> Resume(CancellationToken ct)
    {
        var failure = await membership.ResumeAsync(User.RequireUserId(), ct);
        return failure is null ? Ok(new { ok = true }) : MembershipError(failure.Value);
    }

    /// <summary>POST /membership/portal → <c>{ url }</c>. The provider's billing portal.</summary>
    [HttpPost("portal")]
    public async Task<IActionResult> Portal(CancellationToken ct)
    {
        var (redirect, failure) = await membership.PortalAsync(User.RequireUserId(), ct);
        return failure is null ? Ok(redirect) : MembershipError(failure.Value);
    }

    /// <summary>POST /membership/sync → Membership. For a webhook that is slow or lost.</summary>
    [HttpPost("sync")]
    public async Task<IActionResult> Sync(CancellationToken ct)
    {
        if (await Throttle(RateLimits.ProviderSync, ct) is { } limited) return limited;

        var (current, failure) = await membership.SyncAsync(User.RequireUserId(), ct);
        return failure is null ? Ok(current) : MembershipError(failure.Value);
    }

    private static IActionResult MembershipError(MembershipFailure failure) => failure switch
    {
        // M14: fails closed rather than pretending.
        MembershipFailure.NotAvailable => ApiResults.Unavailable("That isn't available on this site just now."),
        MembershipFailure.AlreadyMember => ApiResults.Conflict("You're already a member"),
        MembershipFailure.NoMembership => ApiResults.Conflict("You don't have an active membership"),
        MembershipFailure.NothingToResume => ApiResults.Conflict("There's no scheduled cancellation to undo"),
        MembershipFailure.NoBillingHistory => ApiResults.Conflict("You don't have any billing history yet"),
        MembershipFailure.ProviderFailed => ApiResults.BadGateway("We couldn't reach our payment provider. Please try again."),
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, null),
    };

    private async Task<IActionResult?> Throttle(RateLimitRule rule, CancellationToken ct)
    {
        var verdict = await rateLimits.ConsumeAsync(rule, $"uid:{User.RequireUserId()}", ct);
        return verdict.Allowed
            ? null
            : ApiResults.TooManyRequests(verdict.Message ?? "Too many requests", verdict.Limit);
    }
}
