using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// The admin console (REQUIREMENTS.md §10.2).
///
/// <c>[Authorize]</c> here only means "signed in". <b>The staff role is checked
/// by every service method</b> (D1), so this controller decides nothing — a
/// route added later that forgets a check cannot open anything, because there
/// is no check here to forget. A signed-in caller without the role gets 403
/// and a sentence saying which role (D2); route existence is not a secret.
///
/// Every write is throttled per member of staff, and passes the request's IP
/// to the audit row as context — header-derived and spoofable, so recorded and
/// never used to decide anything.
/// </summary>
[ApiController]
[Route("api/v1/admin")]
[Authorize]
public sealed class AdminController(
    IAdminUserService users,
    IAdminProfessionalService professionals,
    IAdminFinanceService finance,
    IAdminConsoleService console,
    IAuditLog audit,
    IAdoptionTransferService adoptions,
    IRateLimitService rateLimits) : ControllerBase
{
    // ── Overview — any staff ─────────────────────────────────────────────

    [HttpGet("stats")]
    public async Task<IActionResult> Stats(CancellationToken ct)
        => Respond(await console.GetStatsAsync(User.RequireUserId(), Ids.Now(), ct));

    // ── Users — support (staff roles and deletion: admin) ────────────────

    [HttpGet("users")]
    public async Task<IActionResult> SearchUsers([FromQuery] AdminUserQuery query, CancellationToken ct)
        => Respond(await users.SearchAsync(User.RequireUserId(), query, ct));

    [HttpGet("users/{id}")]
    public async Task<IActionResult> GetUser(string id, CancellationToken ct)
        => Respond(await users.GetAsync(User.RequireUserId(), id, ct));

    /// <summary>PATCH /admin/users/{id} <c>{ action, … }</c> → User. One action per request.</summary>
    [HttpPatch("users/{id}")]
    public async Task<IActionResult> ActOnUser(string id, [FromBody] AdminUserActionRequest action, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        return Respond(await users.ApplyAsync(Actor(), id, action, ct));
    }

    /// <summary>DELETE /admin/users/{id} → User. Soft: the row survives, the person does not.</summary>
    [HttpDelete("users/{id}")]
    public async Task<IActionResult> DeleteUser(string id, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        return Respond(await users.DeleteAsync(Actor(), id, ct));
    }

    // ── Professionals — support ──────────────────────────────────────────

    [HttpGet("professionals")]
    public async Task<IActionResult> SearchProfessionals([FromQuery] AdminProfessionalQuery query, CancellationToken ct)
        => Respond(await professionals.SearchAsync(User.RequireUserId(), query, ct));

    /// <summary>
    /// PATCH /admin/professionals/{id} <c>{ kind, status, note? }</c>. The id is a
    /// profile id and <c>kind</c> says which table — two things, not polymorphism.
    /// </summary>
    [HttpPatch("professionals/{id}")]
    public async Task<IActionResult> SetVerification(
        string id, [FromBody] AdminVerificationRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        var refusal = await professionals.SetVerificationAsync(Actor(), id, request, ct);
        return refusal is null ? Ok(new { ok = true }) : Refused(refusal);
    }

    // ── Adoptions — support ──────────────────────────────────────────────

    /// <summary>
    /// POST /admin/adoptions/{id}/reverse <c>{ reason }</c> → <c>{ pet }</c>. Puts a
    /// completed adoption back (R8), audited as <c>adoption.reverse</c>. Does not
    /// refund — that is a conversation between a shelter and a person.
    /// </summary>
    [HttpPost("adoptions/{id}/reverse")]
    public async Task<IActionResult> ReverseAdoption(
        string id, [FromBody] ReverseAdoptionRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        return Respond(await adoptions.ReverseAsync(Actor(), id, request.Reason.Trim(), ct));
    }

    // ── Finance — finance ────────────────────────────────────────────────

    [HttpGet("payments")]
    public async Task<IActionResult> SearchPayments([FromQuery] AdminPaymentQuery query, CancellationToken ct)
        => Respond(await finance.SearchPaymentsAsync(User.RequireUserId(), query, ct));

    /// <summary>POST /admin/payments/{id}/refund → <c>{ refundId, amountCents, pending }</c>.</summary>
    [HttpPost("payments/{id}/refund")]
    public async Task<IActionResult> Refund(string id, [FromBody] AdminRefundRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        return Respond(await finance.RefundAsync(Actor(), id, request, ct));
    }

    [HttpGet("subscriptions")]
    public async Task<IActionResult> SearchSubscriptions([FromQuery] AdminSubscriptionQuery query, CancellationToken ct)
        => Respond(await finance.SearchSubscriptionsAsync(User.RequireUserId(), query, ct));

    /// <summary>PATCH /admin/subscriptions/{id} <c>{ action: cancel | resume | extend_grace, … }</c>.</summary>
    [HttpPatch("subscriptions/{id}")]
    public async Task<IActionResult> ActOnSubscription(
        string id, [FromBody] AdminSubscriptionActionRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        var refusal = await finance.ApplySubscriptionActionAsync(Actor(), id, request, ct);
        return refusal is null ? Ok(new { ok = true }) : Refused(refusal);
    }

    // ── Audit and settings — admin ───────────────────────────────────────

    [HttpGet("audit")]
    public async Task<IActionResult> Audit([FromQuery] AdminAuditQuery query, CancellationToken ct)
        => Respond(await audit.ListAsync(User.RequireUserId(), query, ct));

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings(CancellationToken ct)
        => Respond(await console.GetSettingsAsync(User.RequireUserId(), ct));

    [HttpPatch("settings")]
    public async Task<IActionResult> UpdateSettings([FromBody] SettingsPatchRequest patch, CancellationToken ct)
    {
        if (await ThrottleAsync(ct) is { } limited) return limited;
        return Respond(await console.UpdateSettingsAsync(Actor(), patch, ct));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private StaffActor Actor()
    {
        var forwarded = Request.Headers["X-Forwarded-For"].FirstOrDefault();
        var ip = !string.IsNullOrWhiteSpace(forwarded)
            ? forwarded.Split(',')[0].Trim()
            : HttpContext.Connection.RemoteIpAddress?.ToString() ?? "";
        return new StaffActor(User.RequireUserId(), ip.Length > 100 ? ip[..100] : ip);
    }

    private IActionResult Respond<T>((T? Value, AdminRefusal? Refusal) result)
        => result.Refusal is null ? Ok(result.Value) : Refused(result.Refusal);

    private static IActionResult Refused(AdminRefusal refusal) => refusal.Kind switch
    {
        AdminFailure.NotStaff or AdminFailure.SelfEdit => ApiResults.Forbidden(refusal.Message),
        AdminFailure.NotFound => ApiResults.NotFound(refusal.Message),
        AdminFailure.LastAdmin or AdminFailure.Conflict => ApiResults.Conflict(refusal.Message),
        AdminFailure.ProviderFailed => ApiResults.BadGateway(refusal.Message),
        _ => throw new ArgumentOutOfRangeException(nameof(refusal), refusal.Kind, null),
    };

    private async Task<IActionResult?> ThrottleAsync(CancellationToken ct)
    {
        var verdict = await rateLimits.ConsumeAsync(RateLimits.AdminWrite, $"uid:{User.RequireUserId()}", ct);
        return verdict.Allowed
            ? null
            : ApiResults.TooManyRequests(verdict.Message ?? "Too many requests", verdict.Limit);
    }
}
