using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

[ApiController]
[Route("api/v1")]
public sealed class UsersController(
    IUserService users, IHostEnvironment env) : ControllerBase
{
    /// <summary>An unbounded id list is an invitation to ask for the whole table.</summary>
    private const int MaxIds = 50;

    /// <summary>
    /// The caller's own full record.
    ///
    /// Separate from <see cref="GetUser"/> because this is the one request where
    /// returning an email address and home coordinates is correct.
    /// </summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var user = await users.GetAsync(User.RequireUserId(), ct);

        // The principal validated but the row is gone. Session validation
        // already refuses this, so reaching here means the account was deleted
        // mid-request.
        return user is null ? ApiResults.NotFound("Account not found") : Ok(user);
    }

    [HttpGet("users")]
    [Authorize]
    public async Task<IActionResult> ListUsers([FromQuery] string? ids, CancellationToken ct)
    {
        if (ids is not null)
        {
            var requested = ids
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Take(MaxIds)
                .ToArray();

            return Ok(await users.GetPublicManyAsync(requested, ct));
        }

        // The unfiltered listing exists only for the development account
        // switcher. It returns every account's email address, so it is refused
        // elsewhere rather than left as a directory of the entire user base.
        if (!env.IsDevelopment())
            return ApiResults.Forbidden("Listing all users is only available in development");

        return Ok(await users.ListAsync(ct));
    }

    /// <summary>
    /// Public, and the public projection only: name, avatar, roles, city and
    /// state.
    ///
    /// Ids count upward from u1 in the seed data, so this endpoint is enumerable
    /// by construction — which is exactly why it must not carry anything worth
    /// enumerating for.
    /// </summary>
    [HttpGet("users/{id}")]
    public async Task<IActionResult> GetUser(string id, CancellationToken ct)
    {
        var user = await users.GetPublicAsync(id, ct);
        return user is null ? ApiResults.NotFound($"User {id} not found") : Ok(user);
    }

    [HttpPatch("users/{id}")]
    [Authorize]
    public async Task<IActionResult> UpdateUser(
        string id, UpdateUserRequest patch, CancellationToken ct)
    {
        // Self only. 403 rather than 404 for someone else's id: the caller is a
        // known user being told no, and the account's existence is not the
        // secret — the access is.
        if (User.RequireUserId() != id) return ApiResults.Forbidden();

        var user = await users.UpdateAsync(id, patch, ct);
        return user is null ? ApiResults.NotFound($"User {id} not found") : Ok(user);
    }
}

[ApiController]
[Route("api/v1")]
public sealed class ConfigController(
    ISettingsService settings, IConfiguration config) : ControllerBase
{
    /// <summary>
    /// Public runtime configuration, unauthenticated by design.
    ///
    /// Everything here is something the browser finds out anyway by using the
    /// site. Nothing that gates access is decided from this response — the
    /// server re-checks each of them where it matters.
    /// </summary>
    [HttpGet("config")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var current = await settings.GetAsync(ct);

        return Ok(new PublicConfigDto(
            current.SignupsOpen,
            current.MaintenanceBanner,
            current.DemoLoginVisible,
            AuthSetup.GoogleConfigured(config)));
    }
}
