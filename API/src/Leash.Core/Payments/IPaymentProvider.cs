namespace Leash.Core.Payments;

/// <summary>Provider-side intent states, normalised across providers.</summary>
public static class IntentStatuses
{
    public const string RequiresPaymentMethod = "requires_payment_method";
    public const string RequiresAction = "requires_action";
    public const string Processing = "processing";
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
/// </summary>
public sealed record PaymentIntent(
    string Ref, string Status, int AmountCents, string Currency, string? ClientSecret);

public sealed record RefundResult(bool Succeeded, int AmountCents);

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
/// ── What M6 has, and what M7 brings ──
///
/// M6 ships <see cref="DemoPaymentProvider"/> only. M7 adds the Stripe
/// implementation, the webhook that reconciles an asynchronous intent, the
/// payment transition table, and refunds that write a retryable ledger row
/// <i>before</i> they call the provider. Nothing in <c>OrderService</c> needs
/// to change shape for that — it already creates the order before it creates
/// the intent, which is the ordering a real card requires.
/// </summary>
public interface IPaymentProvider
{
    /// <summary>Stored on the payment row. <c>demo</c> matches the seeded ledger.</summary>
    string Name { get; }

    /// <summary>True when the truth arrives by webhook rather than in the call.</summary>
    bool Asynchronous { get; }

    /// <summary>
    /// Create an intent for <paramref name="amountCents"/>.
    /// <paramref name="idempotencyKey"/> is the order id: a retried checkout
    /// must reuse the intent rather than mint a second charge for one basket.
    /// </summary>
    Task<PaymentIntent> CreateIntentAsync(
        int amountCents, string currency, string orderId, string userId,
        string idempotencyKey, CancellationToken ct = default);

    Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default);

    Task<RefundResult> RefundAsync(
        string reference, int amountCents, string idempotencyKey,
        CancellationToken ct = default);
}

/// <summary>
/// A provider that always succeeds, immediately.
///
/// The seeded ledger already uses it — every seeded payment is provider
/// <c>demo</c> with a <c>demo_pay_*</c> reference — so orders placed in M6 sit
/// beside those rows rather than looking like a different system.
///
/// The reference is deterministic from the order id, so a retried intent for
/// the same order is the same intent, which is the idempotency a real provider
/// enforces with its own key.
/// </summary>
public sealed class DemoPaymentProvider : IPaymentProvider
{
    public string Name => "demo";

    public bool Asynchronous => false;

    public Task<PaymentIntent> CreateIntentAsync(
        int amountCents, string currency, string orderId, string userId,
        string idempotencyKey, CancellationToken ct = default)
        => Task.FromResult(new PaymentIntent(
            $"demo_pay_{idempotencyKey}", IntentStatuses.Succeeded, amountCents, currency,
            ClientSecret: null));

    public Task<PaymentIntent> GetIntentAsync(string reference, CancellationToken ct = default)
        => Task.FromResult(new PaymentIntent(
            reference, IntentStatuses.Succeeded, 0, "usd", ClientSecret: null));

    public Task<RefundResult> RefundAsync(
        string reference, int amountCents, string idempotencyKey,
        CancellationToken ct = default)
        => Task.FromResult(new RefundResult(true, amountCents));
}
