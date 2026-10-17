namespace Leash.Core.Models.Entities;

/// <summary>
/// A user as the console reads one. Its own projection: the password hash and
/// the Google id are reduced to two booleans in SQL, so neither credential is
/// ever in a row this layer holds.
/// </summary>
public class AdminUserRow
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string[] Roles { get; set; } = [];
    public string[] StaffRoles { get; set; } = [];
    public string Status { get; set; } = "";
    public bool Verified { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastLoginAt { get; set; }
    public string AddressCity { get; set; } = "";
    public string AddressState { get; set; } = "";
    public bool HasPassword { get; set; }
    public bool HasGoogle { get; set; }
    public string Phone { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public DateTimeOffset? SuspendedAt { get; set; }
    public string SuspendedReason { get; set; } = "";
    public DateTimeOffset? DeletedAt { get; set; }
    public DateTimeOffset? SessionsValidFrom { get; set; }

    public string[] AuthMethods =>
        [.. HasPassword ? ["password"] : Array.Empty<string>(), .. HasGoogle ? ["google"] : Array.Empty<string>()];
}

public class AdminProfessionalEntity
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string UserId { get; set; } = "";
    public string UserName { get; set; } = "";
    public string UserEmail { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string Status { get; set; } = "";
    public double Rating { get; set; }
    public int ReviewCount { get; set; }
    public int Rank { get; set; }
    public string SortName { get; set; } = "";
    /// <summary>Kind-specific facts, composed into one line by the service.</summary>
    public string D1 { get; set; } = "";
    public string D2 { get; set; } = "";
    public string D3 { get; set; } = "";
}

public class AdminPaymentEntity : PaymentEntity
{
    public string UserName { get; set; } = "";
    public string UserEmail { get; set; } = "";
}

public class AdminSubscriptionEntity : SubscriptionEntity
{
    public string UserName { get; set; } = "";
    public string UserEmail { get; set; } = "";
    public string PlanName { get; set; } = "";
    public int PriceCents { get; set; }
}

public class AuditEntryEntity
{
    public string Id { get; set; } = "";
    public string ActorUserId { get; set; } = "";
    public string ActorName { get; set; } = "";
    public string ActorEmail { get; set; } = "";
    public string Action { get; set; } = "";
    public string TargetType { get; set; } = "";
    public string TargetId { get; set; } = "";
    public string Summary { get; set; } = "";
    public string? Metadata { get; set; }
    public string Ip { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public long Seq { get; set; }
}

/// <summary>One <c>GROUP BY status</c> row.</summary>
public class StatusCountEntity
{
    public string Status { get; set; } = "";
    public int Count { get; set; }
}
