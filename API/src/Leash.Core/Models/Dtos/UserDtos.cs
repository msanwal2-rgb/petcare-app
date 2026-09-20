namespace Leash.Core.Models.Dtos;

public sealed record AddressDto(string City, string State, double Lat, double Lng);

/// <summary>Just the city and state — what a public profile may show.</summary>
public sealed record PublicAddressDto(string City, string State);

/// <summary>
/// The full account, mirroring <c>User</c> in web/src/types.
///
/// Returned for the caller's own record (GET /me) and to an administrator
/// reading one account. It carries an email address, a phone number and home
/// coordinates, so it is the wrong shape for anything a stranger can request —
/// see <see cref="PublicUserDto"/>.
/// </summary>
public sealed record UserDto(
    string Id,
    string Name,
    string Email,
    string Phone,
    string AvatarUrl,
    string[] Roles,
    AddressDto Address,
    bool Verified,
    DateTimeOffset CreatedAt,
    /// <summary>
    /// The caller's own staff privileges. Safe to send because it only ever
    /// describes the user it is sent to: it lets the header decide whether to
    /// show an Admin link, and nothing is authorised by it — every endpoint
    /// behind that link re-checks.
    /// </summary>
    string[] StaffRoles,
    string Status);

/// <summary>
/// A user as anyone may see them: enough to render a caretaker card or a review
/// byline, and nothing that would make the id space worth enumerating.
///
/// The reference project learned this the hard way — GET /api/users/:id used to
/// return the whole record, email and home coordinates included, against ids
/// that count upward from u1.
/// </summary>
public sealed record PublicUserDto(
    string Id,
    string Name,
    string AvatarUrl,
    string[] Roles,
    PublicAddressDto Address,
    bool Verified,
    DateTimeOffset CreatedAt);

/// <summary>
/// What a user may change about their own account.
///
/// The controller checks that you are patching yourself and hands this to the
/// service, which writes what it carries — so the shape of this record <em>is</em>
/// the privilege boundary. Two fields are deliberately absent:
///
///  - <c>verified</c> — the email-verification flag. Self-settable, it made the
///    whole token flow decorative: anyone could patch themselves verified and
///    the badge next to a name meant nothing. It is set by confirming a token,
///    or by an administrator, and both are recorded.
///  - <c>email</c> — the identifier the account is keyed and recovered by.
///    Changing it needs re-verification of the new address, and that flow does
///    not exist (REQUIREMENTS.md A17). Accepting the field would pretend it
///    did, and a duplicate would surface as a unique-violation 500.
///
/// <c>roles</c> deliberately stays. Choosing "I have a pet" / "I care for pets"
/// / "I'm a veterinarian" is what onboarding is, and self-declaration is the
/// intended design — what a professional claim is <em>worth</em> is decided by
/// verification in the admin console, not by who may tick the box.
/// </summary>
public sealed record UpdateUserRequest(
    string? Name,
    string? Phone,
    string? AvatarUrl,
    string[]? Roles,
    AddressDto? Address);
