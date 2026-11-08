using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Models.Dtos;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// Bookings, their messages and their reviews.
///
/// Every failure the service reports maps to a status code in exactly one place
/// (<see cref="BookingError"/>), so no action invents its own. The two that
/// matter are <c>409</c> for an illegal transition — a rule about the booking —
/// and <c>403</c> for the wrong party making a legal one — a rule about the
/// person.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize]
public sealed class BookingsController(
    IBookingService bookings,
    IEntitlementService entitlements,
    IMessageService messages,
    IReviewService reviews) : ControllerBase
{
    /// <summary>
    /// The caller's own bookings, newest first — or, with <c>from</c>, a window
    /// of the calendar, soonest first (<see cref="ScheduleListQuery"/>).
    /// </summary>
    [HttpGet("bookings")]
    public async Task<IActionResult> ListMine(
        [FromQuery] BookingListQuery query, CancellationToken ct)
        => query.ToWindow() is { } window
            ? Ok(await bookings.ListMyScheduleAsync(
                User.RequireUserId(), window, query.Cursor, query.Limit ?? 24, ct))
            : Ok(await bookings.ListMineAsync(
                User.RequireUserId(), query.Cursor, query.Limit ?? 24, ct));

    [HttpGet("bookings/{id}")]
    public async Task<IActionResult> Get(string id, CancellationToken ct)
    {
        var (booking, failure) = await bookings.GetAsync(User.RequireUserId(), id, ct);
        return failure is null ? Ok(booking) : BookingError(failure.Value, id);
    }

    [HttpPost("bookings")]
    public async Task<IActionResult> Create(
        [FromBody] CreateBookingRequest input, CancellationToken ct)
    {
        var (booking, failure) = await bookings.CreateAsync(User.RequireUserId(), input, ct);

        if (failure == BookingFailure.LeadTime)
            return await LeadTimeRefusal.For(entitlements, User.RequireUserId(), "Bookings", ct);

        return failure is null
            ? CreatedAtAction(nameof(Get), new { id = booking!.Id }, booking)
            : BookingError(failure.Value, input.CaretakerId);
    }

    [HttpPatch("bookings/{id}/status")]
    public async Task<IActionResult> UpdateStatus(
        string id, [FromBody] UpdateBookingStatusRequest input, CancellationToken ct)
    {
        var (booking, failure) = await bookings.UpdateStatusAsync(
            User.RequireUserId(), id, input.Status, ct);

        return failure is null ? Ok(booking) : BookingError(failure.Value, id);
    }

    // ── Messages ─────────────────────────────────────────────────────────

    [HttpGet("bookings/{id}/messages")]
    public async Task<IActionResult> ListMessages(string id, CancellationToken ct)
    {
        var thread = await messages.ListAsync(User.RequireUserId(), id, ct);
        return thread is null ? ApiResults.NotFound($"Booking {id} not found") : Ok(thread);
    }

    [HttpPost("bookings/{id}/messages")]
    public async Task<IActionResult> SendMessage(
        string id, [FromBody] CreateMessageRequest input, CancellationToken ct)
    {
        var message = await messages.SendAsync(User.RequireUserId(), id, input.Body, ct);

        return message is null
            ? ApiResults.NotFound($"Booking {id} not found")
            : StatusCode(StatusCodes.Status201Created, message);
    }

    /// <summary>
    /// Mark the other party's messages read.
    ///
    /// A POST, and its own route, because it changes data (REQUIREMENTS.md
    /// C10). The reference implementation folded this into the GET that returns
    /// the thread, which made an unread inbound message unreturnable: the read
    /// marked it, then serialised it as read, so no unread badge could ever be
    /// right.
    /// </summary>
    [HttpPost("bookings/{id}/messages/read")]
    public async Task<IActionResult> MarkMessagesRead(string id, CancellationToken ct)
    {
        var moved = await messages.MarkReadAsync(User.RequireUserId(), id, ct);
        return moved is null
            ? ApiResults.NotFound($"Booking {id} not found")
            : Ok(new { marked = moved.Value });
    }

    // ── Reviews ──────────────────────────────────────────────────────────

    [HttpGet("bookings/{id}/reviews")]
    public async Task<IActionResult> ListReviews(string id, CancellationToken ct)
    {
        // Participants only: the reviews on a booking name both parties, and
        // the booking itself is not public.
        var (_, failure) = await bookings.GetAsync(User.RequireUserId(), id, ct);
        if (failure is not null) return BookingError(failure.Value, id);

        return Ok(await reviews.ListForSubjectAsync(id, Core.Models.Enums.ReviewKinds.Booking, ct));
    }

    [HttpPost("bookings/{id}/reviews")]
    public async Task<IActionResult> CreateReview(
        string id, [FromBody] CreateReviewRequest input, CancellationToken ct)
    {
        var (review, failure) = await reviews.CreateAsync(User.RequireUserId(), id, input, ct);

        return failure switch
        {
            null => StatusCode(StatusCodes.Status201Created, review),
            ReviewFailure.NotFound => ApiResults.NotFound($"Booking {id} not found"),
            ReviewFailure.NotCompleted => ApiResults.Conflict(
                "This booking hasn't been completed yet, so there's nothing to review.",
                new { bookingId = id }),
            ReviewFailure.NotParticipant => ApiResults.Forbidden(
                "Only the people on a booking can review it"),
            ReviewFailure.WrongRecipient => ApiResults.Forbidden(
                "That person wasn't part of this booking"),
            ReviewFailure.AlreadyReviewed => ApiResults.Conflict(
                "You've already reviewed this booking.", new { bookingId = id }),
            _ => ApiResults.Forbidden("Not permitted"),
        };
    }

    internal static IActionResult BookingError(BookingFailure failure, string id) => failure switch
    {
        // Not a participant reads as 404, not 403: booking ids are sequential,
        // and a caller who can tell "no such booking" from "not yours" can count
        // the marketplace's volume.
        BookingFailure.NotFound or BookingFailure.NotParticipant =>
            ApiResults.NotFound($"Booking {id} not found"),

        BookingFailure.CaretakerNotFound =>
            ApiResults.NotFound($"Caretaker {id} not found"),

        BookingFailure.ServiceNotOffered => ApiResults.Conflict(
            "This caretaker doesn't offer that service.", new { caretakerId = id }),

        BookingFailure.BadDates =>
            ApiResults.BadRequest("The end time must be after the start time"),

        BookingFailure.NotAvailable => ApiResults.Conflict(
            "The caretaker isn't available then. Choose a time from their calendar.",
            new { code = "not_available", caretakerId = id }),

        BookingFailure.LeadTime => ApiResults.Conflict(
            $"Bookings need at least {Core.Services.LeadTime.StandardHours} "
            + "hours' notice.",
            new { leadTimeHours = Core.Services.LeadTime.StandardHours }),

        BookingFailure.NotYourPet =>
            ApiResults.Forbidden("You can only book your own pets"),

        // The rule is about the booking, so 409.
        BookingFailure.InvalidTransition => ApiResults.Conflict(
            "That status change isn't allowed from where this booking is now.",
            new { bookingId = id }),

        // The rule is about the person, so 403. This is the one that stops an
        // owner accepting their own booking.
        BookingFailure.WrongActor =>
            ApiResults.Forbidden("Only the caretaker can do that"),

        _ => ApiResults.NotFound($"Booking {id} not found"),
    };
}

/// <summary>
/// Reviews addressed to a person rather than to a booking.
///
/// Public: a reputation nobody can read is not one, and the response carries
/// user ids and ratings, which are already on every profile card.
/// </summary>
[ApiController]
[Route("api/v1")]
public sealed class ReviewsController(IReviewService reviews) : ControllerBase
{
    [HttpGet("users/{id}/reviews")]
    public async Task<IActionResult> ListForUser(
        string id, [FromQuery] string? kind, CancellationToken ct)
        => Ok(await reviews.ListForUserAsync(id, kind, ct));
}
