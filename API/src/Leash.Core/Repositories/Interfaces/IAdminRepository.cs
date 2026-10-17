using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// The console's reads and its account writes. Its own repository, for the
/// reason <see cref="IAccessRepository"/> is: these projections exist for
/// staff, and nothing a feature team does to the marketplace repositories
/// should widen one of them. Lists are keyset-paged and return the total for
/// the filter; searches escape LIKE wildcards.
/// </summary>
public interface IAdminRepository
{
    Task<(IReadOnlyList<AdminUserRow> Rows, string? NextCursor, int Total)> SearchUsersAsync(
        AdminUserQuery query, int limit, CancellationToken ct = default);

    Task<AdminUserRow?> GetUserAsync(string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<AdminUserCountsDto> CountUserActivityAsync(string id, CancellationToken ct = default);

    Task<IReadOnlyList<AdminOrderSummaryDto>> RecentOrdersAsync(string id, int limit, CancellationToken ct = default);

    Task<AdminCaretakerProfileDto?> CaretakerProfileForAsync(string userId, CancellationToken ct = default);

    Task<AdminVetProfileDto?> VetProfileForAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// The active admins, row-locked. Taken before any change that could remove
    /// one, so two admins demoting each other at once serialise here and the
    /// second sees only one left.
    /// </summary>
    Task<IReadOnlyList<string>> LockActiveAdminsAsync(ITransactionScope scope, CancellationToken ct = default);

    Task SetVerifiedAsync(string id, bool verified, ITransactionScope scope, CancellationToken ct = default);
    Task SuspendAsync(string id, string reason, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default);
    Task ReactivateAsync(string id, ITransactionScope scope, CancellationToken ct = default);
    Task BumpSessionsAsync(string id, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default);
    Task SetRolesAsync(string id, string[] roles, ITransactionScope scope, CancellationToken ct = default);
    Task SetStaffRolesAsync(string id, string[] staffRoles, ITransactionScope scope, CancellationToken ct = default);

    /// <summary>Keep the row, scrub the person (A16). Email becomes a unique, unroutable placeholder.</summary>
    Task SoftDeleteAsync(string id, DateTimeOffset at, ITransactionScope scope, CancellationToken ct = default);

    // ── Professionals ────────────────────────────────────────────────────

    Task<(IReadOnlyList<AdminProfessionalEntity> Rows, string? NextCursor, int Total, int AwaitingReview)>
        SearchProfessionalsAsync(AdminProfessionalQuery query, int limit, CancellationToken ct = default);

    /// <summary>The profile's owner (id, email), or null when there is no such profile of that kind.</summary>
    Task<(string UserId, string Email)?> SetVerificationAsync(
        string kind, string profileId, string status, ITransactionScope scope, CancellationToken ct = default);

    // ── Finance ──────────────────────────────────────────────────────────

    Task<(IReadOnlyList<AdminPaymentEntity> Rows, string? NextCursor, int Total, long Captured, long Refunded)>
        SearchPaymentsAsync(AdminPaymentQuery query, int limit, CancellationToken ct = default);

    Task<IReadOnlyList<RefundEntity>> RefundsForAsync(IReadOnlyCollection<string> paymentIds, CancellationToken ct = default);

    Task<(IReadOnlyList<AdminSubscriptionEntity> Rows, string? NextCursor, int Total, int ActiveCount, long MrrCents)>
        SearchSubscriptionsAsync(AdminSubscriptionQuery query, int limit, CancellationToken ct = default);

    Task<AdminSubscriptionEntity?> GetSubscriptionForUpdateAsync(string id, ITransactionScope scope, CancellationToken ct = default);

    Task UpdateSubscriptionAsync(
        string id, bool cancelAtPeriodEnd, string status, DateTimeOffset? canceledAt, DateTimeOffset? endedAt,
        DateTimeOffset? graceEndsAt, DateTimeOffset updatedAt, DateTimeOffset? lastEventAt,
        ITransactionScope scope, CancellationToken ct = default);

    // ── Overview ─────────────────────────────────────────────────────────

    Task<AdminStatsDto> StatsAsync(DateTimeOffset now, CancellationToken ct = default);
}

/// <summary><c>admin_audit_log</c>.</summary>
public interface IAuditRepository
{
    Task InsertAsync(
        string actorUserId, string action, string targetType, string targetId, string summary,
        string? metadataJson, string ip, DateTimeOffset at, ITransactionScope? scope = null,
        CancellationToken ct = default);

    Task<(IReadOnlyList<AuditEntryEntity> Rows, string? NextCursor, int Total)> ListAsync(
        AdminAuditQuery query, int limit, CancellationToken ct = default);
}
