using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Pets, their health timeline, their visit history and their recommendations.
///
/// Every action is <c>[Authorize]</c>d individually — there is no fallback
/// policy, so a new action is public until it says otherwise (ARCHITECTURE.md
/// section 2, step 6). That is deliberate: a fallback policy hides a missing
/// authorization check behind a 401 that looks correct.
///
/// The authorization itself is in <see cref="IPetService"/>, not here. This
/// class only maps a failure onto a status code.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class PetsController(
    IPetService pets,
    IMedicalRecordService records,
    ICatalogService catalog) : ControllerBase
{
    /// <summary>
    /// The caller's own pets.
    ///
    /// No <c>ownerId</c> in the path. The reference implementation's route was
    /// <c>/api/owners/:ownerId/pets</c> guarded by "is this you?", which is a
    /// parameter that can only ever hold one value and a check that can be
    /// forgotten. A self-only collection reads itself from the principal.
    /// </summary>
    [HttpGet("pets")]
    public async Task<IActionResult> ListMine(
        [FromQuery] string? ids, CancellationToken ct)
    {
        // `?ids=a,b,c` switches this to a batch resolve, filtered to what the
        // caller may see — a booking detail page asks for every pet on the
        // booking and a caretaker is entitled to all of them.
        if (ids is null) return Ok(await pets.ListMineAsync(User.RequireUserId(), ct));

        var requested = ids
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.Ordinal)
            .Take(MaxBatchIds)
            .ToArray();

        return Ok(await pets.GetManyAsync(User.RequireUserId(), requested, ct));
    }

    /// <summary>
    /// An unbounded id list is an invitation to ask for the whole table, so the
    /// extras are dropped rather than the request refused — a client asking for
    /// more than fifty pets on one screen has a different problem.
    /// </summary>
    private const int MaxBatchIds = 50;

    [HttpGet("pets/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var pet = await pets.GetAsync(User.RequireUserId(), id, ct);
        return pet is null ? ApiResults.NotFound($"Pet {id} not found") : Ok(pet);
    }

    [HttpPost("pets")]
    public async Task<IActionResult> Create(
        [FromBody] PetInputRequest input, CancellationToken ct)
    {
        var pet = await pets.CreateAsync(User.RequireUserId(), input, ct);
        return CreatedAtAction(nameof(Get), new { id = pet.Id }, pet);
    }

    [HttpPatch("pets/{id}")]
    public async Task<IActionResult> Update(
        string id, [FromBody] PetPatchRequest patch, CancellationToken ct)
    {
        var (pet, failure) = await pets.UpdateAsync(User.RequireUserId(), id, patch, ct);
        return failure is null ? Ok(pet) : PetError(failure.Value, id);
    }

    [HttpDelete("pets/{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var failure = await pets.DeleteAsync(User.RequireUserId(), id, ct);
        return failure is null ? NoContent() : PetError(failure.Value, id);
    }

    [HttpGet("pets/{id}/appointments")]
    public async Task<IActionResult> ListAppointments(string id, CancellationToken ct)
    {
        var visits = await pets.ListAppointmentsAsync(User.RequireUserId(), id, ct);
        return visits is null ? ApiResults.NotFound($"Pet {id} not found") : Ok(visits);
    }

    [HttpGet("pets/{id}/recommendations")]
    public async Task<IActionResult> Recommendations(string id, CancellationToken ct)
    {
        var products = await catalog.RecommendForPetAsync(User.RequireUserId(), id, ct);
        return products is null ? ApiResults.NotFound($"Pet {id} not found") : Ok(products);
    }

    // ── Health records ───────────────────────────────────────────────────

    [HttpGet("pets/{id}/medical-records")]
    public async Task<IActionResult> ListRecords(string id, CancellationToken ct)
    {
        var (list, failure) = await records.ListForPetAsync(User.RequireUserId(), id, ct);
        return failure is null ? Ok(list) : RecordError(failure.Value, id);
    }

    [HttpPost("pets/{id}/medical-records")]
    public async Task<IActionResult> CreateRecord(
        string id, [FromBody] MedicalRecordRequest input, CancellationToken ct)
    {
        var (record, failure) = await records.CreateAsync(
            User.RequireUserId(), id, input, ct);

        return failure is null
            ? StatusCode(StatusCodes.Status201Created, record)
            : RecordError(failure.Value, id);
    }

    /// <summary>
    /// One mapping from domain failure to status code, so no action invents its
    /// own. <c>ApiResults</c> throughout, never <c>NotFound()</c> — the
    /// framework helpers emit <c>ProblemDetails</c>, a different shape from the
    /// envelope the frontend parses.
    /// </summary>
    private IActionResult PetError(PetFailure failure, string id) => failure switch
    {
        PetFailure.NotFound => ApiResults.NotFound($"Pet {id} not found"),
        PetFailure.NotOwner => ApiResults.Forbidden("Only the pet's owner can do that"),
        PetFailure.HasHistory => ApiResults.Conflict(
            "This pet has vet visits or health records, so it can't be deleted. "
            + "Deleting it would remove records its vets wrote.",
            new { petId = id }),
        _ => ApiResults.NotFound($"Pet {id} not found"),
    };

    private IActionResult RecordError(RecordFailure failure, string id) => failure switch
    {
        RecordFailure.NotFound => ApiResults.NotFound($"Record {id} not found"),
        RecordFailure.NoAccess => ApiResults.Forbidden(
            "You don't have access to this pet's health records"),
        RecordFailure.TypeNotAuthorable => ApiResults.Forbidden(
            "Only the treating vet can add that kind of record. "
            + "You can add allergies and weights yourself."),
        RecordFailure.NotAuthor => ApiResults.Forbidden(
            "Only the author can remove this record"),
        // REQUIREMENTS.md V8. 400, not 403: the caller may well have clinical
        // access — the appointment they cited simply is not this pet's, or is
        // not theirs.
        RecordFailure.AppointmentMismatch => ApiResults.BadRequest(
            "That appointment isn't this pet's visit"),
        _ => ApiResults.Forbidden("Not permitted"),
    };
}

/// <summary>
/// <c>DELETE /medical-records/{id}</c> sits outside the pet path because a
/// record is addressable on its own and the caller deleting one — its author —
/// need not be anyone in particular to the pet.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class MedicalRecordsController(IMedicalRecordService records) : ControllerBase
{
    [HttpDelete("medical-records/{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var failure = await records.DeleteAsync(User.RequireUserId(), id, ct);

        return failure switch
        {
            null => NoContent(),
            RecordFailure.NotFound => ApiResults.NotFound($"Record {id} not found"),
            RecordFailure.NotAuthor => ApiResults.Forbidden(
                "Only the author can remove this record"),
            _ => ApiResults.Forbidden("Not permitted"),
        };
    }
}
