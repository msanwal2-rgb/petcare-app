using System.Security.Claims;
using Leash.Core.Services;

namespace Leash.Api.Auth;

public static class CurrentUser
{
    /// <summary>
    /// The signed-in user's id, or null.
    ///
    /// Reads "sub" first — what this API issues — then the mapped
    /// <see cref="ClaimTypes.NameIdentifier"/>, because the JWT middleware will
    /// translate inbound claim names for you if it is ever configured to.
    /// Checking both costs nothing and removes a class of bug where auth works
    /// on one scheme and silently returns null on the other.
    /// </summary>
    public static string? UserId(this ClaimsPrincipal principal)
        => principal.FindFirst(AuthClaims.Subject)?.Value
           ?? principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;

    /// <summary>
    /// The signed-in user's id, or throw.
    ///
    /// Only for actions behind <c>[Authorize]</c>, where a missing id means the
    /// pipeline is misconfigured rather than that the caller is anonymous — so
    /// it is a bug to surface, not a 401 to return.
    /// </summary>
    public static string RequireUserId(this ClaimsPrincipal principal)
        => principal.UserId()
           ?? throw new InvalidOperationException(
               "No user id on an authenticated principal. The action is missing " +
               "[Authorize], or the scheme issued a ticket without a 'sub' claim.");
}

/// <summary>
/// Writes the error envelope for an authentication failure.
///
/// Cookie authentication's default answer to an unauthenticated request is a
/// 302 to a login page, which is right for a server-rendered site and wrong
/// here: the client is a fetch call whose error handling parses JSON, and a
/// redirect to HTML surfaces as an unrelated parse error. So every challenge and
/// forbid comes through here instead.
/// </summary>
public static class AuthResponses
{
    public static Task Unauthorized(HttpContext context)
    {
        var reason = context.Items.TryGetValue(AuthFailureItems.Key, out var stashed)
            && stashed is string message
                ? message
                : AuthFailureReason.NotSignedIn;

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.ContentType = "application/json";
        return context.Response.WriteAsJsonAsync(new { error = reason });
    }

    public static Task Forbidden(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        context.Response.ContentType = "application/json";
        return context.Response.WriteAsJsonAsync(new { error = "Not allowed" });
    }
}
