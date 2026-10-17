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
}
