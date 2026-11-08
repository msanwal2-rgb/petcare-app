using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>Why a guest booking was refused before the booking's own rules ran.</summary>
public enum GuestFailure
{
    /// <summary>
    /// The email belongs to an account (active or suspended) — they sign in.
    /// 409, <c>code: "account_exists"</c>. Suspended reads the same, so a
    /// suspension is not revealed.
    /// </summary>
    AccountExists,
}

/// <summary>What a guest booking produced. <paramref name="SetupLink"/> is for development only.</summary>
public sealed record GuestBookingResult(
    BookingDto Booking, string CaretakerName, string PetName, bool AccountEmailSent, string? SetupLink);

public sealed record GuestAppointmentResult(
    AppointmentTimelineDto Appointment, string VetName, string PetName, bool AccountEmailSent, string? SetupLink);

/// <summary>Exactly one of the three is set.</summary>
public sealed record GuestBookingOutcome(
    GuestBookingResult? Result, GuestFailure? Guest, BookingFailure? Booking);

/// <summary>Exactly one of the three is set.</summary>
public sealed record GuestAppointmentOutcome(
    GuestAppointmentResult? Result, GuestFailure? Guest, AppointmentFailure? Appointment);

/// <summary>
/// Booking a caretaker or a vet without an account (STATUS §3-G).
///
/// One transaction writes the guest (or reuses an unclaimed one at that
/// email), a new pet, the booking and the guest's notice; then, if they asked
/// to keep their details, a set-password email goes out. The booking itself
/// goes through <see cref="IBookingService.CreateInAsync"/> or
/// <see cref="IAppointmentService.CreateInAsync"/> — the signed-in rules, by
/// the same code. Rate limits are the controller's.
/// </summary>
public interface IGuestBookingService
{
    Task<GuestBookingOutcome> BookCaretakerAsync(GuestBookingRequest request, CancellationToken ct = default);

    Task<GuestAppointmentOutcome> BookVetAsync(GuestAppointmentRequest request, CancellationToken ct = default);
}
