using Leash.Core.Models.Enums;

namespace Leash.Core.Payments;

/// <summary>
/// The payment state machine (REQUIREMENTS.md M9), enforced regardless of
/// provider.
///
/// In the reference this table existed, was exported and unit-tested, and was
/// consulted by nothing — <c>paymentStatus</c> was written directly in two
/// places. A tested invariant nothing enforces reads as covered and is not.
/// Here every write of a payment's status goes through
/// <c>PaymentLedger</c>, which checks it.
/// </summary>
public static class PaymentTransitions
{
    private static readonly Dictionary<string, string[]> Table = new()
    {
        [PaymentStatuses.Unpaid] =
        [
            PaymentStatuses.Pending, PaymentStatuses.Processing, PaymentStatuses.RequiresAction,
            PaymentStatuses.Authorized, PaymentStatuses.Paid, PaymentStatuses.Failed,
        ],
        [PaymentStatuses.Pending] =
        [
            PaymentStatuses.RequiresAction, PaymentStatuses.Processing, PaymentStatuses.Authorized,
            PaymentStatuses.Paid, PaymentStatuses.Failed,
        ],
        [PaymentStatuses.RequiresAction] =
        [
            PaymentStatuses.Pending, PaymentStatuses.Processing, PaymentStatuses.Authorized,
            PaymentStatuses.Paid, PaymentStatuses.Failed,
        ],
        [PaymentStatuses.Processing] =
            [PaymentStatuses.Paid, PaymentStatuses.Authorized, PaymentStatuses.Failed],
        [PaymentStatuses.Authorized] =
            [PaymentStatuses.Paid, PaymentStatuses.Refunded, PaymentStatuses.Failed],
        [PaymentStatuses.Paid] =
            [PaymentStatuses.PartiallyRefunded, PaymentStatuses.Refunded, PaymentStatuses.Disputed],
        [PaymentStatuses.PartiallyRefunded] =
            [PaymentStatuses.Refunded, PaymentStatuses.Disputed],

        // A dispute can be won as well as lost.
        [PaymentStatuses.Disputed] = [PaymentStatuses.Refunded, PaymentStatuses.Paid],

        [PaymentStatuses.Refunded] = [],

        // A failed payment is retryable: Stripe keeps the intent alive and the
        // customer can try another card against the same order.
        [PaymentStatuses.Failed] =
        [
            PaymentStatuses.Pending, PaymentStatuses.RequiresAction, PaymentStatuses.Processing,
            PaymentStatuses.Authorized, PaymentStatuses.Paid,
        ],
    };

    /// <summary>A no-op is always allowed.</summary>
    public static bool CanTransition(string from, string to)
        => from == to || (Table.TryGetValue(from, out var next) && next.Contains(to));

    /// <summary>How a provider intent state maps onto our own payment status.</summary>
    public static string StatusForIntent(string intentStatus) => intentStatus switch
    {
        IntentStatuses.RequiresPaymentMethod => PaymentStatuses.Pending,
        IntentStatuses.RequiresAction => PaymentStatuses.RequiresAction,
        IntentStatuses.Processing => PaymentStatuses.Processing,
        IntentStatuses.Authorized => PaymentStatuses.Authorized,
        IntentStatuses.Succeeded => PaymentStatuses.Paid,
        _ => PaymentStatuses.Failed, // canceled, failed, anything unknown
    };

    /// <summary>Statuses holding money that a refund could send back.</summary>
    public static readonly string[] Refundable =
    [
        PaymentStatuses.Paid, PaymentStatuses.PartiallyRefunded,
        PaymentStatuses.Authorized, PaymentStatuses.Disputed,
    ];
}
