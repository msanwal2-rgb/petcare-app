namespace Leash.Core.Models.Dtos;

// Booking as a guest (STATUS §3-G). The request carries who they are, their
// pet, and what they want; never a price, an owner or a pet id. The server
// writes the guest, the pet and the booking together, by the same rules a
// signed-in owner's booking runs through.

/// <summary>Who the guest is. Their phone matters: they cannot read messages until they have an account.</summary>
public sealed record GuestContactRequest(string Name, string Email, string Phone);

/// <summary>
/// The pet's basics. Everything else a pet profile has (photo, vet,
/// feeding, medications) is left at its empty default until the owner has an
/// account to edit it from.
/// </summary>
public sealed record GuestPetRequest(
    string Name,
    string Species,
    string Breed,
    string Sex,
    DateOnly Dob,
    int WeightLbs,
    string[]? Allergies,
    string? BehaviorNotes);

/// <summary>A caretaker booking's own fields — <see cref="CreateBookingRequest"/> less the pets.</summary>
public sealed record GuestBookingDetails(
    string CaretakerId,
    string ServiceType,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string? Notes,
    int? UtcOffsetMinutes);

/// <summary>A vet visit's own fields — <see cref="CreateAppointmentRequest"/> less the pet.</summary>
public sealed record GuestAppointmentDetails(
    string VetId,
    string Mode,
    string Reason,
    string[]? Symptoms,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string? Notes,
    int? UtcOffsetMinutes);

/// <param name="SaveAccount">
/// "Save my details and create an account": the guest is made <c>pending</c>
/// and emailed a set-password link.
/// </param>
public sealed record GuestBookingRequest(
    GuestContactRequest Guest, GuestPetRequest Pet, GuestBookingDetails Booking, bool SaveAccount = false);

public sealed record GuestAppointmentRequest(
    GuestContactRequest Guest, GuestPetRequest Pet, GuestAppointmentDetails Appointment, bool SaveAccount = false);

/// <summary>A guest choosing their first password from the emailed link.</summary>
public sealed record SetPasswordRequest(string Token, string Password);
