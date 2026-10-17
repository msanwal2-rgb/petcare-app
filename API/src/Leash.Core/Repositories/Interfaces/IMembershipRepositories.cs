using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary><c>plans</c>, <c>subscriptions</c>, and the provider customer id on <c>users</c>.</summary>
public interface ISubscriptionRepository
{
    Task<PlanEntity?> GetPlanByKeyAsync(string key, ITransactionScope? scope = null, CancellationToken ct = default);
    Task<PlanEntity?> GetPlanByIdAsync(string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Null for an empty price id — an unconfigured plan must never match an empty one.</summary>
    Task<PlanEntity?> GetPlanByPriceIdAsync(string priceId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The user's subscription most likely to carry benefits: one in a live
    /// status, latest period end first, with its plan.
    /// </summary>
    Task<SubscriptionWithPlanEntity?> GetLiveForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The user's newest subscription, whatever state it is in.</summary>
    Task<SubscriptionEntity?> GetLatestForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<SubscriptionEntity?> GetByProviderRefForUpdateAsync(
        string providerRef, ITransactionScope scope, CancellationToken ct = default);

    Task InsertAsync(SubscriptionEntity subscription, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Overwrite everything the provider owns. <c>id</c>, <c>provider</c>, <c>providerRef</c>, <c>createdAt</c> stay.</summary>
    Task UpdateAsync(SubscriptionEntity subscription, ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetCancelAtPeriodEndAsync(
        string id, bool value, DateTimeOffset updatedAt, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<string?> GetCustomerIdAsync(string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetCustomerIdAsync(string userId, string customerId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<string?> FindUserByCustomerIdAsync(string customerId, ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary><c>webhook_events</c>. The claim protocol is <c>WebhookEventStore</c>'s.</summary>
public interface IWebhookEventRepository
{
    /// <summary>
    /// Insert the event already claimed (<c>received</c>, one attempt, locked
    /// now). False when a row with this id exists — the race becomes a value to
    /// branch on rather than an exception to interpret.
    /// </summary>
    Task<bool> TryInsertClaimedAsync(
        string id, string type, string apiVersion, DateTimeOffset eventAt, string payloadJson,
        DateTimeOffset now, CancellationToken ct = default);

    Task<WebhookEventEntity?> GetAsync(string id, CancellationToken ct = default);

    /// <summary>
    /// Re-claim: one more attempt, locked now, back to <c>received</c> — but
    /// only if the row is still as <paramref name="seen"/> found it, so two
    /// workers reclaiming the same dead event cannot both win.
    /// </summary>
    Task<int?> TryReclaimAsync(string id, WebhookEventEntity seen, DateTimeOffset now, CancellationToken ct = default);

    Task SetOutcomeAsync(string id, string status, string error, DateTimeOffset? processedAt, CancellationToken ct = default);

    Task<int> PurgeSettledAsync(DateTimeOffset receivedBefore, CancellationToken ct = default);
}
