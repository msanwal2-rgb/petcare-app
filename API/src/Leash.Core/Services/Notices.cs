using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Services;

/// <summary>
/// What each status machine says, and to whom — the reference's
/// <c>BOOKING_NOTICES</c>, <c>APPOINTMENT_NOTICES</c> and
/// <c>DELIVERY_NOTICES</c>, word for word. A status with no entry is silent on
/// purpose:
///
///  - <b>a cancellation</b> — whoever cancelled already knows, and the other
///    side sees it on the booking;
///  - <b>picking and packing</b> — warehouse noise nobody wants interrupted for;
///  - <b>an appointment starting</b> — the owner is in the room.
///
/// Each href deep-links to the thing it is about (N9), on the SPA's own routes.
/// </summary>
public static class Notices
{
    public static NotifyInput? ForBooking(string bookingId, string status) => status switch
    {
        BookingStatuses.Accepted => new(
            NotificationKinds.BookingAccepted,
            "Your booking was accepted",
            "Your caretaker has confirmed. You can message them from the booking.",
            $"/booking/{bookingId}"),
        BookingStatuses.Declined => new(
            NotificationKinds.BookingDeclined,
            "Your booking request was declined",
            "They couldn't take this one — plenty of other caretakers are free.",
            $"/booking/{bookingId}"),
        _ => null,
    };

    /// <summary>
    /// The body quotes the owner's own <paramref name="reason"/> back to them.
    /// That is user-controlled text, which is why the email renderer escapes
    /// the body (N5) rather than trusting it as copy.
    /// </summary>
    public static NotifyInput? ForAppointment(string appointmentId, string status, string reason)
        => status switch
        {
            AppointmentStatuses.Confirmed => new(
                NotificationKinds.AppointmentConfirmed,
                "Your vet appointment is confirmed",
                $"{reason} — see the appointment for the time and what to bring.",
                $"/appointments/{appointmentId}"),
            AppointmentStatuses.Declined => new(
                NotificationKinds.AppointmentDeclined,
                "Your vet couldn't take that appointment",
                $"{reason} — you can request another time or find a different vet.",
                $"/appointments/{appointmentId}"),
            AppointmentStatuses.Completed => new(
                NotificationKinds.AppointmentCompleted,
                "Your visit summary is ready",
                $"{reason} — notes and any prescriptions are in your pet's health record.",
                $"/appointments/{appointmentId}"),
            _ => null,
        };

    /// <summary>
    /// The vet moved the visit. The new time is not in the text: the server
    /// does not know the owner's time zone, and a time in the wrong one is
    /// worse than none — the appointment page shows it in theirs. Like
    /// <see cref="ForAppointment"/>, the body quotes the owner's own reason.
    /// </summary>
    public static NotifyInput AppointmentRescheduled(string appointmentId, string reason) => new(
        NotificationKinds.AppointmentRescheduled,
        "Your vet appointment has a new time",
        $"{reason} — your vet moved it. Check the new time still works; if it doesn't, you can cancel from the appointment.",
        $"/appointments/{appointmentId}");

    /// <summary>
    /// A guest's caretaker request went through (STATUS §3-G). No time in the
    /// text, for the same reason as <see cref="AppointmentRescheduled"/>. The
    /// href is the booking page, for the bell once they have an account; the
    /// email points a guest at account setup instead (NotificationEmail).
    /// </summary>
    public static NotifyInput GuestBookingRequested(string bookingId, string caretakerName, string petName) => new(
        NotificationKinds.BookingRequested,
        $"We've sent your request to {caretakerName}",
        $"Your request for {petName} is with them now. We'll email you when they accept or decline.",
        $"/booking/{bookingId}");

    /// <summary>A guest's vet visit request went through. The body quotes their own reason.</summary>
    public static NotifyInput GuestAppointmentRequested(string appointmentId, string vetName, string petName, string reason) => new(
        NotificationKinds.AppointmentRequested,
        $"We've sent your visit request to {vetName}",
        $"{reason} — for {petName}. We'll email you when the clinic confirms or declines.",
        $"/appointments/{appointmentId}");

    /// <summary>A declined card, not a cancellation: the intent stays retryable.</summary>
    public static NotifyInput OrderPaymentFailed(string orderId) => new(
        NotificationKinds.OrderPaymentFailed,
        "Your payment didn't go through",
        "Your order is held for a short while — you can try a different card.",
        $"/store/orders/{orderId}");

    /// <summary>
    /// What a member hears when their subscription changes state. Silent on a
    /// successful renewal — nobody wants a monthly "we charged you" in their
    /// bell, and Stripe emails the receipt.
    /// </summary>
    public static NotifyInput? ForMembership(string? from, string to)
    {
        if (from == to) return null;

        return to switch
        {
            SubscriptionStatuses.Active when from is null or SubscriptionStatuses.Incomplete => new(
                NotificationKinds.MembershipStarted,
                "Welcome to Leash Plus",
                "Free delivery, a discount on every vet consultation, and same-day booking.",
                "/account/membership"),
            SubscriptionStatuses.PastDue => new(
                NotificationKinds.MembershipPaymentFailed,
                "We couldn't renew your membership",
                $"Your card was declined. Your benefits continue for {Entitlements.DunningGraceDays} days while we retry — update your card to keep them.",
                "/account/membership"),
            SubscriptionStatuses.Canceled => new(
                NotificationKinds.MembershipEnded,
                "Your Leash Plus membership has ended",
                "Free delivery and the consultation discount no longer apply. You can rejoin any time.",
                "/plus"),
            _ => null,
        };
    }

    public static NotifyInput MembershipCancelled(DateTimeOffset endsAt) => new(
        NotificationKinds.MembershipCancelled,
        "Your membership will end",
        $"Leash Plus stays active until {endsAt:yyyy-MM-dd}. You can change your mind before then.",
        "/account/membership");

    /// <summary>The one thing no subscription event conveys: the bank wants the member to act.</summary>
    public static NotifyInput MembershipActionRequired() => new(
        NotificationKinds.MembershipPaymentFailed,
        "Your bank needs to confirm your membership payment",
        "Open your billing settings to approve it.",
        "/account/membership");

    public static NotifyInput? ForOrder(string orderId, string status) => status switch
    {
        OrderStatuses.Shipped => new(
            NotificationKinds.OrderShipped,
            "Your order is on its way",
            "It's with the carrier — track it any time from your orders.",
            $"/store/orders/{orderId}"),
        OrderStatuses.OutForDelivery => new(
            NotificationKinds.OrderOutForDelivery,
            "Your order is out for delivery",
            "It's on the van and should arrive today.",
            $"/store/orders/{orderId}"),
        OrderStatuses.Delivered => new(
            NotificationKinds.OrderDelivered,
            "Your order was delivered",
            "Left at your delivery address. Let us know if anything's missing.",
            $"/store/orders/{orderId}"),
        _ => null,
    };

    // ── Adoption (M10) ────────────────────────────────────────────────────
    // The reference's APPLICATION_NOTICES and the transfer's notices, word for
    // word. One href differs: the reference linked an application to
    // /adoptions/applications/{id}, which no page served; the application page
    // is /adoptions/{id} (N9).

    /// <summary>To the shelter. The applicant watches their own application page.</summary>
    public static NotifyInput ApplicationReceived(string petName) => new(
        NotificationKinds.AdoptionApplicationReceived,
        $"New application for {petName}",
        "Someone would like to adopt. Their answers are in your queue.",
        "/dashboard");

    /// <summary>What the applicant hears when the shelter moves their application. A withdrawal is theirs and silent.</summary>
    public static NotifyInput? ForApplication(string applicationId, string status, string petName) => status switch
    {
        ApplicationStatuses.UnderReview => new(
            NotificationKinds.AdoptionUnderReview,
            $"Your application for {petName} is being reviewed",
            "The shelter has picked it up. They'll be in touch.",
            $"/adoptions/{applicationId}"),
        ApplicationStatuses.Approved => new(
            NotificationKinds.AdoptionApproved,
            $"You've been approved to adopt {petName}",
            "One step left — settle the adoption fee and arrange collection.",
            $"/adoptions/{applicationId}"),
        ApplicationStatuses.Rejected => new(
            NotificationKinds.AdoptionRejected,
            $"Your application for {petName} wasn't successful",
            "The shelter has left a note explaining why.",
            $"/adoptions/{applicationId}"),
        _ => null,
    };

    public static NotifyInput AdoptionCompleted(string petId, string petName, string shelterName) => new(
        NotificationKinds.AdoptionCompleted,
        $"{petName} is yours",
        $"{shelterName} has completed the adoption. {petName}'s health record has come with them.",
        $"/dashboard/pets/{petId}");

    /// <summary>To everyone else who applied for an animal that has just gone home.</summary>
    public static NotifyInput AdoptionClosed(string petName) => new(
        NotificationKinds.AdoptionRejected,
        $"{petName} has found a home",
        "Your application has been closed. There are other animals waiting.",
        "/adopt");

    /// <summary>The body is the staff member's reason — user-controlled text, escaped by the email renderer (N5).</summary>
    public static NotifyInput AdoptionReversed(string petName, string shelterName, string reason) => new(
        NotificationKinds.AdoptionReversed,
        $"{petName} has returned to {shelterName}",
        reason,
        "/adopt");
}
