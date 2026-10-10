using Leash.Core.Models.Enums;

namespace Leash.Core.Services;

/// <summary>
/// Order lifecycle facts: how long each fulfilment stage takes, and how late a
/// customer may still cancel (REQUIREMENTS.md S15, S16).
///
/// Consulted from three places that must not disagree — the order service
/// (which enforces), the fulfilment job (which advances), and the order page
/// (which decides whether to show a Cancel button, mirrored in
/// <c>web/src/lib/delivery.ts</c>). The reference implementation kept these in
/// a dependency-free module for the same reason: a hand-copied list drifts the
/// first time somebody edits one of them.
/// </summary>
public static class Delivery
{
    /// <summary>
    /// How long after being placed an order reaches each stage. Loosely a
    /// two-to-three-day courier, compressed so that a demo order placed in the
    /// morning has visibly moved by the afternoon.
    /// </summary>
    public static readonly (string Status, int AfterHours)[] Schedule =
    [
        (OrderStatuses.Processing, 1),
        (OrderStatuses.Packed, 6),
        (OrderStatuses.Shipped, 24),
        (OrderStatuses.OutForDelivery, 48),
        (OrderStatuses.Delivered, 60),
    ];

    /// <summary>The happy path, in order, starting from a settled payment.</summary>
    public static readonly string[] Journey =
        [OrderStatuses.Paid, .. Schedule.Select(s => s.Status)];

    /// <summary>The furthest stage an order placed at <paramref name="placedAt"/> has earned by <paramref name="now"/>.</summary>
    public static string EarnedStatus(DateTimeOffset placedAt, DateTimeOffset now)
    {
        var hours = (now - placedAt).TotalHours;
        var earned = OrderStatuses.Paid;

        foreach (var (status, afterHours) in Schedule)
            if (hours >= afterHours) earned = status;

        return earned;
    }

    /// <summary>
    /// Statuses a customer may still cancel from themselves. Once a parcel is
    /// with the carrier it is out of our hands, and the answer is a return or a
    /// refused delivery rather than a cancellation.
    ///
    /// Note this is narrower than the transition table: staff may still move a
    /// <c>shipped</c> order to <c>refunded</c>. The window is about what a
    /// customer can do from a button, not about what is possible.
    /// </summary>
    public static readonly string[] CustomerCancellable =
    [
        OrderStatuses.PendingPayment, OrderStatuses.Paid,
        OrderStatuses.Processing, OrderStatuses.Packed,
    ];

    public static bool CanCustomerCancel(string status) => CustomerCancellable.Contains(status);

    /// <summary>
    /// Statuses after which the goods have left the building. Leaving one of
    /// these for <c>cancelled</c> or <c>refunded</c> must <b>not</b> restock —
    /// the items are in a van or a kitchen, and crediting inventory for them
    /// would sell the same bag twice. <c>delivered → refunded</c> is a legal
    /// transition, so this is reachable rather than theoretical.
    /// </summary>
    public static readonly string[] ShippedOut =
        [OrderStatuses.Shipped, OrderStatuses.OutForDelivery, OrderStatuses.Delivered];

    /// <summary>
    /// How long an unpaid order holds its stock. Long enough for a bank's 3-D
    /// Secure challenge and a fumbled card number; short enough that an
    /// abandoned tab does not keep a popular product sold out for an afternoon.
    /// </summary>
    public static readonly TimeSpan ReservationTtl = TimeSpan.FromMinutes(15);

    /// <summary>Three days out at 22:00 UTC — what the fulfilment schedule above actually hits.</summary>
    public static DateTimeOffset EstimatedDelivery(DateTimeOffset placedAt)
    {
        var day = placedAt.UtcDateTime.Date.AddDays(3);
        return new DateTimeOffset(day.AddHours(22), TimeSpan.Zero);
    }

    /// <summary>
    /// Deterministic from the order id, so a re-run of the fulfilment job never
    /// renumbers a parcel somebody is already tracking.
    /// </summary>
    public static string TrackingNumberFor(string orderId)
    {
        var digits = new string(orderId.Where(char.IsAsciiDigit).ToArray());
        digits = (digits.Length > 8 ? digits[^8..] : digits).PadLeft(8, '0');
        return $"LEASH-{digits[..4]}-{digits[4..]}";
    }
}
