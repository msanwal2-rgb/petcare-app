namespace Leash.Core.Models.Enums;

/// <summary>
/// Marketplace roles. One account may hold several, and a role toggle selects
/// the active one (REQUIREMENTS.md A11).
///
/// String constants rather than a C# <c>enum</c>, and stored as
/// <c>text[]</c> rather than a PostgreSQL <c>ENUM</c> — REQUIREMENTS section
/// 2.4. An enum type in the database would turn every new value into a schema
/// change, and a C# enum would need a converter at both the JSON and the
/// Dapper boundary to keep emitting the strings the contract specifies.
/// </summary>
public static class UserRoles
{
    public const string Owner = "owner";
    public const string Caretaker = "caretaker";
    public const string Vet = "vet";
    public const string Shelter = "shelter";

    public static readonly string[] All = [Owner, Caretaker, Vet, Shelter];

    public static bool IsValid(string role) => All.Contains(role);
}

/// <summary>
/// Staff privileges. Orthogonal to <see cref="UserRoles"/>: those say what
/// someone does in the marketplace, these say what they may do to it.
///
/// Never self-editable and never shown in the role toggle (REQUIREMENTS.md
/// A12). That is enforced by their absence from the update DTO, not by a check.
/// </summary>
public static class StaffRoles
{
    public const string Ops = "ops";
    public const string Support = "support";
    public const string Finance = "finance";

    /// <summary>Satisfies every staff check. See IAccessService.</summary>
    public const string Admin = "admin";

    public static readonly string[] All = [Ops, Support, Finance, Admin];

    public static bool IsValid(string role) => All.Contains(role);
}

public static class AccountStatus
{
    public const string Active = "active";
    public const string Suspended = "suspended";

    /// <summary>
    /// Soft delete. The row stays so orders, payments and reviews keep their
    /// author; the personal data on it is scrubbed (REQUIREMENTS.md A16).
    /// </summary>
    public const string Deleted = "deleted";
}

public static class TokenTypes
{
    public const string VerifyEmail = "verify_email";
    public const string ResetPassword = "reset_password";
}

/// <summary>
/// The status values shared by <c>bookings</c> and <c>vet_appointments</c> that
/// the authorization core cares about.
///
/// Only the two that <b>void</b> an engagement are named here, because those are
/// the only two M2 has an opinion about: a declined booking was never accepted,
/// a cancelled one was called off, and neither is a reason to be reading an
/// animal's file. Every other status grants — see
/// <see cref="Services.AccessService.DisqualifyingStatuses"/>.
///
/// The full vocabularies (<c>requested</c>, <c>accepted</c>/<c>confirmed</c>,
/// <c>in_progress</c>, <c>completed</c>) and the transition tables that govern
/// them belong to M4 and M5. When those land, they add their own constants; they
/// do not move these, because a predicate reading a booking constant and an
/// appointment constant that must stay equal is worse than one shared pair.
/// </summary>
public static class EngagementStatus
{
    public const string Declined = "declined";
    public const string Cancelled = "cancelled";
}
