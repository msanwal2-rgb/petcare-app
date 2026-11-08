using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Caretaker profiles and search.
///
/// Search and the profile page are <b>public</b>: browsing the marketplace is
/// what brings people to it, and both return only the public projection of the
/// person behind a profile. Everything that reads or writes a particular
/// account's data is <c>[Authorize]</c>d individually.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class CaretakersController(
    ICaretakerService caretakers,
    IBookingService bookings) : ControllerBase
{
    /// <summary>
    /// Search, executed in PostgreSQL and returned one page at a time
    /// (REQUIREMENTS.md C4).
    ///
    /// <c>cursor</c> is opaque — it comes back in <c>nextCursor</c> and goes out
    /// unchanged. A client that takes it apart is coupled to a sort order that
    /// changes with the filter.
    /// </summary>
    [HttpGet("caretakers/search")]
    public async Task<IActionResult> Search(
        [FromQuery] double? lat,
        [FromQuery] double? lng,
        [FromQuery] double? radiusMiles,
        [FromQuery] string? serviceType,
        [FromQuery] string? species,
        [FromQuery] DateOnly? startDate,
        [FromQuery] decimal? minPrice,
        [FromQuery] decimal? maxPrice,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        var page = await caretakers.SearchAsync(
            new CaretakerSearchQuery(
                lat, lng, radiusMiles, serviceType, species, startDate,
                minPrice, maxPrice, cursor, limit ?? 24),
            ct);

        return Ok(page);
    }

    [HttpGet("caretakers/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var caretaker = await caretakers.GetAsync(id, ct);
        return caretaker is null
            ? ApiResults.NotFound($"Caretaker {id} not found")
            : Ok(caretaker);
    }

    /// <summary>
    /// A caretaker's booking queue. Theirs alone — an owner reading this would
    /// be reading the marketplace's schedule.
    /// </summary>
    [HttpGet("caretakers/{id}/bookings")]
    [Authorize]
    public async Task<IActionResult> ListBookings(
        string id, [FromQuery] BookingListQuery query, CancellationToken ct)
    {
        var page = query.ToWindow() is { } window
            ? await bookings.ListCaretakerScheduleAsync(
                User.RequireUserId(), id, window, query.Cursor, query.Limit ?? 24, ct)
            : await bookings.ListForCaretakerAsync(
                User.RequireUserId(), id, query.Cursor, query.Limit ?? 24, ct);

        return page is null
            ? ApiResults.NotFound($"Caretaker {id} not found")
            : Ok(page);
    }

    /// <summary>
    /// Somebody's caretaker profile. Public, because it is the same data
    /// <c>/caretakers/{id}</c> serves — this route exists so a client holding a
    /// user id does not have to search for the profile id.
    /// </summary>
    [HttpGet("users/{id}/caretaker-profile")]
    public async Task<IActionResult> GetByUser(string id, CancellationToken ct)
    {
        var profile = await caretakers.GetByUserAsync(id, ct);
        return profile is null
            ? ApiResults.NotFound($"User {id} has no caretaker profile")
            : Ok(profile);
    }

    /// <summary>
    /// Create or edit your own profile. One verb, because there is exactly one
    /// profile per user and a client should not have to know whether it exists.
    /// </summary>
    [HttpPatch("users/{id}/caretaker-profile")]
    [Authorize]
    public async Task<IActionResult> UpsertByUser(
        string id, [FromBody] CaretakerPatchRequest patch, CancellationToken ct)
    {
        var (profile, failure) = await caretakers.UpsertAsync(
            User.RequireUserId(), id, patch, ct);

        return failure switch
        {
            null => Ok(profile),
            CaretakerFailure.NotYours =>
                ApiResults.Forbidden("You can only edit your own caretaker profile"),
            _ => ApiResults.NotFound($"User {id} has no caretaker profile"),
        };
    }
}
