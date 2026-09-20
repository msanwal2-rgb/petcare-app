using System.Security.Claims;
using Leash.Core.Persistence;
using Microsoft.AspNetCore.Authentication;

namespace Leash.Api.Auth;

/// <summary>
/// Issues the browser session.
///
/// One method, but it earns its own type because of the last line: the ticket's
/// <c>IssuedUtc</c> is set explicitly rather than left to the framework's clock.
/// That value is what <c>ISessionValidator</c> compares against
/// <c>sessionsValidFrom</c>, and the two have to be written from the same clock
/// reading — <see cref="Ids.Now"/> — or a session issued in the same millisecond
/// as a revocation could land on either side of it.
/// </summary>
public sealed class SessionCookie
{
    public Task SignInAsync(HttpContext http, string userId)
    {
        var identity = new ClaimsIdentity(
            [new Claim(AuthClaims.Subject, userId)],
            AuthSchemes.Cookie,
            // The cookie carries the user id and nothing else. Roles and status
            // are read from the database on every request, so a stale claim
            // cannot outlive a change to the account — the same reason the
            // watermark exists.
            nameType: AuthClaims.Subject,
            roleType: null);

        return http.SignInAsync(
            AuthSchemes.Cookie,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                IssuedUtc = Ids.Now(),
            });
    }
}

/// <summary>
/// Validates a caller-supplied redirect destination.
///
/// <c>callbackUrl</c> arrives on the query string so that someone bounced off
/// /booking/new lands back there after signing in rather than on a generic
/// dashboard. Treating it as a destination without this check makes every
/// sign-in route an open redirect — and an open redirect on the far side of an
/// authentication flow is worth more than usual, because the victim arrives at
/// the attacker's page having just signed in and expecting to be somewhere
/// trusted.
///
/// Only paths are returned, never absolute URLs, so there is nothing for a host
/// to be smuggled into.
/// </summary>
public sealed class RedirectGuard
{
    public string? SafeInternalPath(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        // A protocol-relative URL ("//evil.example/x") is a path as far as
        // Uri.TryCreate with a relative base is concerned, and a browser reads
        // it as an absolute URL to another host. Rejected before anything else.
        if (raw.StartsWith("//", StringComparison.Ordinal)) return null;

        // Anything absolute is out. Not "absolute but matching our origin" —
        // this API does not need that case, and admitting it means correctly
        // comparing origins, which is where this kind of check usually fails.
        if (!raw.StartsWith('/')) return null;

        // A backslash is normalised to a forward slash by some browsers, which
        // turns "/\evil.example" into a protocol-relative URL after the check
        // above has already passed.
        if (raw.Contains('\\')) return null;

        return raw;
    }
}
