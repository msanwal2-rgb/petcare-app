namespace Leash.Core.Models.Dtos;

/// <summary>One throttle: how many attempts, over how long, and what to say.</summary>
/// <param name="Bucket">The counting namespace. Two rules never share one.</param>
/// <param name="Limit">Attempts permitted inside the window.</param>
/// <param name="Window">How far back the window reaches.</param>
/// <param name="Message">
/// Shown to the caller. Never names which limit tripped, or a throttled attacker
/// could read account existence off the difference (REQUIREMENTS.md A10).
/// </param>
public sealed record RateLimitRule(
    string Bucket, int Limit, TimeSpan Window, string Message);

public sealed record RateLimitVerdict(bool Allowed, int Used, int Limit, string? Message);

/// <summary>
/// The limits, ported from <c>lib/server/rate-limit.ts</c>.
///
/// Sign-in, sign-up and password reset cost an attacker nothing, which is the
/// asymmetry these exist to close: unlimited sign-in attempts are offline
/// password cracking with our server doing the bcrypt, and an unlimited "email
/// me a reset link" is a way to use this domain to flood someone else's inbox.
///
/// Generous enough that a real person never sees one; tight enough that
/// automation does. Only the M1 rules are here — the rest arrive with the
/// modules that need them.
/// </summary>
public static class RateLimits
{
    /// <summary>
    /// Per email address. Cleared on a successful sign-in, so someone who
    /// mistypes twice and then gets it right starts fresh — an attacker never
    /// reaches the clearing code.
    /// </summary>
    public static readonly RateLimitRule SigninEmail = new(
        "signin:email", 8, TimeSpan.FromMinutes(15),
        "Too many sign-in attempts. Try again in a few minutes.");

    /// <summary>
    /// Per client, across every address they try.
    ///
    /// Both halves are needed and neither is sufficient: per-email alone lets a
    /// botnet spread one password across every account, per-client alone lets
    /// one attacker rotate addresses. Together they cover both shapes, and a
    /// single legitimate user trips neither.
    /// </summary>
    public static readonly RateLimitRule SigninClient = new(
        "signin:client", 20, TimeSpan.FromMinutes(15),
        "Too many sign-in attempts. Try again in a few minutes.");

    public static readonly RateLimitRule Signup = new(
        "signup", 5, TimeSpan.FromHours(1),
        "Too many accounts created from here. Try again later.");

    /// <summary>Covers forgot-password, reset-password and resend-verification.</summary>
    public static readonly RateLimitRule EmailSend = new(
        "email-send", 5, TimeSpan.FromHours(1),
        "Too many requests. Check your inbox, or try again later.");

    /// <summary>
    /// Token rotation for native clients. A stolen refresh token is worth
    /// grinding at, and a client looping on a failed refresh should not be free.
    /// </summary>
    public static readonly RateLimitRule Refresh = new(
        "auth:refresh", 60, TimeSpan.FromHours(1),
        "Too many refresh attempts. Sign in again.");

    /// <summary>Starting a membership checkout: creates a customer and a session at the provider.</summary>
    /// <summary>Writes from the admin console, per member of staff.</summary>
    public static readonly RateLimitRule AdminWrite = new(
        "admin-write", 120, TimeSpan.FromHours(1),
        "Too many administrative changes in a short time.");

    public static readonly RateLimitRule Checkout = new(
        "checkout", 10, TimeSpan.FromHours(1),
        "Too many checkout attempts. Try again shortly.");

    /// <summary>
    /// Asking the payment provider where something stands. The membership and
    /// order pages poll it while a payment settles, and every call reaches
    /// the provider.
    /// </summary>
    public static readonly RateLimitRule ProviderSync = new(
        "provider-sync", 60, TimeSpan.FromHours(1),
        "Too many refreshes. Try again in a few minutes.");
}

/// <summary>
/// Runtime settings an administrator can change without a deploy.
///
/// Deliberately a short list. A setting earns a row here only if someone would
/// genuinely need to change it at 2am without shipping code; everything else is
/// configuration, where it cannot be flipped by whoever compromises an admin
/// account.
/// </summary>
public sealed record SystemSettings(
    /// <summary>When false, signup refuses new accounts with a 503.</summary>
    bool SignupsOpen,
    /// <summary>Non-empty text shows a site-wide banner.</summary>
    string MaintenanceBanner,
    /// <summary>
    /// Whether /login offers the one-tap demo accounts and prints their shared
    /// password. Defaults to false outside development: a published password on
    /// a seeded database is a working login for anyone who reads the page.
    /// </summary>
    bool DemoLoginVisible,
    /// <summary>Order subtotal at or above which shipping is free, in integer cents.</summary>
    int FreeShippingThresholdCents);
