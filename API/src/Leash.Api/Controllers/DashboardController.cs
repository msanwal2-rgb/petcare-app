using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// The dashboards' top cards. Each route is gated exactly like the list it
/// summarises — a clinic's figures and a caretaker's are theirs alone (404 to
/// anyone else, as their schedules are), and an owner's come from the session.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class DashboardController(IDashboardService dashboard) : ControllerBase
{
    [HttpGet("vets/{id}/stats")]
    [Authorize]
    public async Task<IActionResult> VetStats(
        string id, [FromQuery] StatsQuery query, CancellationToken ct)
    {
        var stats = await dashboard.GetVetStatsAsync(User.RequireUserId(), id, query.From, ct);
        return stats is null ? ApiResults.NotFound($"Vet {id} not found") : Ok(stats);
    }

    [HttpGet("caretakers/{id}/stats")]
    [Authorize]
    public async Task<IActionResult> CaretakerStats(
        string id, [FromQuery] StatsQuery query, CancellationToken ct)
    {
        var stats = await dashboard.GetCaretakerStatsAsync(User.RequireUserId(), id, query.From, ct);
        return stats is null ? ApiResults.NotFound($"Caretaker {id} not found") : Ok(stats);
    }

    /// <summary>
    /// The caller's own figures as an owner. No user id in the path, for the
    /// same reason <c>GET /bookings</c> has none.
    /// </summary>
    [HttpGet("me/stats")]
    [Authorize]
    public async Task<IActionResult> MyStats([FromQuery] StatsQuery query, CancellationToken ct)
        => Ok(await dashboard.GetOwnerStatsAsync(User.RequireUserId(), query.From, ct));
}
