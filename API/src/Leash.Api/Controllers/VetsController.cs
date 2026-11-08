using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Vet profiles and search.
///
/// Search and the profile page are <b>public</b>, as the caretaker equivalents
/// are: an owner looking for a vet at eleven at night should not have to sign up
/// first, and both routes return only the public projection of the person.
/// Everything that reads or writes a particular account's data is
/// <c>[Authorize]</c>d individually — there is no fallback policy, so a new
/// action is public until it says otherwise.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class VetsController(
    IVetService vets,
    IAppointmentService appointments) : ControllerBase
{
    /// <summary>
    /// Search, executed in PostgreSQL and returned one page at a time
    /// (REQUIREMENTS.md V3).
    ///
    /// <c>cursor</c> is opaque — it comes back in <c>nextCursor</c> and goes out
    /// unchanged. A client that takes it apart is coupled to a sort order that
    /// changes with the filter: nearest-first when a location is given, best
    /// rated otherwise.
    /// </summary>
    [HttpGet("vets/search")]
    public async Task<IActionResult> Search(
        [FromQuery] double? lat,
        [FromQuery] double? lng,
        [FromQuery] double? radiusMiles,
        [FromQuery] string? specialty,
        [FromQuery] string? species,
        [FromQuery] string? mode,
        [FromQuery] bool? emergencyOnly,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        var page = await vets.SearchAsync(
            new VetSearchQuery(
                lat, lng, radiusMiles, specialty, species, mode,
                emergencyOnly ?? false, cursor, limit ?? 24),
            ct);

        return Ok(page);
    }

    [HttpGet("vets/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var vet = await vets.GetAsync(id, ct);
        return vet is null ? ApiResults.NotFound($"Vet {id} not found") : Ok(vet);
    }

    /// <summary>
    /// A clinic's schedule. Theirs alone — anyone else reading it would learn
    /// which animals are being taken where and when, which is a list of empty
    /// houses as much as it is a diary.
    /// </summary>
    [HttpGet("vets/{id}/appointments")]
    [Authorize]
    public async Task<IActionResult> ListAppointments(
        string id, [FromQuery] AppointmentListQuery query, CancellationToken ct)
    {
        var page = query.ToWindow() is { } window
            ? await appointments.ListVetScheduleAsync(
                User.RequireUserId(), id, window, query.Cursor, query.Limit ?? 24, ct)
            : await appointments.ListForVetAsync(
                User.RequireUserId(), id, query.Cursor, query.Limit ?? 24, ct);

        return page is null ? ApiResults.NotFound($"Vet {id} not found") : Ok(page);
    }

    /// <summary>
    /// Somebody's vet profile. Public, because it is the same data
    /// <c>/vets/{id}</c> serves — this route exists so a client holding a user
    /// id does not have to search for the profile id.
    /// </summary>
    [HttpGet("users/{id}/vet-profile")]
    public async Task<IActionResult> GetByUser(string id, CancellationToken ct)
    {
        var profile = await vets.GetByUserAsync(id, ct);
        return profile is null
            ? ApiResults.NotFound($"User {id} has no vet profile")
            : Ok(profile);
    }

    /// <summary>
    /// Create or edit your own profile. One verb, because there is exactly one
    /// profile per user and a client should not have to know whether it exists.
    /// </summary>
    [HttpPatch("users/{id}/vet-profile")]
    [Authorize]
    public async Task<IActionResult> UpsertByUser(
        string id, [FromBody] VetPatchRequest patch, CancellationToken ct)
    {
        var (profile, failure) = await vets.UpsertAsync(User.RequireUserId(), id, patch, ct);

        return failure switch
        {
            null => Ok(profile),
            VetFailure.NotYours =>
                ApiResults.Forbidden("You can only edit your own vet profile"),
            _ => ApiResults.NotFound($"User {id} has no vet profile"),
        };
    }
}
