namespace Leash.Api.Auth;

public static class AuthSchemes
{
    /// <summary>
    /// The scheme every controller names. It is a policy scheme that forwards to
    /// the cookie or the bearer handler per request — see <see cref="AuthSetup"/>
    /// for why the choice is made there and not at the controller.
    /// </summary>
    public const string Default = "Leash";

    public const string Cookie = "Leash.Cookie";
    public const string Bearer = "Leash.Bearer";
    public const string Google = "Google";

    /// <summary>
    /// The short-lived cookie that exists only between the redirect to Google
    /// and the callback reading the result.
    /// </summary>
    public const string GoogleExternal = "Google.External";
}

public static class AuthClaims
{
    /// <summary>
    /// The user id. "sub" in both directions: it is what the JWT carries, and
    /// the cookie stores the same name so one accessor reads either principal.
    /// </summary>
    public const string Subject = "sub";

    /// <summary>
    /// When the session was issued, in Unix milliseconds — the value compared
    /// with <c>sessionsValidFrom</c>.
    ///
    /// Needed because neither credential keeps its own issue time precisely:
    /// the cookie ticket serialises <c>IssuedUtc</c> in RFC 1123 (whole
    /// seconds) and a JWT's <c>iat</c> is whole seconds by definition, while the
    /// watermark is written to the millisecond. Without this, a session
    /// established in the same second as a revocation — signing straight back
    /// in after a forced sign-out, or after a password reset — was refused.
    /// Credentials minted before the claim existed fall back to the coarse value.
    /// </summary>
    public const string IssuedAtMs = "iat_ms";

    /// <summary>The precise issue time if the credential carries one, else <paramref name="fallback"/>.</summary>
    public static DateTimeOffset? IssuedAt(System.Security.Claims.ClaimsPrincipal? principal, DateTimeOffset? fallback)
        => principal?.FindFirst(IssuedAtMs)?.Value is { } raw && long.TryParse(raw, out var ms)
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms)
            : fallback;
}

/// <summary>
/// Header a native client sets to ask for tokens instead of a cookie.
///
/// The same endpoints serve both (REQUIREMENTS.md A18). A browser never sends
/// this and so never receives an access token, which keeps the token out of any
/// place script can read it.
/// </summary>
public static class ClientKind
{
    public const string Header = "X-Leash-Client";
    public const string Mobile = "mobile";

    public static bool WantsTokens(HttpRequest request)
        => string.Equals(
            request.Headers[Header].FirstOrDefault(),
            Mobile,
            StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Where the refusal reason is stashed so the 401 body can say it.
///
/// The cookie handler decides it in <c>OnValidatePrincipal</c>, long before
/// anything can return a result, and by the time the challenge runs the
/// principal is gone along with the reason. The reference project returned three
/// distinct messages here and the client shows them, so they are worth carrying
/// rather than flattening to one.
/// </summary>
public static class AuthFailureItems
{
    public const string Key = "Leash.AuthFailureReason";
}
