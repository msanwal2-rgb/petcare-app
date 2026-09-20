using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>Why a principal was refused. The client shows these verbatim.</summary>
public static class AuthFailureReason
{
    public const string NotSignedIn = "You must be signed in";
    public const string NotActive = "Your account is not active";
    public const string Revoked = "Please sign in again";
}

/// <summary>
/// Re-checks the account on <b>every</b> authenticated request
/// (REQUIREMENTS.md A14).
///
/// This is the whole of session revocation, and it exists because both
/// credentials this API issues are self-contained. A cookie ticket and a JWT are
/// each valid for their full lifetime no matter what happens to the account
/// behind them: there is no session table to delete a row from. So suspending
/// someone, or resetting a password after a compromise, has to mean something
/// before the credential expires — and the only place that can be enforced is
/// the one point every authenticated request passes through.
///
/// Two independent checks:
///
///  - <b>status</b> must be <c>active</c>. A suspended or deleted account is
///    refused with 401 rather than 403 (A15), because the correct client
///    response is to sign out, not to retry with the same cookie.
///  - <b>sessionsValidFrom</b> is a watermark: any credential issued before it
///    is refused. Bumped on password reset, on suspension, and by an
///    administrator forcing sign-out.
///
/// The cost is one primary-key lookup of two columns. Every endpoint that
/// authenticates already makes several queries of its own.
/// </summary>
public sealed class SessionValidator(IUserRepository users) : ISessionValidator
{
    public async Task<string?> ValidateAsync(
        string? userId, DateTimeOffset? issuedAt, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(userId)) return AuthFailureReason.NotSignedIn;

        var account = await users.GetAccountGateAsync(userId, ct: ct);

        // The row is gone, or the account may no longer act.
        if (account is null || account.Status != AccountStatus.Active)
            return AuthFailureReason.NotActive;

        if (account.SessionsValidFrom is { } validFrom)
        {
            // A credential that cannot say when it was issued cannot be shown to
            // post-date the watermark, so it is refused. Failing closed matters
            // more here than anywhere else in the API: this is the branch that
            // runs after somebody's account was compromised.
            if (issuedAt is null || issuedAt < validFrom)
                return AuthFailureReason.Revoked;
        }

        return null;
    }
}

/// <summary>
/// The authorization core. M1 holds only the staff check; the engagement-based
/// predicates are M2.
/// </summary>
public sealed class AccessService(IUserRepository users) : IAccessService
{
    /// <summary>
    /// Whether the caller holds a staff role.
    ///
    /// <c>admin</c> satisfies every staff check (REQUIREMENTS.md A12), so a
    /// caller with <c>admin</c> passes a test for <c>finance</c>. That is the
    /// rule rather than an accident: there is no privilege an administrator is
    /// meant to lack, and the alternative — granting an admin every role
    /// explicitly — makes the seed data the source of truth for something that
    /// should be a rule.
    ///
    /// A suspended administrator is not an administrator, so status is part of
    /// the check rather than assumed to have been handled upstream.
    /// </summary>
    public async Task<bool> HasStaffRoleAsync(
        string userId, string role, CancellationToken ct = default)
    {
        var user = await users.GetByIdAsync(userId, ct: ct);
        if (user is null || user.Status != AccountStatus.Active) return false;

        return user.StaffRoles.Contains(role) || user.StaffRoles.Contains(StaffRoles.Admin);
    }
}
