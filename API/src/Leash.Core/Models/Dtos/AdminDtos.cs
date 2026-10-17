using System.Text.Json;

namespace Leash.Core.Models.Dtos;

// The admin console's wire shapes, as web/src/types declares them. Every page
// is a keyset page (`nextCursor`, REQUIREMENTS.md §2.5) and also carries the
// `total` the screens print — a count over the filtered set is cheap, and the
// reference's console reads it.

/// <summary>A row in the user list. The presence of a credential, never the credential.</summary>
public sealed record AdminUserSummaryDto(
    string Id,
    string Name,
    string Email,
    string AvatarUrl,
    string[] Roles,
    string[] StaffRoles,
    string Status,
    bool Verified,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAt,
    string City,
    string State,
    string[] AuthMethods);

public sealed record AdminUserPage(AdminUserSummaryDto[] Items, string? NextCursor, int Total);

public sealed record AdminOrderSummaryDto(
    string Id, string Status, string PaymentStatus, int TotalCents, DateTimeOffset PlacedAt);

public sealed record AdminUserCountsDto(int Pets, int Bookings, int Appointments, int Orders, int UnreadNotifications);

public sealed record AdminCaretakerProfileDto(string Id, string BackgroundCheckStatus, double Rating, int ReviewCount);

public sealed record AdminVetProfileDto(string Id, string ClinicName, string LicenseNumber, string LicenseState);

/// <summary>Everything about one account, in one round trip — a support call is "what is going on with this person".</summary>
public sealed record AdminUserDetailDto(
    string Id,
    string Name,
    string Email,
    string AvatarUrl,
    string[] Roles,
    string[] StaffRoles,
    string Status,
    bool Verified,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastLoginAt,
    string City,
    string State,
    string[] AuthMethods,
    string Phone,
    AddressDto Address,
    DateTimeOffset? SuspendedAt,
    string SuspendedReason,
    DateTimeOffset? DeletedAt,
    DateTimeOffset? SessionsValidFrom,
    AdminUserCountsDto Counts,
    AdminOrderSummaryDto[] RecentOrders,
    AdminCaretakerProfileDto? CaretakerProfile,
    AdminVetProfileDto? VetProfile);

public sealed record AdminUserStatsDto(int Total, int NewLast7Days, int NewLast30Days, int Suspended, int Unverified, int Staff);
public sealed record AdminCountByStatusDto(int Total, Dictionary<string, int> ByStatus);
public sealed record AdminOrderStatsDto(int Total, long GrossCents, Dictionary<string, int> ByStatus, int AwaitingFulfilment);
public sealed record AdminCatalogStatsDto(int Active, int OutOfStock);

/// <summary>
/// The overview. The reference also counted assistant conversations; the
/// assistant is out of scope (REQUIREMENTS.md §14), so that block is gone.
/// </summary>
public sealed record AdminStatsDto(
    AdminUserStatsDto Users,
    AdminCountByStatusDto Bookings,
    AdminCountByStatusDto Appointments,
    AdminOrderStatsDto Orders,
    AdminCatalogStatsDto Catalog);

public sealed record AdminRefundRowDto(
    string Id, int AmountCents, string Status, string Reason, string InitiatedBy,
    DateTimeOffset CreatedAt, DateTimeOffset? SettledAt);

public sealed record AdminPaymentRowDto(
    string Id,
    string UserId,
    string UserName,
    string UserEmail,
    string Kind,
    string? OrderId,
    string Provider,
    string ProviderRef,
    string Status,
    int AmountCents,
    int AmountRefundedCents,
    string Currency,
    string MethodBrand,
    string MethodLast4,
    string FailureMessage,
    DateTimeOffset CreatedAt,
    DateTimeOffset? SucceededAt,
    AdminRefundRowDto[] Refunds);

/// <summary><see cref="CapturedCents"/> and <see cref="RefundedCents"/> are over the filtered set, so they describe what is on screen.</summary>
public sealed record AdminPaymentPage(
    AdminPaymentRowDto[] Items, string? NextCursor, int Total, long CapturedCents, long RefundedCents);

public sealed record AdminSubscriptionRowDto(
    string Id,
    string UserId,
    string UserName,
    string UserEmail,
    string PlanName,
    int PriceCents,
    string Status,
    string ProviderRef,
    DateTimeOffset CurrentPeriodEnd,
    bool CancelAtPeriodEnd,
    DateTimeOffset? GraceEndsAt,
    DateTimeOffset CreatedAt);

/// <summary><see cref="MrrCents"/> is normalised to a month, so annual and monthly plans are comparable.</summary>
public sealed record AdminSubscriptionPage(
    AdminSubscriptionRowDto[] Items, string? NextCursor, int Total, int ActiveCount, long MrrCents);

public sealed record AdminProfessionalRowDto(
    string Id,
    string Kind,
    string UserId,
    string UserName,
    string UserEmail,
    string AvatarUrl,
    string Status,
    double Rating,
    int ReviewCount,
    /// <summary>One line of whatever is worth checking for this kind of professional.</summary>
    string Detail);

public sealed record AdminProfessionalPage(
    AdminProfessionalRowDto[] Items, string? NextCursor, int Total, int AwaitingReview);

public sealed record AdminAuditEntryDto(
    string Id,
    string ActorUserId,
    string ActorName,
    string ActorEmail,
    string Action,
    string TargetType,
    string TargetId,
    string Summary,
    JsonElement? Metadata,
    string Ip,
    DateTimeOffset CreatedAt);

public sealed record AdminAuditPage(AdminAuditEntryDto[] Items, string? NextCursor, int Total);

// ── Queries ──────────────────────────────────────────────────────────────
// Bound from the query string. Every one takes `limit` (capped) and `cursor`.

public sealed class AdminUserQuery
{
    public string? Q { get; set; }
    public string? Role { get; set; }
    public string? StaffRole { get; set; }
    public string? Status { get; set; }
    public bool? Verified { get; set; }
    public string? AuthMethod { get; set; }
    /// <summary><c>newest</c> (default), <c>oldest</c>, <c>name</c>, <c>recent_login</c>.</summary>
    public string? Sort { get; set; }
    public int? Limit { get; set; }
    public string? Cursor { get; set; }
}

public sealed class AdminPaymentQuery
{
    public string? Q { get; set; }
    public string? Status { get; set; }
    public string? Kind { get; set; }
    public string? UserId { get; set; }
    public int? Limit { get; set; }
    public string? Cursor { get; set; }
}

public sealed class AdminSubscriptionQuery
{
    public string? Q { get; set; }
    public string? Status { get; set; }
    public int? Limit { get; set; }
    public string? Cursor { get; set; }
}

public sealed class AdminProfessionalQuery
{
    public string? Q { get; set; }
    public string? Kind { get; set; }
    public string? Status { get; set; }
    public int? Limit { get; set; }
    public string? Cursor { get; set; }
}

public sealed class AdminAuditQuery
{
    public string? ActorUserId { get; set; }
    public string? Action { get; set; }
    public string? TargetType { get; set; }
    public string? TargetId { get; set; }
    public int? Limit { get; set; }
    public string? Cursor { get; set; }
}

// ── Commands ─────────────────────────────────────────────────────────────

/// <summary>
/// One action per request rather than a free-form patch. Each action carries
/// exactly the fields it needs, and the validator refuses the rest — so
/// <c>suspend</c> can demand a reason and nothing else can smuggle one in.
/// Actions: <c>verify</c>, <c>suspend</c>, <c>reactivate</c>, <c>sign_out</c>,
/// <c>set_roles</c>, <c>set_staff_roles</c>.
/// </summary>
public sealed record AdminUserActionRequest(
    string Action,
    bool? Verified = null,
    string? Reason = null,
    string[]? Roles = null,
    string[]? StaffRoles = null);

/// <summary>Omit the amount to refund everything still refundable.</summary>
public sealed record AdminRefundRequest(int? AmountCents = null, string? Reason = null, string? Note = null);

public sealed record AdminRefundResultDto(string RefundId, int AmountCents, bool Pending);

/// <summary>Actions: <c>cancel</c> (optionally <c>immediately</c>), <c>resume</c>, <c>extend_grace</c> (<c>days</c>).</summary>
public sealed record AdminSubscriptionActionRequest(string Action, bool? Immediately = null, int? Days = null);

public sealed record AdminVerificationRequest(string Kind, string Status, string? Note = null);

/// <summary>Only the fields present change. Unknown keys are not bound at all.</summary>
public sealed record SettingsPatchRequest(
    bool? SignupsOpen = null,
    string? MaintenanceBanner = null,
    bool? DemoLoginVisible = null,
    int? FreeShippingThresholdCents = null);

/// <summary>Who is acting, for the audit row. The IP is context, never a decision input.</summary>
public sealed record StaffActor(string UserId, string Ip = "");
