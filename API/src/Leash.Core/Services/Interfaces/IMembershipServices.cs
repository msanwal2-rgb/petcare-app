using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// The read side of Leash Plus: is this person a member right now, and what
/// does that entitle them to (REQUIREMENTS.md M11, M12).
///
/// <b>The session carries identity and nothing else.</b> Membership is read
/// from the database in the same request that prices the thing it affects. A
/// <c>plus: true</c> claim in a thirty-day cookie would keep asserting itself
/// after a cancellation or a failed renewal for as long as the cookie lived.
/// </summary>
public interface IEntitlementService
{
    /// <param name="now">Defaults to the clock; the tests pass a moment past the period or the grace window.</param>
    Task<MembershipDto> GetMembershipAsync(
        string userId, DateTimeOffset? now = null, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<bool> HasEntitlementAsync(
        string userId, string entitlement, DateTimeOffset? now = null, ITransactionScope? scope = null,
        CancellationToken ct = default);

    /// <summary>The lead time this caller faces (C13), and the one a member would.</summary>
    Task<LeadTimeWindow> LeadTimeWindowAsync(string userId, DateTimeOffset now, CancellationToken ct = default);
}

/// <summary>
/// Provider truth about a subscription, as the reconciler takes it — from a
/// <c>customer.subscription.*</c> webhook, from a sync, or from the demo
/// provider settling inline.
/// </summary>
public sealed record SubscriptionSnapshot(
    string ProviderRef,
    string Provider,
    string ProviderCustomerId,
    string Status,
    DateTimeOffset CurrentPeriodStart,
    DateTimeOffset CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    DateTimeOffset? CanceledAt,
    DateTimeOffset? EndedAt,
    string LatestInvoiceRef,
    string PlanId,
    string UserId);

public enum SnapshotFailure { Stale, UnknownPlan }

public sealed record SnapshotResult(bool Ok, bool Changed, string? SubscriptionId, SnapshotFailure? Failure = null);

/// <summary>
/// Where provider truth about a membership becomes ours — the only writer of
/// <c>subscriptions</c>, and of membership invoices in the ledger. The webhook,
/// the sync and the demo checkout all come through here (M3).
/// </summary>
public interface ISubscriptionReconciler
{
    /// <summary>
    /// Write a snapshot, last-writer-wins by <b>event time</b>. Subscription
    /// payloads carry complete state, so overwriting wholesale is right — but
    /// only if "last" means most recently <i>created</i>: a delayed
    /// <c>past_due</c> landing after a later renewal would otherwise strip a
    /// paying member's benefits. Announces what a member would want to know,
    /// in the same transaction.
    /// </summary>
    Task<SnapshotResult> ApplyAsync(SubscriptionSnapshot snapshot, DateTimeOffset eventAt, CancellationToken ct = default);

    /// <summary>
    /// A ledger row for a paid membership invoice, once per invoice reference.
    /// No notification: nobody wants a monthly "we charged you" in their bell.
    /// </summary>
    Task<bool> RecordInvoiceAsync(
        string userId, string provider, string invoiceRef, string customerRef,
        int amountCents, string currency, CancellationToken ct = default);

    Task<string?> FindUserForCustomerAsync(string customerRef, CancellationToken ct = default);

    Task<PlanEntity?> PlanForPriceAsync(string priceId, CancellationToken ct = default);

    Task LinkCustomerAsync(string userId, string customerRef, CancellationToken ct = default);
}

public enum MembershipFailure
{
    /// <summary>The plan cannot be bought, or the feature is not there on this provider. 503 (M14).</summary>
    NotAvailable,

    /// <summary>409.</summary>
    AlreadyMember,

    /// <summary>Nothing live to cancel. 409.</summary>
    NoMembership,

    /// <summary>No scheduled cancellation to undo. 409.</summary>
    NothingToResume,

    /// <summary>No customer at the provider yet, so no portal. 409.</summary>
    NoBillingHistory,

    /// <summary>The provider call failed. 502.</summary>
    ProviderFailed,
}

/// <summary>Leash Plus as the member drives it (REQUIREMENTS.md M13). Every method acts on the caller only.</summary>
public interface IMembershipService
{
    Task<MembershipViewDto> GetViewAsync(string callerId, CancellationToken ct = default);

    /// <summary>
    /// Start a membership. Stripe returns its hosted checkout page and the
    /// webhook is the truth; the demo provider settles inline through the
    /// reconciler and returns the membership page.
    /// </summary>
    Task<(RedirectDto? Redirect, MembershipFailure? Failure)> CheckoutAsync(
        string callerId, CancellationToken ct = default);

    /// <summary>Cancel at the end of the period already paid for — they bought the month, they keep it.</summary>
    Task<(MembershipCancelledDto? Cancelled, MembershipFailure? Failure)> CancelAsync(
        string callerId, CancellationToken ct = default);

    Task<MembershipFailure?> ResumeAsync(string callerId, CancellationToken ct = default);

    /// <summary>The provider's own billing portal. Card data is never handled here.</summary>
    Task<(RedirectDto? Redirect, MembershipFailure? Failure)> PortalAsync(
        string callerId, CancellationToken ct = default);

    /// <summary>The escape hatch for a slow or lost webhook. Same reconciler; safe to repeat.</summary>
    Task<(MembershipDto? Membership, MembershipFailure? Failure)> SyncAsync(
        string callerId, CancellationToken ct = default);
}
