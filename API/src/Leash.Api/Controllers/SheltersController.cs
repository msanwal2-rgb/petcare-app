using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Shelter profiles and the shelter directory (M10). Search and the profile
/// page are public, like the vet and caretaker ones, and return only the public
/// projection of the account behind a shelter.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class SheltersController(IShelterService shelters) : ControllerBase
{
    [HttpGet("shelters/search")]
    public async Task<IActionResult> Search(
        [FromQuery] double? lat,
        [FromQuery] double? lng,
        [FromQuery] double? radiusMiles,
        [FromQuery] string? species,
        [FromQuery] string? kind,
        [FromQuery] bool? withAvailable,
        [FromQuery] bool? verifiedOnly,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
        => Ok(await shelters.SearchAsync(new ShelterSearchQuery(
            lat, lng, radiusMiles, species, kind, withAvailable ?? false, verifiedOnly ?? false,
            cursor, limit ?? 24), ct));

    [HttpGet("shelters/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var shelter = await shelters.GetAsync(id, ct);
        return shelter is null ? ApiResults.NotFound($"Shelter {id} not found") : Ok(shelter);
    }

    /// <summary>
    /// Somebody's shelter profile. Public, as <c>/users/{id}/vet-profile</c> is,
    /// and 404 rather than <c>null</c> when there is none — the same answer the
    /// vet route gives.
    /// </summary>
    [HttpGet("users/{id}/shelter-profile")]
    public async Task<IActionResult> GetByUser(string id, CancellationToken ct)
    {
        var profile = await shelters.GetByUserAsync(id, ct);
        return profile is null ? ApiResults.NotFound($"User {id} has no shelter profile") : Ok(profile);
    }

    /// <summary>Create or edit your own. <c>verificationStatus</c> and <c>responseRatePct</c> have no field.</summary>
    [HttpPatch("users/{id}/shelter-profile")]
    [Authorize]
    public async Task<IActionResult> Upsert(string id, [FromBody] ShelterPatchRequest patch, CancellationToken ct)
    {
        var (profile, refusal) = await shelters.UpsertAsync(User.RequireUserId(), id, patch, ct);
        return refusal is null ? Ok(profile) : ApiResults.Forbidden("You can only edit your own shelter profile");
    }
}
