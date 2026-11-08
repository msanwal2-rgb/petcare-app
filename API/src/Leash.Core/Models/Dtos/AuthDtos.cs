namespace Leash.Core.Models.Dtos;

public sealed record SignupRequest(
    string Name, string Email, string Password, string? Phone, string[]? Roles);

public sealed record LoginRequest(string Email, string Password);

public sealed record VerifyEmailRequest(string Token);

public sealed record ForgotPasswordRequest(string Email);

public sealed record ResetPasswordRequest(string Token, string Password);

public sealed record RefreshRequest(string RefreshToken);

/// <summary>The rotating pair a native client gets. Never issued to a browser.</summary>
public sealed record TokenPairDto(string AccessToken, string RefreshToken, int ExpiresIn);

/// <summary>
/// What a successful sign-in returns.
///
/// <paramref name="Tokens"/> is populated only for a mobile client — one that
/// asked for tokens by header. A browser gets the cookie and a null here, so
/// the access token never reaches a context where script could read and
/// exfiltrate it. That is the point of keeping two credentials rather than
/// using the JWT everywhere: <c>localStorage</c> is readable by any injected
/// script, an HttpOnly cookie is not.
///
/// <paramref name="DevLink"/> carries the verification link in development only.
/// See <see cref="Email.EmailDevMode"/> for why it cannot leak into production.
/// </summary>
public sealed record AuthResponse(
    UserDto User, TokenPairDto? Tokens = null, string? DevLink = null);

/// <summary>
/// The answer from the three endpoints that only report whether they did
/// something: forgot-password, reset-password and resend-verification.
///
/// One stable shape with nulls in it, rather than three shapes for the client
/// to branch on.
/// </summary>
public sealed record OkResponse(
    bool Ok,
    /// <summary>Present in development only.</summary>
    string? DevLink = null,
    /// <summary>Set when a resend was unnecessary because the address is already verified.</summary>
    bool? AlreadyVerified = null);

/// <summary>
/// The public runtime configuration, unauthenticated by design.
///
/// Everything here is something the browser finds out anyway by using the site:
/// whether signups are open, whether a banner is showing, whether the demo
/// accounts are on offer, whether the Google button should render. <b>Nothing
/// that gates access is decided from this response</b> — the server re-checks
/// each of them where it matters, so a client that lies to itself about this
/// gains nothing.
/// </summary>
public sealed record PublicConfigDto(
    bool SignupsOpen,
    string MaintenanceBanner,
    bool DemoLoginVisible,
    bool GoogleEnabled);

/// <summary>Why a Google sign-in was refused.</summary>
public enum OAuthFailure
{
    /// <summary>Google itself has not verified the address it handed us.</summary>
    EmailUnverified,

    /// <summary>A password account already exists at that address. See IAuthService.</summary>
    AccountExists,

    /// <summary>
    /// The address belongs to a guest who has not set a password (STATUS §3-G).
    /// Not linked: they finish setting up from the emailed link.
    /// </summary>
    FinishSetup,
}

public sealed record OAuthResult(UserDto? User, bool Created, OAuthFailure? Failure);

/// <summary>What Google told us about the person signing in.</summary>
public sealed record OAuthIdentity(
    string Email,
    bool EmailVerified,
    /// <summary>
    /// The provider's stable subject id. The link is keyed on this and never on
    /// the email (REQUIREMENTS.md A8) — an address can change hands, a subject
    /// cannot.
    /// </summary>
    string GoogleId,
    string? Name,
    string? PictureUrl);

public enum RefreshFailure
{
    /// <summary>No such token, or it has expired.</summary>
    Invalid,

    /// <summary>
    /// A token that was already rotated came back. Either the client replayed
    /// it, or someone else has a copy.
    /// </summary>
    Replayed,

    /// <summary>The account is suspended, deleted, or its sessions were revoked.</summary>
    Rejected,
}
