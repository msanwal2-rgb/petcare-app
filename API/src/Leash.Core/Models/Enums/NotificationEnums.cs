namespace Leash.Core.Models.Enums;

/// <summary>
/// Notification kinds (REQUIREMENTS.md N2). The same strings as the reference's
/// <c>NotificationKind</c> in <c>web/src/types</c>, because the bell keys its
/// icon on them.
/// </summary>
public static class NotificationKinds
{
    public const string BookingAccepted = "booking_accepted";
    public const string BookingDeclined = "booking_declined";
    public const string AppointmentConfirmed = "appointment_confirmed";
    public const string AppointmentDeclined = "appointment_declined";
    public const string AppointmentCompleted = "appointment_completed";

    /// <summary>The vet moved the visit to a new time. New with the dashboard calendar.</summary>
    public const string AppointmentRescheduled = "appointment_rescheduled";
    public const string OrderShipped = "order_shipped";
    public const string OrderOutForDelivery = "order_out_for_delivery";
    public const string OrderDelivered = "order_delivered";
    public const string OrderPaymentFailed = "order_payment_failed";
    public const string MembershipStarted = "membership_started";
    public const string MembershipPaymentFailed = "membership_payment_failed";
    public const string MembershipCancelled = "membership_cancelled";
    public const string MembershipEnded = "membership_ended";
    public const string AdoptionApplicationReceived = "adoption_application_received";
    public const string AdoptionUnderReview = "adoption_under_review";
    public const string AdoptionApproved = "adoption_approved";
    public const string AdoptionRejected = "adoption_rejected";
    public const string AdoptionCompleted = "adoption_completed";
    public const string AdoptionReversed = "adoption_reversed";

    /// <summary>
    /// Staff verified a caretaker, vet or shelter (M9). New: the reference sent
    /// this as <c>membership_started</c>, which any consumer of the kind would
    /// have filed under Leash Plus.
    /// </summary>
    public const string ProfileVerified = "profile_verified";
}

/// <summary>
/// Where a notification goes (REQUIREMENTS.md N3).
///
/// <c>in_app</c> is the <c>notifications</c> row itself — written in the same
/// transaction as the thing it announces, and what the bell reads. The others
/// are out-of-band and go through <c>notification_outbox</c>, one row per
/// channel, delivered by a background drain.
/// </summary>
public static class NotificationChannels
{
    public const string InApp = "in_app";
    public const string Email = "email";
    public const string Push = "push";
}

/// <summary>A delivery's state in <c>notification_outbox</c>.</summary>
public static class OutboxStatuses
{
    /// <summary>Owed. Picked up by the next drain whose clock is past <c>nextAttemptAt</c>.</summary>
    public const string Pending = "pending";

    public const string Sent = "sent";

    /// <summary>Gave up after the last retry. Kept, with <c>lastError</c>, for whoever looks.</summary>
    public const string Failed = "failed";

    /// <summary>Not attempted: the recipient is no longer active, or the channel was switched off.</summary>
    public const string Skipped = "skipped";
}
