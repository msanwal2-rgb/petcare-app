using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace Leash.Api.Auth;

public static class AuthSetup
{
    /// <summary>
    /// Whether Google sign-in is configured on this deployment.
    ///
    /// The button on /login and /signup is hidden until both halves are set and
    /// appears automatically once they are (REQUIREMENTS.md A6), so the app
    /// stays healthy before the OAuth client exists. This is the one source of
    /// that answer: the provider registration below and the <c>googleEnabled</c>
    /// flag on GET /config both read it, so they cannot disagree.
    /// </summary>
    public static bool GoogleConfigured(IConfiguration config)
        => !string.IsNullOrWhiteSpace(config["Auth:Google:ClientId"])
           && !string.IsNullOrWhiteSpace(config["Auth:Google:ClientSecret"]);

    public static IServiceCollection AddLeashAuth(
        this IServiceCollection services, IConfiguration config)
    {
        services.AddSingleton<SessionCookie>();
        services.AddSingleton<RedirectGuard>();

        var builder = services
            .AddAuthentication(AuthSchemes.Default)

            // ── The scheme selector ──────────────────────────────────────
            // One set of endpoints serves two kinds of client, so the choice of
            // credential is made per request rather than per route
            // (REQUIREMENTS.md A18). Selecting on the Authorization header
            // rather than a custom client header is deliberate: a client that
            // presents a bearer token has said what it is by presenting it, and
            // a mobile build that forgets an extra header would otherwise fail
            // in a way that looks like an auth bug.
            .AddPolicyScheme(AuthSchemes.Default, AuthSchemes.Default, options =>
            {
                options.ForwardDefaultSelector = context =>
                    context.Request.Headers.Authorization
                        .FirstOrDefault()?
                        .StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
                        ? AuthSchemes.Bearer
                        : AuthSchemes.Cookie;
            });

        AddCookie(builder, config);
        AddBearer(builder);

        // The validation parameters come from ITokenService, which owns the
        // signing key, so the verifier cannot drift from the signer. Bound
        // through the options pipeline rather than resolved inside AddJwtBearer:
        // building a provider there would create a second container and a second
        // TokenService, and with it a second opinion about the key.
        services.AddOptions<JwtBearerOptions>(AuthSchemes.Bearer)
            .Configure<ITokenService>((options, tokens) =>
                options.TokenValidationParameters =
                    (TokenValidationParameters)tokens.ValidationParameters);

        if (GoogleConfigured(config)) AddGoogle(builder, config);

        // Authorization is enforced per action with [Authorize]. There is no
        // fallback policy: an action is public because it says nothing, which
        // means a new action is public by default. That is the wrong default in
        // general, and it is the right one here only because REQUIREMENTS
        // section 2.6 makes the per-endpoint check the rule and M2's predicates
        // the enforcement — a fallback policy would hide a missing check behind
        // a 401 that looks correct.
        services.AddAuthorization();

        return services;
    }

    private static void AddCookie(AuthenticationBuilder builder, IConfiguration config) =>
        builder.AddCookie(AuthSchemes.Cookie, options =>
        {
            options.Cookie.Name = "leash.session";

            // HttpOnly: the cookie is never read by JavaScript, so an XSS bug
            // cannot exfiltrate the session.
            options.Cookie.HttpOnly = true;

            // Lax rather than Strict. Strict would drop the cookie on the return
            // leg of the Google OAuth redirect, and on any inbound link from an
            // email — including the verification and reset links this API sends.
            // Lax still blocks the cross-site POST that CSRF needs.
            options.Cookie.SameSite = SameSiteMode.Lax;

            // Always over HTTPS in production; permitted over http on localhost,
            // because the dev proxy serves the SPA on plain http and a
            // Secure-only cookie would simply never arrive.
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;

            // Opt-in, for an SPA served from a different DOMAIN than this API
            // (different ports on one host are still same-site, and Lax works).
            // A cross-site fetch only carries a SameSite=None cookie, and
            // browsers accept None only with Secure — so the API must be
            // reached over https. Safari blocks such cookies outright; one
            // domain for both is the dependable layout.
            if (config.GetValue<bool>("Auth:CrossSiteCookie"))
            {
                options.Cookie.SameSite = SameSiteMode.None;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            }

            options.ExpireTimeSpan = TimeSpan.FromDays(30);

            // Off. Sliding expiry re-issues the ticket mid-session, which resets
            // IssuedUtc — the exact value session validation compares against
            // sessionsValidFrom. A revoked session would quietly re-qualify
            // itself just by being used.
            options.SlidingExpiration = false;

            options.Events = new CookieAuthenticationEvents
            {
                // This is where a session gets revoked. See ISessionValidator.
                OnValidatePrincipal = async context =>
                {
                    var validator = context.HttpContext.RequestServices
                        .GetRequiredService<ISessionValidator>();

                    var reason = await validator.ValidateAsync(
                        context.Principal?.UserId(),
                        AuthClaims.IssuedAt(context.Principal, context.Properties.IssuedUtc),
                        context.HttpContext.RequestAborted);

                    if (reason is null) return;

                    context.HttpContext.Items[AuthFailureItems.Key] = reason;
                    context.RejectPrincipal();

                    // Clear the cookie as well as refusing it, so the browser
                    // stops sending a credential that will never work again.
                    await context.HttpContext.SignOutAsync(AuthSchemes.Cookie);
                },

                // A fetch client needs the error envelope, not a 302 to HTML.
                OnRedirectToLogin = context => AuthResponses.Unauthorized(context.HttpContext),
                OnRedirectToAccessDenied = context => AuthResponses.Forbidden(context.HttpContext),
            };
        });

    private static void AddBearer(AuthenticationBuilder builder) =>
        builder.AddJwtBearer(AuthSchemes.Bearer, options =>
        {
            // Claim names stay as the token wrote them. The default behaviour
            // renames "sub" to a long URI, which would leave the cookie and the
            // bearer principal carrying the user id under different keys —
            // exactly the kind of difference that makes auth work on one client
            // and fail on the other.
            options.MapInboundClaims = false;

            options.Events = new JwtBearerEvents
            {
                // The signature and lifetime are valid; the account behind it
                // still has to be. Same two checks the cookie makes, against the
                // token's own iat.
                OnTokenValidated = async context =>
                {
                    var validator = context.HttpContext.RequestServices
                        .GetRequiredService<ISessionValidator>();

                    var issuedAt = AuthClaims.IssuedAt(context.Principal,
                        context.Principal?.FindFirst("iat")?.Value is { } raw
                        && long.TryParse(raw, out var seconds)
                            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
                            : null);

                    var reason = await validator.ValidateAsync(
                        context.Principal?.UserId(), issuedAt,
                        context.HttpContext.RequestAborted);

                    if (reason is null) return;

                    context.HttpContext.Items[AuthFailureItems.Key] = reason;
                    context.Fail(reason);
                },

                OnChallenge = context =>
                {
                    // Suppress the default WWW-Authenticate-only response so the
                    // body carries the envelope every other 401 uses.
                    context.HandleResponse();
                    return AuthResponses.Unauthorized(context.HttpContext);
                },

                OnForbidden = context => AuthResponses.Forbidden(context.HttpContext),
            };
        });

    private static void AddGoogle(AuthenticationBuilder builder, IConfiguration config) =>
        builder.AddGoogle(AuthSchemes.Google, options =>
        {
            options.ClientId = config["Auth:Google:ClientId"]!;
            options.ClientSecret = config["Auth:Google:ClientSecret"]!;

            // Under /api/v1 like everything else, and registered as an
            // authorised redirect URI on the Google client.
            options.CallbackPath = "/api/v1/auth/google/callback";

            // The correlation cookie rides the redirect back from Google, so it
            // cannot be SameSite=Strict.
            options.CorrelationCookie.SameSite = SameSiteMode.Lax;
            options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;

            // Sign-in is completed by the controller, which applies the linking
            // rules before any session cookie is issued. Without this the
            // handler would sign the Google identity straight in as its own
            // principal, and REQUIREMENTS A7 would never run.
            options.SignInScheme = AuthSchemes.GoogleExternal;

            options.ClaimActions.MapJsonKey("email_verified", "email_verified");
            options.ClaimActions.MapJsonKey("picture", "picture");
        })
        .AddCookie(AuthSchemes.GoogleExternal, options =>
        {
            options.Cookie.Name = "leash.oauth";
            options.Cookie.HttpOnly = true;
            options.Cookie.SameSite = SameSiteMode.Lax;
            options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
            options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
        });
}
