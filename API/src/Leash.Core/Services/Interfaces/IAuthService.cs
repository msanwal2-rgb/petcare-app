using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// Sign-in, registration and Google account linking.
///
/// The rules live behind this interface rather than in a controller so the test
/// suite can exercise them directly — which is how the reference project's
/// Vitest suites are written, and those suites are the specification
/// (BUILD_PLAN.md section 4).
/// </summary>
public interface IAuthService
{
    /// <summary>
    /// Verify an email and password pair.
    ///
    /// Returns null on <em>any</em> failure — unknown address, no password set,
    /// wrong password — and the caller must not distinguish them. Telling a
    /// stranger which addresses have accounts turns the sign-in form into a
    /// membership lookup, and "no password set" would additionally point at
    /// exactly which accounts are Google-only and worth attacking differently.
    /// </summary>
    Task<UserEntity?> VerifyCredentialsAsync(
        string email, string password, CancellationToken ct = default);

    /// <summary>
    /// Create an email and password account. Returns null when the address is
    /// already taken, which the controller maps to a 409.
    /// </summary>
    Task<UserDto?> RegisterAsync(SignupRequest request, CancellationToken ct = default);

    /// <summary>Resolve a Google sign-in to one of our users: link it, or create one.</summary>
    Task<OAuthResult> LinkOrCreateOAuthUserAsync(
        OAuthIdentity identity, CancellationToken ct = default);

    /// <summary>
    /// Link Google to the account already signed in — the safe direction,
    /// because the caller has proved they hold the account. False when that
    /// Google id is already claimed by someone else.
    /// </summary>
    Task<bool> LinkGoogleToUserAsync(
        string userId, string googleId, CancellationToken ct = default);

    /// <summary>Record a successful sign-in. Display only; nothing is authorised by it.</summary>
    Task TouchLastLoginAsync(string userId, CancellationToken ct = default);
}

/// <summary>
/// Email verification and password reset. Each "request" creates a token and
/// emails a link; each "confirm" consumes the token and applies the change.
/// </summary>
public interface IEmailFlowService
{
    /// <summary>
    /// Send a verification link, returning it so the caller can surface it in
    /// development.
    /// </summary>
    Task<string> RequestEmailVerificationAsync(
        string userId, string email, string name, CancellationToken ct = default);

    Task<UserDto?> VerifyEmailAsync(string rawToken, CancellationToken ct = default);

    /// <summary>
    /// Start a password reset.
    ///
    /// Always resolves the same way whether or not the address exists — a null
    /// link, never an error — because the difference between "we sent one" and
    /// "no such account" is an account-enumeration oracle.
    /// </summary>
    Task<string?> RequestPasswordResetAsync(string email, CancellationToken ct = default);

    /// <summary>
    /// Consume a reset token and set a new password, invalidating every existing
    /// session (REQUIREMENTS.md A5).
    /// </summary>
    Task<bool> ResetPasswordAsync(
        string rawToken, string newPassword, CancellationToken ct = default);

    // ── A guest becoming an account (STATUS §3-G) ────────────────────────
    //
    // A set-password token is single-use, seven days, stored hashed, and only
    // ever activates an account that is still a guest or pending. Issuing one
    // replaces the previous (the repository deletes it in the same write).

    /// <summary>
    /// Mint a set-password token inside the caller's transaction and return the
    /// raw value, to email once that transaction has committed. The raw token
    /// can never go through the outbox, which stores what it sends.
    /// </summary>
    Task<string> IssueSetPasswordTokenAsync(
        string userId, ITransactionScope scope, CancellationToken ct = default);

    /// <summary>Email the "finish setting up your account" link for a token already issued; returns the link.</summary>
    Task<string> SendAccountSetupAsync(
        string email, string name, string rawToken, string? about = null, CancellationToken ct = default);

    /// <summary>
    /// Issue and send a set-password link to an unclaimed account at this
    /// address. Null — and nothing sent — for any other address, claimed or
    /// unknown. Used by forgot-password and by sign-up with a guest's email.
    /// </summary>
    Task<string?> RequestAccountSetupAsync(string email, CancellationToken ct = default);

    /// <summary>
    /// Spend a set-password token: the account becomes active and verified with
    /// this password, in one transaction. Null for an unknown, used, expired
    /// or wrong-type token, or an account that is no longer unclaimed.
    /// </summary>
    Task<UserDto?> SetPasswordAsync(
        string rawToken, string password, CancellationToken ct = default);
}

/// <summary>Reads and projections of the <c>users</c> table.</summary>
public interface IUserService
{
    Task<UserDto?> GetAsync(string id, CancellationToken ct = default);

    Task<PublicUserDto?> GetPublicAsync(string id, CancellationToken ct = default);

    Task<IReadOnlyList<PublicUserDto>> GetPublicManyAsync(
        IReadOnlyCollection<string> ids, CancellationToken ct = default);

    /// <summary>Every account, for the development-only account switcher.</summary>
    Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken ct = default);

    Task<UserDto?> UpdateAsync(
        string id, UpdateUserRequest patch, CancellationToken ct = default);
}

/// <summary>
/// The mobile half of dual auth: a short-lived JWT access token plus a
/// long-lived, single-use, rotating refresh token (REQUIREMENTS.md A18).
/// </summary>
public interface ITokenService
{
    Task<TokenPairDto> IssueAsync(
        string userId, string userAgent, CancellationToken ct = default);

    Task<(TokenPairDto? Pair, RefreshFailure? Failure)> RotateAsync(
        string rawRefreshToken, string userAgent, CancellationToken ct = default);

    Task RevokeAllForUserAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// The parameters a bearer token is validated against.
    ///
    /// Exposed as <c>object</c> so this interface does not drag
    /// <c>Microsoft.IdentityModel.Tokens</c> into every consumer; the API
    /// project casts it when configuring the JWT handler. The signing key lives
    /// in the implementation, so the verifier cannot drift from the signer.
    /// </summary>
    object ValidationParameters { get; }
}

/// <summary>
/// Re-checks the account behind a credential on <b>every</b> authenticated
/// request (REQUIREMENTS.md A14).
/// </summary>
public interface ISessionValidator
{
    /// <summary>The refusal reason, or null when the request may proceed.</summary>
    Task<string?> ValidateAsync(
        string? userId, DateTimeOffset? issuedAt, CancellationToken ct = default);
}

/// <summary>Runtime settings an administrator can change without a deploy.</summary>
public interface ISettingsService
{
    Task<SystemSettings> GetAsync(CancellationToken ct = default);
}

/// <summary>
/// The counting half of rate limiting. Deriving a key from a request is the API
/// project's job, because it needs the request; deciding whether that key has
/// had enough attempts is this one's.
/// </summary>
public interface IRateLimitService
{
    Task<RateLimitVerdict> ConsumeAsync(
        RateLimitRule rule, string key, CancellationToken ct = default);

    /// <summary>Forget a subject's attempts. Called after a successful sign-in.</summary>
    Task ClearAsync(RateLimitRule rule, string key, CancellationToken ct = default);

    /// <summary>Hash a subject (an email, say) so the table holds no addresses.</summary>
    string SubjectKey(string value);

    /// <summary>Salt and hash a caller-derived identity (an IP and user agent).</summary>
    string ClientKey(string ip, string userAgent);

    /// <summary>Key a limit to a signed-in account.</summary>
    string UserKey(string userId);

    Task<int> PurgeExpiredAsync(CancellationToken ct = default);
}
