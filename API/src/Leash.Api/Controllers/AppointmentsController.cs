using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Vet appointments, their visit summaries and their reviews.
///
/// Every failure the service reports maps to a status code in exactly one place
/// (<see cref="AppointmentError"/>), so no action invents its own. The two that
/// matter are the same two M4 settled for bookings: <c>409</c> for an illegal
/// transition — a rule about the appointment — and <c>403</c> for the wrong
/// party making a legal one — a rule about the person.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class AppointmentsController(
    IAppointmentService appointments,
    IEntitlementService entitlements,
    IReviewService reviews) : ControllerBase
{
    /// <summary>
    /// The caller's own appointments.
    ///
    /// No <c>ownerId</c> in the path, matching <c>GET /bookings</c>.
    /// REQUIREMENTS.md §7.3 writes it as <c>/owners/{ownerId}/appointments</c>,
    /// which is a parameter that can only ever hold one value guarded by a
    /// check that can be forgotten. A self-only collection reads itself from
    /// the principal.
    ///
    /// With <c>from</c> (and optionally <c>to</c> and <c>status</c>) it reads
    /// a window of the calendar instead, soonest first — see <see cref="ScheduleListQuery"/>.
    /// </summary>
    [HttpGet("appointments")]
    public async Task<IActionResult> ListMine(
        [FromQuery] AppointmentListQuery query, CancellationToken ct)
        => query.ToWindow() is { } window
            ? Ok(await appointments.ListMyScheduleAsync(
                User.RequireUserId(), window, query.Cursor, query.Limit ?? 24, ct))
            : Ok(await appointments.ListMineAsync(
                User.RequireUserId(), query.Cursor, query.Limit ?? 24, ct));

    [HttpGet("appointments/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var (appointment, failure) = await appointments.GetAsync(User.RequireUserId(), id, ct);
        return failure is null ? Ok(appointment) : AppointmentError(failure.Value, id);
    }

    [HttpPost("appointments")]
    public async Task<IActionResult> Create(
        [FromBody] CreateAppointmentRequest input, CancellationToken ct)
    {
        var (appointment, failure) = await appointments.CreateAsync(
            User.RequireUserId(), input, ct);

        if (failure == AppointmentFailure.LeadTime)
            return await LeadTimeRefusal.For(entitlements, User.RequireUserId(), "Appointments", ct);

        return failure is null
            ? CreatedAtAction(nameof(Get), new { id = appointment!.Id }, appointment)
            : AppointmentError(failure.Value, input.VetId);
    }

    [HttpPatch("appointments/{id}/status")]
    public async Task<IActionResult> UpdateStatus(
        string id, [FromBody] UpdateAppointmentStatusRequest input, CancellationToken ct)
    {
        var (appointment, failure) = await appointments.UpdateStatusAsync(
            User.RequireUserId(), id, input.Status, ct);

        return failure is null ? Ok(appointment) : AppointmentError(failure.Value, id);
    }

    /// <summary>
    /// The vet moves the visit to a new time; the owner is told, in the app
    /// and by email. Its own route rather than a field on the status PATCH:
    /// the status does not change.
    /// </summary>
    [HttpPost("appointments/{id}/reschedule")]
    public async Task<IActionResult> Reschedule(
        string id, [FromBody] RescheduleAppointmentRequest input, CancellationToken ct)
    {
        var (appointment, failure) = await appointments.RescheduleAsync(
            User.RequireUserId(), id, input, ct);

        return failure switch
        {
            null => Ok(appointment),
            AppointmentFailure.WrongActor =>
                ApiResults.Forbidden("Only the vet can reschedule an appointment"),
            _ => AppointmentError(failure.Value, id),
        };
    }

    /// <summary>
    /// Complete a visit and write its summary (REQUIREMENTS.md V7).
    ///
    /// Its own route rather than a field on the status PATCH, because it is a
    /// different-sized thing: it writes into the pet's permanent health record,
    /// and a prescription written here is what unlocks an Rx-only product in
    /// the store. A status change that could carry a prescription as a payload
    /// would be the kind of overloaded endpoint nobody reviews twice.
    /// </summary>
    [HttpPost("appointments/{id}/visit-summary")]
    public async Task<IActionResult> CompleteWithSummary(
        string id, [FromBody] VisitSummaryRequest input, CancellationToken ct)
    {
        var (result, failure) = await appointments.CompleteWithSummaryAsync(
            User.RequireUserId(), id, input, ct);

        return failure is null
            ? StatusCode(StatusCodes.Status201Created, result)
            : AppointmentError(failure.Value, id);
    }

    // ── Reviews ──────────────────────────────────────────────────────────

    [HttpGet("appointments/{id}/reviews")]
    public async Task<IActionResult> ListReviews(string id, CancellationToken ct)
    {
        // Participants only: a review on a visit names both parties, and the
        // appointment itself is not public.
        var (_, failure) = await appointments.GetAsync(User.RequireUserId(), id, ct);
        if (failure is not null) return AppointmentError(failure.Value, id);

        return Ok(await reviews.ListForSubjectAsync(id, ReviewKinds.VetAppointment, ct));
    }

    /// <summary>
    /// Review a completed visit. <b>The owner reviews the vet, and that is the
    /// only direction there is</b> (REQUIREMENTS.md V10).
    /// </summary>
    [HttpPost("appointments/{id}/reviews")]
    public async Task<IActionResult> CreateReview(
        string id, [FromBody] CreateReviewRequest input, CancellationToken ct)
    {
        var (review, failure) = await reviews.CreateForAppointmentAsync(
            User.RequireUserId(), id, input, ct);

        return failure switch
        {
            null => StatusCode(StatusCodes.Status201Created, review),
            ReviewFailure.NotFound => ApiResults.NotFound($"Appointment {id} not found"),
            ReviewFailure.NotCompleted => ApiResults.Conflict(
                "This visit hasn't been completed yet, so there's nothing to review.",
                new { appointmentId = id }),
            ReviewFailure.NotParticipant => ApiResults.Forbidden(
                "Only the person who booked a visit can review it"),
            ReviewFailure.OneDirectionOnly => ApiResults.Forbidden(
                "Vet reviews go one way: an owner reviews their vet."),
            ReviewFailure.WrongRecipient => ApiResults.Forbidden(
                "That person wasn't the vet on this visit"),
            ReviewFailure.AlreadyReviewed => ApiResults.Conflict(
                "You've already reviewed this visit.", new { appointmentId = id }),
            _ => ApiResults.Forbidden("Not permitted"),
        };
    }

    internal static IActionResult AppointmentError(AppointmentFailure failure, string id)
        => failure switch
        {
            // Not a participant reads as 404, not 403: appointment ids are
            // sequential, and a caller who can tell "no such appointment" from
            // "not yours" can count the marketplace's clinical volume.
            AppointmentFailure.NotFound or AppointmentFailure.NotParticipant =>
                ApiResults.NotFound($"Appointment {id} not found"),

            AppointmentFailure.VetNotFound => ApiResults.NotFound($"Vet {id} not found"),

            AppointmentFailure.NotYourPet =>
                ApiResults.Forbidden("You can only book appointments for your own pets"),

            AppointmentFailure.SpeciesNotAccepted => ApiResults.Conflict(
                "This vet doesn't treat that species.", new { vetId = id }),

            AppointmentFailure.ModeNotOffered => ApiResults.Conflict(
                "This vet doesn't offer that kind of consultation.", new { vetId = id }),

            AppointmentFailure.NotAvailable => ApiResults.Conflict(
                "The clinic isn't open then. Choose a time from their calendar.",
                new { code = "not_available", vetId = id }),

            AppointmentFailure.BadDates =>
                ApiResults.BadRequest("The end time must be after the start time"),

            AppointmentFailure.LeadTime => ApiResults.Conflict(
                $"Appointments need at least {Core.Services.LeadTime.StandardHours} "
                + "hours' notice.",
                new { leadTimeHours = Core.Services.LeadTime.StandardHours }),

            // The rule is about the appointment, so 409.
            AppointmentFailure.InvalidTransition => ApiResults.Conflict(
                "That status change isn't allowed from where this appointment is now.",
                new { appointmentId = id }),

            // The rule is about the person, so 403. This is the one that stops
            // an owner confirming their own appointment.
            AppointmentFailure.WrongActor =>
                ApiResults.Forbidden("Only the vet can do that"),

            AppointmentFailure.NotInProgress => ApiResults.Conflict(
                "A visit summary is written while the visit is in progress.",
                new { appointmentId = id }),

            AppointmentFailure.NotTheVet =>
                ApiResults.Forbidden("Only the treating vet can write the visit summary"),

            AppointmentFailure.BadSummary =>
                ApiResults.BadRequest("A visit summary needs at least one valid entry"),

            AppointmentFailure.NotReschedulable => ApiResults.Conflict(
                "Only a requested or confirmed appointment can be moved to a new time.",
                new { appointmentId = id }),

            AppointmentFailure.RescheduleInPast =>
                ApiResults.BadRequest("The new time has to be in the future"),

            _ => ApiResults.NotFound($"Appointment {id} not found"),
        };
}
