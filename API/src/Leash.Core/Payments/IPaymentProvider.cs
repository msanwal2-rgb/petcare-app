namespace Leash.Core.Payments;

/// <summary>Provider-side intent states, normalised across providers.</summary>
public static class IntentStatuses
{
    public const string RequiresPaymentMethod = "requires_payment_method";
    public const string RequiresAction = "requires_action";
    public const string Processing = "processing";

    /// <summary>Manual capture only. Unused today; mapped so turning it on is configuration.</summary>
    public const string Authorized = "authorized";

    public const string Succeeded = "succeeded";
    public const string Canceled = "canceled";
    public const string Failed = "failed";
}

/// <summary>
/// What the provider says about one payment.
///
/// <see cref="ClientSecret"/> is returned by <see cref="IPaymentProvider.CreateIntentAsync"/>
/// only, and only to the one browser about to confirm it. It authorises
/// confirming this payment, so it is never persisted and never logged.
/// <see cref="MethodBrand"/> and <see cref="MethodLast4"/> are for the receipt —
/// never a card number or a token.
/// </summary>
public sealed record PaymentIntent(
    string Ref,
    string Status,
    int AmountCents,
    string Currency,
    string? ClientSecret,
    string? FailureCode = null,
    string? FailureMessage = null,
    string? MethodBrand = null,
    string? MethodLast4 = null);

/// <summary>What <see cref="IPaymentProvider.CreateIntentAsync"/> needs.</summary>
/// <param name="IdempotencyKey">
/// The order id. A retried checkout must reuse the intent rather than mint a
/// second charge for one basket.
/// </param>
/// <param name="CustomerRef">
/// The customer's id at the provider, when they have one (REQUIREMENTS.md M15).
/// </param>
public sealed record IntentRequest(
    int AmountCents,
    string Currency,
    string OrderId,
    string UserId,
    string IdempotencyKey,
    string? CustomerRef = null);

/// <summary>
/// A refund as the provider reports it. <see cref="Status"/> is one of
/// <see cref="RefundStatuses"/>; a real provider usually says <c>pending</c>
/// and the <c>charge.refunded</c> webhook finishes the job.
/// </summary>
public sealed record ProviderRefund(string Ref, string Status, int AmountCents);

public static class RefundStatuses
{
    public const string Pending = "pending";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Canceled = "canceled";
}

/// <summary>Why money went back. Stripe accepts the first three; ours keeps all four.</summary>
public static class RefundReasons
{
    public const string RequestedByCustomer = "requested_by_customer";
    public const string Duplicate = "duplicate";
    public const string Fraudulent = "fraudulent";
    public const string OrderCancelled = "order_cancelled";

    public static readonly string[] All = [RequestedByCustomer, Duplicate, Fraudulent, OrderCancelled];
}

/// <summary>
/// A provider call that did not work.
///
/// <see cref="Definitive"/> separates "the provider said no" — a 4xx: the
/// charge is already refunded, the amount is wrong — from "we do not know what
/// happened": a timeout, a 5xx, a dropped connection. Only the second is worth
/// retrying, and only the second may have quietly succeeded on the provider's
/// side, which is why a refund in that state stays <c>pending</c> and is retried
/// under the same idempotency key rather than recorded as failed.
/// </summary>
public sealed class PaymentProviderException(string message, bool definitive, Exception? inner = null)
    : Exception(message, inner)
{
    public bool Definitive { get; } = definitive;
}

/// <summary>
/// The payment boundary. The store talks to this and never to a payment SDK.
///
/// ── The shape, and why it is not authorize-then-capture ──
///
/// The reference implementation started as two synchronous calls, which works
/// for a demo and cannot work for a card: the customer confirms in their own
/// browser, the bank may interpose a challenge, and the truth arrives later on
/// a webhook. So the interface is an <i>intent</i> — create one for the order's
/// total, and settlement is something that happens <i>to</i> the order rather
/// than something checkout does to it. <see cref="Asynchronous"/> says which
/// kind of provider is installed: the demo settles inline, a real card cannot.
///
/// Nothing behind this interface persists anything. Every state change lands
/// in the ledger through <c>IPaymentLedger.ApplyIntentStateAsync</c>, whether it
/// arrived from a webhook, from the order page's sync call, or inline from the
/// demo provider (REQUIREMENTS.md M3).
/// </summary>
public interface IPaymentProvider
{
    /// <summary>Stored on the payment row: <c>demo</c> or <c>stripe</c>.</summary>
    string Name { get; }

    /// <summary>True when the truth arrives by webhook rather than in the call.</summary>
    bool Asynchronous { get; }

    Task<PaymentIntent> CreateIntentAsync(IntentRequest request, CancellationToken ct = default);

    Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default);

    Task<PaymentIntent> CancelIntentAsync(string reference, CancellationToken ct = default);

    /// <param name="idempotencyKey">Our refund row's id: a retried refund is the same refund.</param>
    Task<ProviderRefund> RefundAsync(
        string reference, int amountCents, string? reason, string idempotencyKey,
        CancellationToken ct = default);
}

/// <summary>
/// A provider that always succeeds, immediately, and never touches money.
///
/// It stays because it is what makes the seeded demo data, the walks and most of
/// the suite runnable with no credential anywhere — and because
/// <see cref="Asynchronous"/> = false routes it through the <i>same</i>
/// reconciler the webhook uses, rather than a second path only the demo takes.
///
/// The reference is deterministic from the order id, so a retried intent for
/// the same order is the same intent — the idempotency a real provider enforces
/// with its own key. Every seeded payment is provider <c>demo</c> with a
/// <c>demo_pay_*</c> reference, so new orders sit beside those rows.
/// </summary>
public sealed class DemoPaymentProvider : IPaymentProvider
{
    public string Name => "demo";

    public bool Asynchronous => false;

    public Task<PaymentIntent> CreateIntentAsync(IntentRequest request, CancellationToken ct = default)
    {
        if (request.AmountCents <= 0)
            throw new PaymentProviderException("Cannot charge a non-positive amount", definitive: true);

        return Task.FromResult(new PaymentIntent(
            $"demo_pay_{request.IdempotencyKey}", IntentStatuses.Succeeded,
            request.AmountCents, request.Currency, ClientSecret: null,
            MethodBrand: "demo", MethodLast4: "0000"));
    }

    /// <summary>
    /// The amount is reported as zero, which the ledger reads as "the provider
    /// did not say" — the same convention the reference used — so a sync of a
    /// demo payment never trips the amount check.
    /// </summary>
    public Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default)
        => Task.FromResult(new PaymentIntent(
            reference, IntentStatuses.Succeeded, 0, "usd", ClientSecret: null));

    public Task<PaymentIntent> CancelIntentAsync(string reference, CancellationToken ct = default)
        => Task.FromResult(new PaymentIntent(
            reference, IntentStatuses.Canceled, 0, "usd", ClientSecret: null));

    public Task<ProviderRefund> RefundAsync(
        string reference, int amountCents, string? reason, string idempotencyKey,
        CancellationToken ct = default)
        => Task.FromResult(new ProviderRefund(
            $"demo_re_{idempotencyKey}", RefundStatuses.Succeeded, amountCents));
}
