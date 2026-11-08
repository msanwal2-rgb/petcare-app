using Leash.Api.Http;
using Leash.Core.Email;
using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Booking as a guest (STATUS §3-G): two public routes, rate-limited before
/// any work, that write a guest, their pet and a booking or visit request.
///
/// Public on purpose and deliberately blind to any session: a signed-in caller
/// using them books as the guest whose details they typed, never as
/// themselves — whoever they are is not an input here. The booking's own
/// failures map exactly as on the signed-in routes.
/// </summary>
[ApiController]
[Route("api/v1/guest")]
public sealed class GuestController(
    IGuestBookingService guests,
    IRateLimitService rateLimits,
    EmailDevMode devMode) : ControllerBase
{
    [HttpPost("bookings")]
    public async Task<IActionResult> BookCaretaker(GuestBookingRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(request.Guest.Email, ct) is { } limited) return limited;

        var outcome = await guests.BookCaretakerAsync(request, ct);

        if (outcome.Guest is not null) return AccountExists();
        if (outcome.Booking is { } failure)
            return failure == BookingFailure.LeadTime
                ? LeadTimeRefusal("Bookings")
                : BookingsController.BookingError(failure, request.Booking.CaretakerId);

        var r = outcome.Result!;
        var booking = new
        {
            r.Booking.Id, r.Booking.Status, r.Booking.ServiceType,
            r.Booking.StartDateTime, r.Booking.EndDateTime, r.Booking.PriceTotal,
        };

        // No user id, no pet id, no session: the guest's next step is their
        // inbox. The set-password link is shown only in development.
        return StatusCode(StatusCodes.Status201Created, DevLink(r.SetupLink) is { } link
            ? new { booking, r.CaretakerName, r.PetName, r.AccountEmailSent, devLink = link }
            : (object)new { booking, r.CaretakerName, r.PetName, r.AccountEmailSent });
    }

    [HttpPost("appointments")]
    public async Task<IActionResult> BookVet(GuestAppointmentRequest request, CancellationToken ct)
    {
        if (await ThrottleAsync(request.Guest.Email, ct) is { } limited) return limited;

        var outcome = await guests.BookVetAsync(request, ct);

        if (outcome.Guest is not null) return AccountExists();
        if (outcome.Appointment is { } failure)
            return failure == AppointmentFailure.LeadTime
                ? LeadTimeRefusal("Appointments")
                : AppointmentsController.AppointmentError(failure, request.Appointment.VetId);

        var r = outcome.Result!;
        var appointment = new
        {
            r.Appointment.Id, r.Appointment.Status, r.Appointment.Mode,
            r.Appointment.StartDateTime, r.Appointment.EndDateTime, r.Appointment.Fee,
        };

        return StatusCode(StatusCodes.Status201Created, DevLink(r.SetupLink) is { } link
            ? new { appointment, r.VetName, r.PetName, r.AccountEmailSent, devLink = link }
            : (object)new { appointment, r.VetName, r.PetName, r.AccountEmailSent });
    }

    private string? DevLink(string? link) => devMode.Enabled ? link : null;

    private static IActionResult AccountExists() => ApiResults.Conflict(
        "You already have a Leash account with this email. Log in to book.",
        new { code = "account_exists" });

    /// <summary>
    /// The signed-in routes' 409 shape (<c>Http/LeadTimeRefusal</c>), for
    /// somebody who is by definition not a member.
    /// </summary>
    private static IActionResult LeadTimeRefusal(string what)
    {
        var now = Ids.Now();
        return ApiResults.Conflict(
            $"{what} need at least {LeadTime.StandardHours} hours' notice.",
            new
            {
                leadTimeHours = LeadTime.StandardHours,
                earliestAt = LeadTime.EarliestStart(now, member: false),
                memberEarliestAt = LeadTime.EarliestStart(now, member: true),
                isMember = false,
            });
    }

    /// <summary>Per client (an hour and a day) and per email, before anything is read or written.</summary>
    private async Task<IActionResult?> ThrottleAsync(string email, CancellationToken ct)
    {
        var client = ClientKeys.For(Request, rateLimits);

        foreach (var (rule, key) in new[]
                 {
                     (RateLimits.GuestBookingClient, client),
                     (RateLimits.GuestBookingClientDaily, client),
                     (RateLimits.GuestBookingEmail, rateLimits.SubjectKey(email)),
                 })
        {
            var verdict = await rateLimits.ConsumeAsync(rule, key, ct);
            if (!verdict.Allowed)
                return ApiResults.TooManyRequests(verdict.Message ?? "Too many requests", verdict.Limit);
        }

        return null;
    }
}
