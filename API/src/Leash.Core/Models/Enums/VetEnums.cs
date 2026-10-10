namespace Leash.Core.Models.Enums;

/// <summary>What a vet lists themselves as doing (REQUIREMENTS.md V1).</summary>
public static class VetSpecialties
{
    public const string General = "general";
    public const string Dermatology = "dermatology";
    public const string Dentistry = "dentistry";
    public const string Surgery = "surgery";
    public const string Emergency = "emergency";
    public const string Nutrition = "nutrition";
    public const string Behavior = "behavior";
    public const string Exotics = "exotics";

    public static readonly string[] All =
        [General, Dermatology, Dentistry, Surgery, Emergency, Nutrition, Behavior, Exotics];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// Where a consultation happens (REQUIREMENTS.md V2).
///
/// Not a display preference: a vet who does not offer home visits cannot be
/// booked for one, and the refusal is a 409 rather than a validation error —
/// the request is well formed, it is the clinic that does not do that.
/// </summary>
public static class ConsultModes
{
    public const string InClinic = "in_clinic";
    public const string Video = "video";
    public const string HomeVisit = "home_visit";

    public static readonly string[] All = [InClinic, Video, HomeVisit];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// The appointment lifecycle (REQUIREMENTS.md <b>§11.2</b>, not §11.1).
///
/// It is the booking machine with one word changed: an appointment is
/// <c>confirmed</c> where a booking is <c>accepted</c>. The shape is otherwise
/// identical, which is exactly why the two vocabularies are separate types —
/// sharing <see cref="BookingStatuses"/> would make
/// <c>UpdateStatus(id, "accepted")</c> compile against an appointment and fail
/// only at the transition table, by which point the status string has already
/// been written into an error message a human will read.
///
/// The transition table and the actor table live in
/// <see cref="Services.AppointmentService"/>, not here, because they are rules.
/// This is only the vocabulary.
/// </summary>
public static class AppointmentStatuses
{
    public const string Requested = "requested";
    public const string Confirmed = "confirmed";
    public const string Declined = "declined";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";

    public static readonly string[] All =
        [Requested, Confirmed, Declined, InProgress, Completed, Cancelled];

    public static bool IsValid(string value) => All.Contains(value);
}
