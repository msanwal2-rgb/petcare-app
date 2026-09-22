namespace Leash.Core.Models.Enums;

/// <summary>What a caretaker can be booked to do (REQUIREMENTS.md C1).</summary>
public static class ServiceTypes
{
    public const string Walking = "walking";
    public const string Sitting = "sitting";
    public const string Boarding = "boarding";
    public const string Daycare = "daycare";

    public static readonly string[] All = [Walking, Sitting, Boarding, Daycare];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>How a rate is charged. Priced per hour or per day, never both.</summary>
public static class PricingUnits
{
    public const string Hour = "hour";
    public const string Day = "day";

    public static readonly string[] All = [Hour, Day];

    public static bool IsValid(string value) => All.Contains(value);
}

public static class BackgroundCheckStatuses
{
    public const string Verified = "verified";
    public const string Pending = "pending";
    public const string None = "none";

    public static readonly string[] All = [Verified, Pending, None];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// The booking lifecycle (REQUIREMENTS.md §11.1).
///
/// The transition table and the actor table live in
/// <see cref="Services.BookingService"/>, not here, because they are rules.
/// This is only the vocabulary.
/// </summary>
public static class BookingStatuses
{
    public const string Requested = "requested";
    public const string Accepted = "accepted";
    public const string Declined = "declined";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Cancelled = "cancelled";

    public static readonly string[] All =
        [Requested, Accepted, Declined, InProgress, Completed, Cancelled];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// What a review is about.
///
/// One table serves both, with <c>reviews."bookingId"</c> holding whichever
/// subject the review concerns and <c>kind</c> saying which — so a vet's
/// reviews and a caretaker's can never be mistaken for each other even when one
/// person is both.
///
/// They differ in direction on purpose. A booking is reviewed <b>both ways</b>:
/// the owner and the caretaker each judge how the other behaved. A vet visit is
/// reviewed <b>one way only</b> — a clinician rating the client would be a
/// different and much worse product.
/// </summary>
public static class ReviewKinds
{
    public const string Booking = "booking";
    public const string VetAppointment = "vet_appointment";

    public static readonly string[] All = [Booking, VetAppointment];

    public static bool IsValid(string value) => All.Contains(value);
}
