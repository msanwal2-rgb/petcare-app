using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

public enum AdminFailure
{
    /// <summary>Signed in, but without the staff role this needs. 403 with an explanation (D2) — never 404.</summary>
    NotStaff,
    /// <summary>404.</summary>
    NotFound,
    /// <summary>Your own staff access, or your own account. 403.</summary>
    SelfEdit,
    /// <summary>It would leave no active admin. 409.</summary>
    LastAdmin,
    /// <summary>The thing is in a state the action does not apply to. 409.</summary>
    Conflict,
    /// <summary>The payment provider failed. 502.</summary>
    ProviderFailed,
}

/// <summary>Why the console said no, and a sentence a member of staff can act on.</summary>
public sealed record AdminRefusal(AdminFailure Kind, string Message)
{
    public static AdminRefusal NeedsRole(string role) => new(AdminFailure.NotStaff,
        role == AnyStaff
            ? "This is the staff console, and your account is not staff."
            : $"This needs the \"{role}\" staff role, which your account does not have.");

    /// <summary>The pseudo-role "any staff role at all" — the overview.</summary>
    public const string AnyStaff = "*";
}

/// <summary>
/// The admin audit trail (REQUIREMENTS.md D3) — the one way an entry is
/// written, so no action can be added that forgets it.
/// </summary>
public interface IAuditLog
{
    /// <summary>
    /// Record an action. Pass the action's own transaction: the entry then
    /// commits if and only if the action does — an action that happened with
    /// no record of who did it reads, afterwards, exactly like an intrusion.
    /// </summary>
    Task RecordAsync(
        StaffActor actor, string action, string targetType, string targetId, string summary,
        object? metadata = null, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The log, newest first. <c>admin</c> only: it is a record of what colleagues did.</summary>
    Task<(AdminAuditPage? Page, AdminRefusal? Refusal)> ListAsync(
        string callerId, AdminAuditQuery query, CancellationToken ct = default);
}

/// <summary>
/// Users (<c>support</c>; staff roles and deletion <c>admin</c>). Every method
/// checks the caller's role itself (D1) — hiding a tab is courtesy only — and
/// every mutation writes the audit row in its own transaction (D3).
/// </summary>
public interface IAdminUserService
{
    Task<(AdminUserPage? Page, AdminRefusal? Refusal)> SearchAsync(
        string callerId, AdminUserQuery query, CancellationToken ct = default);

    Task<(AdminUserDetailDto? Detail, AdminRefusal? Refusal)> GetAsync(
        string callerId, string userId, CancellationToken ct = default);

    /// <summary>
    /// One action. Suspending and signing out bump <c>sessionsValidFrom</c> and
    /// revoke every refresh token in one transaction, so it bites on the user's
    /// next request (D5, A15). Staff roles: never your own (D4), never the last
    /// admin.
    /// </summary>
    Task<(UserDto? User, AdminRefusal? Refusal)> ApplyAsync(
        StaffActor actor, string userId, AdminUserActionRequest action, CancellationToken ct = default);

    /// <summary>Soft delete: the row stays so orders and reviews keep an author; the person is scrubbed.</summary>
    Task<(UserDto? User, AdminRefusal? Refusal)> DeleteAsync(
        StaffActor actor, string userId, CancellationToken ct = default);
}

/// <summary>
/// Verification of caretakers, vets and shelters (<c>support</c>). The only
/// writer of those badges (REQUIREMENTS.md V11): no self-service DTO carries them.
/// </summary>
public interface IAdminProfessionalService
{
    Task<(AdminProfessionalPage? Page, AdminRefusal? Refusal)> SearchAsync(
        string callerId, AdminProfessionalQuery query, CancellationToken ct = default);

    Task<AdminRefusal?> SetVerificationAsync(
        StaffActor actor, string profileId, AdminVerificationRequest request, CancellationToken ct = default);
}

/// <summary>The payments ledger and the members (<c>finance</c>).</summary>
public interface IAdminFinanceService
{
    Task<(AdminPaymentPage? Page, AdminRefusal? Refusal)> SearchPaymentsAsync(
        string callerId, AdminPaymentQuery query, CancellationToken ct = default);

    /// <summary>Through the ledger, so a console refund and a webhook refund are the same operation (M8).</summary>
    Task<(AdminRefundResultDto? Result, AdminRefusal? Refusal)> RefundAsync(
        StaffActor actor, string paymentId, AdminRefundRequest request, CancellationToken ct = default);

    Task<(AdminSubscriptionPage? Page, AdminRefusal? Refusal)> SearchSubscriptionsAsync(
        string callerId, AdminSubscriptionQuery query, CancellationToken ct = default);

    Task<AdminRefusal?> ApplySubscriptionActionAsync(
        StaffActor actor, string subscriptionId, AdminSubscriptionActionRequest request, CancellationToken ct = default);
}

/// <summary>The overview (any staff) and the runtime settings (<c>admin</c>).</summary>
public interface IAdminConsoleService
{
    Task<(AdminStatsDto? Stats, AdminRefusal? Refusal)> GetStatsAsync(
        string callerId, DateTimeOffset now, CancellationToken ct = default);

    Task<(SystemSettings? Settings, AdminRefusal? Refusal)> GetSettingsAsync(
        string callerId, CancellationToken ct = default);

    Task<(SystemSettings? Settings, AdminRefusal? Refusal)> UpdateSettingsAsync(
        StaffActor actor, SettingsPatchRequest patch, CancellationToken ct = default);
}
