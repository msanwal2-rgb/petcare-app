using Leash.Core.Services.Interfaces;

namespace Leash.Api.Http;

/// <summary>
/// The rate-limit key for the caller's machine — the same derivation as
/// <c>AuthController</c>'s: the first <c>X-Forwarded-For</c> hop, else
/// <c>X-Real-IP</c>, else the connection, with the user agent. Reading the
/// request is the API's job; hashing and salting it is the service's.
/// </summary>
public static class ClientKeys
{
    public static string For(HttpRequest request, IRateLimitService rateLimits)
    {
        var forwarded = request.Headers["X-Forwarded-For"].FirstOrDefault();

        var ip =
            forwarded?.Split(',').FirstOrDefault()?.Trim() is { Length: > 0 } fwd ? fwd
            : request.Headers["X-Real-IP"].FirstOrDefault() is { Length: > 0 } real ? real
            : request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return rateLimits.ClientKey(ip, request.Headers.UserAgent.FirstOrDefault() ?? string.Empty);
    }
}
