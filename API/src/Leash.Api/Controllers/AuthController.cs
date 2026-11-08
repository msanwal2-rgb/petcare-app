using System.Security.Claims;
using Leash.Api.Auth;
using Leash.Api.Http;
using Leash.Core.Email;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Controllers;

/// <summary>
/// The credential endpoints.
///
/// Controllers stay thin: rate-limit guard, service call, map the result to a
/// status. Anything that decides something belongs in <see cref="IAuthService"/>
/// or <see cref="IEmailFlowService"/>, where the test suite reaches it without
/// going through HTTP.
/// </summary>
[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(
    IAuthService auth,
    IEmailFlowService emails,
    IUserService users,
    ITokenService tokens,
    ISettingsService settings,
    IRateLimitService rateLimits,
    EmailDevMode devMode,
    SessionCookie cookie,
    RedirectGuard redirects,
    IConfiguration config,
    ILogger<AuthController> log) : ControllerBase
{
    // ── POST /auth/signup ────────────────────────────────────────────────

    [HttpPost("signup")]
    public async Task<IActionResult> Signup(SignupRequest request, CancellationToken ct)
    {
        // Per client, not per address: the address is exactly the thing an
        // abuser varies.
        if (await Throttle(RateLimits.Signup, ClientKey(), ct) is { } limited)
            return limited;

        if (!(await settings.GetAsync(ct)).SignupsOpen)
            return ApiResults.Unavailable("New accounts are temporarily closed");

        var user = await auth.RegisterAsync(request, ct);
        if (user is null)
        {
            // Somebody who booked as a guest (STATUS §3-G): no account to sign
            // in to yet, so they get the set-password link for theirs. Sign-up
            // already answers 409 for a taken address, so this tells a caller
            // nothing that answer did not.
            var setup = await emails.RequestAccountSetupAsync(request.Email, ct);
            return setup is null
                ? ApiResults.Conflict("An account with that email already exists")
                : ApiResults.Conflict(
                    "You've booked with us before. We've emailed you a link to set your password.",
                    devMode.Enabled
                        ? new { code = "finish_setup", devLink = setup }
                        : (object)new { code = "finish_setup" });
        }

        // Best-effort. A mail provider being down is not a reason to throw away
        // an account somebody just created — they can ask for another link from
        // the dashboard, and verification does not gate use.
        string? devLink = null;
        try
        {
            var link = await emails.RequestEmailVerificationAsync(
                user.Id, user.Email, user.Name, ct);
            if (devMode.Enabled) devLink = link;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Verification email failed for {UserId}", user.Id);
        }

        // Signed in immediately. Skipping this would mean the client has to POST
        // the password again straight after creating the account, which is a
        // second sign-in attempt against the rate limiter for no gain in
        // assurance — the caller just proved they know it.
        var response = await EstablishSessionAsync(user, ct) with { DevLink = devLink };
        await auth.TouchLastLoginAsync(user.Id, ct);

        return Created($"/api/v1/users/{user.Id}", response);
    }

    // ── POST /auth/login ─────────────────────────────────────────────────

    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken ct)
    {
        // Both limits, because neither is sufficient on its own: per-email alone
        // lets a botnet spread one password across every account, per-client
        // alone lets one attacker rotate addresses (REQUIREMENTS.md A9).
        if (await Throttle(RateLimits.SigninClient, ClientKey(), ct) is { } clientLimited)
            return clientLimited;

        var emailKey = rateLimits.SubjectKey(request.Email);
        if (await Throttle(RateLimits.SigninEmail, emailKey, ct) is { } emailLimited)
            return emailLimited;

        var user = await auth.VerifyCredentialsAsync(request.Email, request.Password, ct);

        // One message for every failure. "No such account" and "wrong password"
        // are the same answer here by design (A10) — and the rate-limit refusal
        // above says nothing different either, so a throttled attacker cannot
        // read account existence off the status.
        if (user is null)
            return ApiResults.Unauthorized("No account matches that email and password");

        // A suspended account is refused at sign-in as well as on every later
        // request. Without this, someone suspended could still mint a fresh
        // credential, which session validation would then refuse one request
        // later — correct, but it would report "your session expired" to
        // somebody who was just banned.
        if (user.Status != AccountStatus.Active)
            return ApiResults.Unauthorized(AuthFailureReason.NotActive);

        // A correct password clears the counter, so someone who mistypes twice
        // and then gets it right starts fresh. An attacker never reaches this
        // line. Only the per-email counter is cleared — the per-client one is
        // not, or one known-good password would reset the budget for guessing at
        // every other address from that machine.
        await rateLimits.ClearAsync(RateLimits.SigninEmail, emailKey, ct);
        await auth.TouchLastLoginAsync(user.Id, ct);

        return Ok(await EstablishSessionAsync(user.ToDto(), ct));
    }

    // ── POST /auth/logout ────────────────────────────────────────────────

    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        // Unauthenticated callers get a 204 too. Signing out is idempotent, and
        // a 401 here would mean a client whose session had already lapsed could
        // not clear its own state without special-casing the error.
        await HttpContext.SignOutAsync(AuthSchemes.Cookie);

        if (User.UserId() is { } userId)
            await tokens.RevokeAllForUserAsync(userId, ct);

        return NoContent();
    }

    // ── Email verification ───────────────────────────────────────────────

    [HttpPost("verify-email")]
    public async Task<IActionResult> VerifyEmail(VerifyEmailRequest request, CancellationToken ct)
    {
        var user = await emails.VerifyEmailAsync(request.Token, ct);

        return user is null
            ? ApiResults.BadRequest("This verification link is invalid or has expired")
            : Ok(new { user });
    }

    [HttpPost("resend-verification")]
    [Authorize]
    public async Task<IActionResult> ResendVerification(CancellationToken ct)
    {
        var uid = User.RequireUserId();

        // Keyed on the user id: being signed in is not a licence to make this
        // app send unlimited mail to the address on the account.
        if (await Throttle(RateLimits.EmailSend, rateLimits.UserKey(uid), ct) is { } limited)
            return limited;

        var user = await users.GetAsync(uid, ct);
        if (user is null) return ApiResults.Unauthorized();
        if (user.Verified) return Ok(new OkResponse(true, AlreadyVerified: true));

        var link = await emails.RequestEmailVerificationAsync(
            user.Id, user.Email, user.Name, ct);

        return Ok(new OkResponse(true, devMode.Enabled ? link : null));
    }

    // ── Password reset ───────────────────────────────────────────────────

    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(
        ForgotPasswordRequest request, CancellationToken ct)
    {
        // Throttled per client rather than per address: the abuse here is using
        // this endpoint to flood someone else's inbox, and the address in the
        // body is what the abuser varies.
        if (await Throttle(RateLimits.EmailSend, ClientKey(), ct) is { } limited)
            return limited;

        var link = await emails.RequestPasswordResetAsync(request.Email, ct);

        // Always { ok: true }. Whether an account exists at that address is not
        // something an unauthenticated caller gets to learn.
        return Ok(new OkResponse(true, devMode.Enabled ? link : null));
    }

    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(
        ResetPasswordRequest request, CancellationToken ct)
    {
        // Throttled because the token is the only thing between a caller and an
        // account, and an unthrottled endpoint invites guessing at it.
        if (await Throttle(RateLimits.EmailSend, ClientKey(), ct) is { } limited)
            return limited;

        return await emails.ResetPasswordAsync(request.Token, request.Password, ct)
            ? Ok(new OkResponse(true))
            : ApiResults.BadRequest("This reset link is invalid or has expired");
    }

    // ── POST /auth/set-password — a guest's first password (STATUS §3-G) ─

    [HttpPost("set-password")]
    public async Task<IActionResult> SetPassword(SetPasswordRequest request, CancellationToken ct)
    {
        if (await Throttle(RateLimits.SetPassword, ClientKey(), ct) is { } limited)
            return limited;

        var user = await emails.SetPasswordAsync(request.Token, request.Password, ct);
        if (user is null)
            return ApiResults.BadRequest(
                "This link has expired or was already used. Ask for a new one with Forgot password.");

        // Signed in, as at sign-up: they just chose the password, and making
        // them type it again straight away buys nothing.
        var response = await EstablishSessionAsync(user, ct);
        await auth.TouchLastLoginAsync(user.Id, ct);
        return Ok(response);
    }

    // ── POST /auth/refresh — mobile token rotation ───────────────────────

    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(RefreshRequest request, CancellationToken ct)
    {
        if (await Throttle(RateLimits.Refresh, ClientKey(), ct) is { } limited)
            return limited;

        var (pair, failure) = await tokens.RotateAsync(
            request.RefreshToken, UserAgent(), ct);

        // One message for all three failures. A client can only do one thing
        // about any of them — sign in again — and distinguishing "replayed"
        // would tell whoever holds a stolen token that they have been noticed.
        return pair is null || failure is not null
            ? ApiResults.Unauthorized("Your session has expired. Please sign in again.")
            : Ok(pair);
    }

    // ── Google OAuth ─────────────────────────────────────────────────────

    [HttpGet("google")]
    public IActionResult GoogleSignIn([FromQuery] string? callbackUrl)
    {
        // 503 rather than 404 when unconfigured: the route exists on every
        // deployment, and "this feature is not set up here" is a different
        // answer from "no such endpoint" for anyone debugging it.
        if (!AuthSetup.GoogleConfigured(config))
            return ApiResults.Unavailable("Google sign-in is not configured");

        // Validated before it is stored, because it is echoed back through the
        // OAuth round trip. Skipping this makes the callback an open redirect
        // with a fresh session attached.
        var target = redirects.SafeInternalPath(callbackUrl);

        // RedirectUri is where the *Google handler* hands control back, not where
        // the user ends up. The handler owns /auth/google/callback and only
        // writes the external cookie; the linking rules in A7 run in Complete
        // below, so the final destination rides along as a query parameter
        // rather than as the redirect target.
        var complete = "/api/v1/auth/google/complete"
            + (target is null ? "" : $"?callbackUrl={Uri.EscapeDataString(target)}");

        return Challenge(
            new AuthenticationProperties { RedirectUri = complete },
            AuthSchemes.Google);
    }

    [HttpGet("google/complete")]
    public async Task<IActionResult> GoogleComplete(
        [FromQuery] string? callbackUrl, CancellationToken ct)
    {
        var result = await HttpContext.AuthenticateAsync(AuthSchemes.GoogleExternal);
        if (!result.Succeeded) return Redirect("/login?error=OAuthCallback");

        var email = result.Principal.FindFirstValue(ClaimTypes.Email);
        var googleId = result.Principal.FindFirstValue(ClaimTypes.NameIdentifier);

        // Google sends this as a boolean but has historically sent the string
        // "true" through some paths; anything else counts as unverified.
        var verified = result.Principal.FindFirstValue("email_verified") is "true";

        // The short-lived OAuth cookie has done its job either way.
        await HttpContext.SignOutAsync(AuthSchemes.GoogleExternal);

        if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(googleId))
            return Redirect("/login?error=OAuthAccountNotLinked");

        var outcome = await auth.LinkOrCreateOAuthUserAsync(
            new OAuthIdentity(
                email, verified, googleId,
                result.Principal.FindFirstValue(ClaimTypes.Name),
                result.Principal.FindFirstValue("picture")),
            ct);

        if (outcome.Failure is { } failure)
        {
            return Redirect(failure switch
            {
                OAuthFailure.AccountExists => "/login?error=AccountExists",
                OAuthFailure.FinishSetup => "/login?error=FinishSetup",
                _ => "/login?error=EmailUnverified",
            });
        }

        await cookie.SignInAsync(HttpContext, outcome.User!.Id);
        await auth.TouchLastLoginAsync(outcome.User.Id, ct);

        // Re-validated on the way out. It survived one round trip through a
        // third party, and a value that was checked before it left is not the
        // same as a value that is checked now.
        var requested = redirects.SafeInternalPath(callbackUrl);

        // A brand-new account has no roles yet and the dashboard would only tell
        // them to go and choose some, so they go straight to onboarding — where
        // the password signup flow already sends them.
        return Redirect(requested ?? (outcome.Created ? "/onboarding" : "/dashboard"));
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /// <summary>
    /// Issue whichever credential this client asked for.
    ///
    /// Exactly one of the two: a browser gets the cookie and no tokens, a native
    /// client gets tokens and no cookie. Issuing both would mean a successful
    /// XSS on the web app could read an access token out of the response, which
    /// is the specific thing the cookie protects against.
    /// </summary>
    private async Task<AuthResponse> EstablishSessionAsync(UserDto user, CancellationToken ct)
    {
        if (ClientKind.WantsTokens(Request))
            return new AuthResponse(user, await tokens.IssueAsync(user.Id, UserAgent(), ct));

        await cookie.SignInAsync(HttpContext, user.Id);
        return new AuthResponse(user);
    }

    private async Task<IActionResult?> Throttle(
        RateLimitRule rule, string key, CancellationToken ct)
    {
        var verdict = await rateLimits.ConsumeAsync(rule, key, ct);
        return verdict.Allowed
            ? null
            : ApiResults.TooManyRequests(verdict.Message ?? "Too many requests", verdict.Limit);
    }

    /// <summary>
    /// Derive the rate-limit key for this caller. Reading the request is the
    /// controller's job; hashing and salting it is the service's.
    /// </summary>
    private string ClientKey()
    {
        var forwarded = Request.Headers["X-Forwarded-For"].FirstOrDefault();

        var ip =
            forwarded?.Split(',').FirstOrDefault()?.Trim() is { Length: > 0 } fwd ? fwd
            : Request.Headers["X-Real-IP"].FirstOrDefault() is { Length: > 0 } real ? real
            : HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return rateLimits.ClientKey(ip, UserAgent());
    }

    private string UserAgent() => Request.Headers.UserAgent.FirstOrDefault() ?? string.Empty;
}
