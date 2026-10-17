using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Adoption (M10): listings, applications, the fee, and the handover.
///
/// Every refusal the services report maps to a status code in exactly one
/// place, <see cref="Refused"/>. The pattern is M4's: <c>409</c> for a rule
/// about the thing (an illegal move, an unpaid fee, an animal already gone) and
/// <c>403</c> for the wrong person making a legal one.
/// </summary>
[ApiController]
[Route("api/v1/adoptions")]
public sealed class AdoptionsController(
    IAdoptionListingService listings,
    IAdoptionApplicationService applications,
    IAdoptionTransferService transfer,
    IRateLimitService rateLimits) : ControllerBase
{
    // ── Listings ─────────────────────────────────────────────────────────

    /// <summary>The directory. Public; available animals only, longest-waiting first.</summary>
    [HttpGet("listings")]
    public async Task<IActionResult> SearchListings(
        [FromQuery] double? lat,
        [FromQuery] double? lng,
        [FromQuery] double? radiusMiles,
        [FromQuery] string? species,
        [FromQuery] string? shelterId,
        [FromQuery] string? goodWithKids,
        [FromQuery] string? goodWithDogs,
        [FromQuery] string? goodWithCats,
        [FromQuery] string? energyLevel,
        [FromQuery] int? maxFeeCents,
        [FromQuery] string? q,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        if (q is { Length: > 200 }) return ApiResults.BadRequest("Search for at most 200 characters");

        return Ok(await listings.SearchAsync(new ListingSearchQuery(
            lat, lng, radiusMiles, species, shelterId, goodWithKids, goodWithDogs, goodWithCats,
            energyLevel, maxFeeCents, string.IsNullOrWhiteSpace(q) ? null : q, cursor, limit ?? 24), ct));
    }

    [HttpGet("listings/{id}")]
    public async Task<IActionResult> GetListing(string id, CancellationToken ct)
    {
        var listing = await listings.GetAsync(User.UserId(), id, ct);
        return listing is null ? ApiResults.NotFound($"Listing {id} not found") : Ok(listing);
    }

    [HttpPost("listings")]
    [Authorize]
    public async Task<IActionResult> CreateListing([FromBody] CreateListingRequest input, CancellationToken ct)
    {
        var (listing, refusal) = await listings.CreateAsync(User.RequireUserId(), input, ct);
        return refusal is null
            ? CreatedAtAction(nameof(GetListing), new { id = listing!.Listing.Id }, listing)
            : Refused(refusal, "Listing", input.PetId);
    }

    [HttpPatch("listings/{id}")]
    [Authorize]
    public async Task<IActionResult> UpdateListing(
        string id, [FromBody] UpdateListingRequest patch, CancellationToken ct)
    {
        var (listing, refusal) = await listings.UpdateAsync(User.RequireUserId(), id, patch, ct);
        return refusal is null ? Ok(listing) : Refused(refusal, "Listing", id);
    }

    [HttpPatch("listings/{id}/status")]
    [Authorize]
    public async Task<IActionResult> SetListingStatus(
        string id, [FromBody] ListingStatusRequest input, CancellationToken ct)
    {
        var (listing, refusal) = await listings.SetStatusAsync(User.RequireUserId(), id, input.Status, ct);
        return refusal is null ? Ok(listing) : Refused(refusal, "Listing", id);
    }

    // ── Applications ─────────────────────────────────────────────────────

    /// <summary>
    /// Yours as an applicant by default; <c>?as=shelter</c> returns your
    /// shelter's queue instead. Two audiences, one resource, and the caller
    /// says which hat they are wearing.
    /// </summary>
    [HttpGet("applications")]
    [Authorize]
    public async Task<IActionResult> ListApplications(
        [FromQuery(Name = "as")] string? asRole,
        [FromQuery] string? status,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        if (asRole != "shelter")
            return Ok(await applications.ListMineAsync(User.RequireUserId(), cursor, limit ?? 50, ct));

        var (page, refusal) = await applications.ListForShelterAsync(
            User.RequireUserId(), status, cursor, limit ?? 50, ct);
        return refusal is null ? Ok(page) : Refused(refusal, "Application", "");
    }

    [HttpPost("applications")]
    [Authorize]
    public async Task<IActionResult> CreateApplication(
        [FromBody] CreateApplicationRequest input, CancellationToken ct)
    {
        var (application, refusal) = await applications.CreateAsync(User.RequireUserId(), input, ct);
        return refusal is null
            ? CreatedAtAction(nameof(GetApplication), new { id = application!.Id }, application)
            : Refused(refusal, "Listing", input.ListingId);
    }

    /// <summary>Either side may read it. Somebody else's reads as 404, so an id cannot be probed.</summary>
    [HttpGet("applications/{id}")]
    [Authorize]
    public async Task<IActionResult> GetApplication(string id, CancellationToken ct)
    {
        var (application, refusal) = await applications.GetAsync(User.RequireUserId(), id, ct);
        return refusal is null ? Ok(application) : Refused(refusal, "Application", id);
    }

    [HttpPatch("applications/{id}/status")]
    [Authorize]
    public async Task<IActionResult> SetApplicationStatus(
        string id, [FromBody] ApplicationStatusRequest input, CancellationToken ct)
    {
        var (application, refusal) = await applications.UpdateStatusAsync(
            User.RequireUserId(), id, input.Status, input.Note, ct);
        return refusal is null ? Ok(application) : Refused(refusal, "Application", id);
    }

    /// <summary>
    /// Start paying the fee — the applicant's endpoint, deliberately. Throttled
    /// like checkout: every call can reach the payment provider.
    /// </summary>
    [HttpPost("applications/{id}/payment")]
    [Authorize]
    public async Task<IActionResult> Pay(string id, CancellationToken ct)
    {
        var verdict = await rateLimits.ConsumeAsync(RateLimits.Checkout, $"uid:{User.RequireUserId()}", ct);
        if (!verdict.Allowed)
            return ApiResults.TooManyRequests(verdict.Message ?? "Too many requests", verdict.Limit);

        var (payment, refusal) = await applications.StartPaymentAsync(User.RequireUserId(), id, ct);
        return refusal is null ? Ok(payment) : Refused(refusal, "Application", id);
    }

    /// <summary>
    /// Complete the adoption — a command rather than a status PATCH, because it
    /// is not a field edit: it moves an animal between households and refuses
    /// unless the fee has settled. The shelter's.
    /// </summary>
    [HttpPost("applications/{id}/complete")]
    [Authorize]
    public async Task<IActionResult> Complete(
        string id, [FromBody] CompleteAdoptionRequest? input, CancellationToken ct)
    {
        var (result, refusal) = await transfer.CompleteAsync(
            User.RequireUserId(), id, input?.Force ?? false, ct);
        return refusal is null ? Ok(result) : Refused(refusal, "Application", id);
    }

    private static IActionResult Refused(AdoptionRefusal r, string noun, string id) => r.Kind switch
    {
        AdoptionFailure.NotFound => ApiResults.NotFound($"{noun} {id} not found"),
        AdoptionFailure.NotYours => ApiResults.Forbidden("That isn't your listing"),
        AdoptionFailure.NoShelterProfile => ApiResults.Forbidden("You need a shelter profile for that"),
        AdoptionFailure.PetNotFound => ApiResults.BadRequest("No such animal"),
        AdoptionFailure.ListingNotFound => ApiResults.BadRequest("No such listing"),
        AdoptionFailure.PetNotYours => ApiResults.Forbidden("You can only list an animal your shelter owns"),
        AdoptionFailure.AlreadyListed => ApiResults.Conflict("That animal is already listed"),
        // Either somebody completed it a moment ago, or the animal moved by
        // other means. Both are "reload and look again".
        AdoptionFailure.NotShelterOwned => ApiResults.Conflict("Your shelter no longer owns that animal"),
        AdoptionFailure.InvalidTransition => ApiResults.Conflict(
            r.To is null
                ? "This application isn't ready to complete"
                : $"Cannot move it from \"{r.From}\" to \"{r.To}\"",
            new { from = r.From, to = r.To }),
        AdoptionFailure.WrongActor => ApiResults.Forbidden(
            r.To == "withdrawn" ? "Only the applicant can do that" : "Only the shelter can do that"),
        AdoptionFailure.ListingUnavailable => ApiResults.Conflict(
            "That animal is no longer available", new { status = r.From }),
        AdoptionFailure.OwnListing => ApiResults.BadRequest("That's your own listing"),
        AdoptionFailure.Duplicate => ApiResults.Conflict("You already have an open application for this animal"),
        // One approval per listing at a time, so two people are never both
        // asked for money for one animal.
        AdoptionFailure.AlreadyApproved => ApiResults.Conflict(
            "Another applicant is already approved for this animal", new { applicationId = r.ApplicationId }),
        AdoptionFailure.NotApplicant => ApiResults.Forbidden("Only the applicant can pay this fee"),
        AdoptionFailure.NotShelter => ApiResults.Forbidden("Only the shelter can complete an adoption"),
        AdoptionFailure.NotApproved => ApiResults.Conflict(
            "You can pay once the shelter has approved you", new { status = r.From }),
        AdoptionFailure.NoFee => ApiResults.Conflict("This adoption has no fee"),
        AdoptionFailure.AlreadyPaid => ApiResults.Conflict("This fee has already been paid"),
        AdoptionFailure.PaymentSetupFailed => ApiResults.BadGateway(
            "We couldn't start the payment. Please try again.", new { applicationId = id }),
        AdoptionFailure.FeeUnpaid => ApiResults.Conflict(
            "The adoption fee hasn't been paid yet", new { paymentStatus = r.PaymentStatus }),
        // The ids go back so the UI can name what is in the way rather than
        // saying no and leaving the shelter to guess.
        AdoptionFailure.LiveEngagements => ApiResults.Conflict(
            "This animal still has a booking or a vet appointment open",
            new { code = "live_engagements", bookingIds = r.BookingIds, appointmentIds = r.AppointmentIds }),
        _ => throw new ArgumentOutOfRangeException(nameof(r), r.Kind, null),
    };
}
