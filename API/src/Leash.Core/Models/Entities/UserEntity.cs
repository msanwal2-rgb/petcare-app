using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>users</c> row as the database holds it: flat, and carrying the columns
/// no response should ever include.
///
/// A mutable class with parameterless construction, because Dapper materialises
/// it — see Persistence/DapperSetup.cs for why a positional record does not work
/// against this schema.
///
/// The entity stays inside the repository and service layers. Controllers see
/// only the DTOs below, which is what keeps <see cref="PasswordHash"/> and the
/// session watermark from being one careless <c>return</c> away from a browser.
/// </summary>
public class UserEntity
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string[] Roles { get; set; } = [];
    public string AddressCity { get; set; } = "";
    public string AddressState { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public bool Verified { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string[] StaffRoles { get; set; } = [];
    public string Status { get; set; } = "";

    /// <summary>The full record: the caller's own account, or an administrator reading one.</summary>
    public UserDto ToDto() => new(
        Id, Name, Email, Phone, AvatarUrl, Roles,
        new AddressDto(AddressCity, AddressState, Lat, Lng),
        Verified, CreatedAt, StaffRoles, Status);

    /// <summary>What anyone may see: enough for a card or a byline, and nothing more.</summary>
    public PublicUserDto ToPublicDto() => new(
        Id, Name, AvatarUrl, Roles,
        new PublicAddressDto(AddressCity, AddressState),
        Verified, CreatedAt);
}

/// <summary>
/// A user plus the password hash, for the two operations that need it: verifying
/// a sign-in, and deciding whether a Google account may be linked.
///
/// Deliberately a subclass rather than a nullable property on
/// <see cref="UserEntity"/>. Every read path in the application uses the base
/// type, so the hash is absent unless a query asks for it by name — and the only
/// two queries that do are in <c>UserRepository</c>, both private to it.
/// </summary>
public sealed class UserCredentialEntity : UserEntity
{
    /// <summary>Null for a Google-only account, which nobody can reach by password.</summary>
    public string? PasswordHash { get; set; }
}

/// <summary>
/// The account behind a credential, as far as "may this request proceed?" cares.
/// Two columns, because that is all session validation reads.
/// </summary>
public sealed class AccountGateEntity
{
    public string Status { get; set; } = "";

    /// <summary>
    /// The revocation watermark: any credential issued before this instant is
    /// refused. Null means nothing has ever been revoked on this account.
    /// </summary>
    public DateTimeOffset? SessionsValidFrom { get; set; }
}

/// <summary>A <c>verification_tokens</c> row, after it has been consumed.</summary>
public sealed class VerificationTokenEntity
{
    public string Identifier { get; set; } = "";
    public string Type { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}

/// <summary>A <c>refresh_tokens</c> row.</summary>
public sealed class RefreshTokenEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public DateTimeOffset IssuedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Set on rotation. Non-null means this token has been spent.</summary>
    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>A <c>system_settings</c> row, with its jsonb value still as text.</summary>
public sealed class SettingEntity
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
