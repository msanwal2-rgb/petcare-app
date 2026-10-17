using Leash.Api.Auth;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// The bell. Your own notifications only — there is no id in either route, so
/// there is nobody else's to ask for. Nothing here writes a notification; only
/// the status machines do, through <see cref="INotifier"/>, which this
/// controller is deliberately not given.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class NotificationsController(INotificationService notifications) : ControllerBase
{
    /// <summary>GET /notifications → <c>{ items, unread, nextCursor }</c>, newest first.</summary>
    [HttpGet("notifications")]
    public async Task<IActionResult> List(
        [FromQuery] string? cursor, [FromQuery] int? limit, CancellationToken ct)
        => Ok(await notifications.ListMineAsync(User.RequireUserId(), cursor, limit ?? 30, ct));

    /// <summary>
    /// POST /notifications <c>{ ids }</c> → <c>{ unread }</c>. Marks exactly the
    /// ids given, of those that are yours (N7); an id you don't own matches
    /// nothing.
    /// </summary>
    [HttpPost("notifications")]
    public async Task<IActionResult> MarkRead(
        [FromBody] MarkNotificationsReadRequest input, CancellationToken ct)
        => Ok(await notifications.MarkReadAsync(User.RequireUserId(), input.Ids, ct));
}
