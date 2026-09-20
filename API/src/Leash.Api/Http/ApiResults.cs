using Microsoft.AspNetCore.Mvc;

namespace Leash.Api.Http;

/// <summary>
/// The error envelope. Every failure in the API uses one of these shapes.
///
/// This is a contract, not a convenience. The frontend's fetch layer
/// (web/src/api/_client.ts) parses it, and several screens read the structured
/// extras: the re-quoted cart on a 409, the product that sold out, the order
/// whose payment could not be started. Drift here presents as unrelated UI bugs
/// across every form in the app, so it is settled once, here.
///
/// Controllers return these rather than <c>BadRequest(...)</c> and friends,
/// because the framework's helpers produce <c>ProblemDetails</c> — a different
/// shape with <c>title</c>, <c>status</c> and <c>traceId</c> — and one handler
/// reaching for the wrong one is exactly the drift this prevents.
///
/// See REQUIREMENTS.md section 2.1 for the full table.
/// </summary>
public static class ApiResults
{
    /// <summary>One validation failure, flattened to a path the client can map to a field.</summary>
    public sealed record Issue(string Path, string Message);

    private sealed record ErrorBody(string Error, IEnumerable<Issue>? Issues = null);

    /// <summary>400 — the request was understood but is not valid.</summary>
    public static ObjectResult BadRequest(string message, IEnumerable<Issue>? issues = null)
        => new(new ErrorBody(message, issues)) { StatusCode = StatusCodes.Status400BadRequest };

    /// <summary>
    /// 400 from a validation failure, in the exact shape the client expects:
    /// <c>{ "error": "Validation failed", "issues": [{ "path": "...", "message": "..." }] }</c>
    /// </summary>
    public static ObjectResult ValidationFailed(IEnumerable<Issue> issues)
        => BadRequest("Validation failed", issues);

    /// <summary>
    /// 401 — not signed in, or the session is no longer valid.
    ///
    /// Deliberately 401 rather than 403 for a suspended or deleted account: the
    /// correct client response is to sign out, not to retry with the same
    /// cookie (REQUIREMENTS.md A15).
    /// </summary>
    public static ObjectResult Unauthorized(string message = "You must be signed in")
        => new(new ErrorBody(message)) { StatusCode = StatusCodes.Status401Unauthorized };

    /// <summary>
    /// 403 — a known caller being told no.
    ///
    /// Not 404: the existence of an admin route is not a secret worth keeping.
    /// The access is what matters.
    /// </summary>
    public static ObjectResult Forbidden(string message = "Not allowed")
        => new(new ErrorBody(message)) { StatusCode = StatusCodes.Status403Forbidden };

    /// <summary>404.</summary>
    public static ObjectResult NotFound(string message = "Not found")
        => new(new ErrorBody(message)) { StatusCode = StatusCodes.Status404NotFound };

    /// <summary>
    /// 429 — rate limited.
    ///
    /// Not in the table in REQUIREMENTS section 2.1, which lists the statuses
    /// the domain produces; this one comes from the guard in front of the
    /// credential endpoints (A9).
    ///
    /// The message never says which limit tripped or whether the address
    /// exists — per-email and per-client throttles must be indistinguishable
    /// from the outside, or the 429 itself becomes an account oracle (A10).
    /// </summary>
    public static ObjectResult TooManyRequests(string message, int limit)
        => new(new Dictionary<string, object?> { ["error"] = message, ["limit"] = limit })
        {
            StatusCode = StatusCodes.Status429TooManyRequests,
        };

    /// <summary>
    /// 409 — well-formed, but no longer satisfiable. An illegal status
    /// transition, or a cart that cannot be fulfilled.
    ///
    /// <paramref name="extra"/> carries the endpoint-specific payload the UI
    /// needs to explain which line is the problem: <c>quote</c>,
    /// <c>productId</c>.
    /// </summary>
    public static ObjectResult Conflict(string message, object? extra = null)
        => Merged(StatusCodes.Status409Conflict, message, extra);

    /// <summary>
    /// 502 — the payment provider failed. The order exists and holds its stock;
    /// only the intent failed, so <c>orderId</c> comes back and the client
    /// retries that step rather than the whole cart.
    /// </summary>
    public static ObjectResult BadGateway(string message, object? extra = null)
        => Merged(StatusCodes.Status502BadGateway, message, extra);

    /// <summary>503 — a feature that is deliberately not configured on this deployment.</summary>
    public static ObjectResult Unavailable(string message)
        => new(new ErrorBody(message)) { StatusCode = StatusCodes.Status503ServiceUnavailable };

    /// <summary>Merge `extra` into the envelope alongside `error`, rather than nesting it.</summary>
    private static ObjectResult Merged(int status, string message, object? extra)
    {
        var payload = new Dictionary<string, object?> { ["error"] = message };

        if (extra is not null)
            foreach (var property in extra.GetType().GetProperties())
                payload[Camel(property.Name)] = property.GetValue(extra);

        return new ObjectResult(payload) { StatusCode = status };
    }

    private static string Camel(string s)
        => string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s[1..];
}
