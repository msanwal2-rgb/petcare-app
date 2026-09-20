namespace Leash.Api.Infrastructure.Http;

/// <summary>
/// The error envelope. Every failure in the API uses one of these shapes.
///
/// This is a contract, not a convenience. The frontend's fetch layer
/// (web/src/api/_client.ts) parses it, and several screens read the structured
/// extras: the re-quoted cart on a 409, the product that sold out, the order
/// whose payment could not be started. Drift here presents as unrelated UI bugs
/// across every form in the app, so it is settled once, here, in M0.
///
/// See REQUIREMENTS.md §2.1 for the full table.
/// </summary>
public static class ApiResults
{
    /// <summary>One validation failure, flattened to a path the client can map to a field.</summary>
    public sealed record Issue(string Path, string Message);

    private sealed record ErrorBody(string Error, IEnumerable<Issue>? Issues = null);

    /// <summary>400 — the request was understood but is not valid.</summary>
    public static IResult BadRequest(string message, IEnumerable<Issue>? issues = null)
        => Results.Json(new ErrorBody(message, issues), statusCode: StatusCodes.Status400BadRequest);

    /// <summary>
    /// 400 from a FluentValidation failure, in the exact shape the client expects:
    /// <c>{ "error": "Validation failed", "issues": [{ "path": "...", "message": "..." }] }</c>
    /// </summary>
    public static IResult ValidationFailed(IEnumerable<Issue> issues)
        => BadRequest("Validation failed", issues);

    /// <summary>
    /// 401 — not signed in, or the session is no longer valid.
    ///
    /// Deliberately 401 rather than 403 for a suspended or deleted account: the
    /// correct client response is to sign out, not to retry with the same cookie.
    /// </summary>
    public static IResult Unauthorized(string message = "You must be signed in")
        => Results.Json(new ErrorBody(message), statusCode: StatusCodes.Status401Unauthorized);

    /// <summary>
    /// 403 — a known caller being told no.
    ///
    /// Not 404: the existence of an admin route is not a secret worth keeping.
    /// The access is what matters.
    /// </summary>
    public static IResult Forbidden(string message = "Not allowed")
        => Results.Json(new ErrorBody(message), statusCode: StatusCodes.Status403Forbidden);

    /// <summary>404.</summary>
    public static IResult NotFound(string message = "Not found")
        => Results.Json(new ErrorBody(message), statusCode: StatusCodes.Status404NotFound);

    /// <summary>
    /// 409 — well-formed, but no longer satisfiable. An illegal status transition,
    /// or a cart that cannot be fulfilled.
    ///
    /// <paramref name="extra"/> carries the endpoint-specific payload the UI needs
    /// to explain which line is the problem: <c>quote</c>, <c>productId</c>.
    /// </summary>
    public static IResult Conflict(string message, object? extra = null)
        => Json(StatusCodes.Status409Conflict, message, extra);

    /// <summary>
    /// 502 — the payment provider failed. The order exists and holds its stock;
    /// only the intent failed, so <c>orderId</c> comes back and the client retries
    /// that step rather than the whole cart.
    /// </summary>
    public static IResult BadGateway(string message, object? extra = null)
        => Json(StatusCodes.Status502BadGateway, message, extra);

    /// <summary>503 — a feature that is deliberately not configured on this deployment.</summary>
    public static IResult Unavailable(string message)
        => Results.Json(new ErrorBody(message), statusCode: StatusCodes.Status503ServiceUnavailable);

    /// <summary>Merge `extra` into the envelope alongside `error`, rather than nesting it.</summary>
    private static IResult Json(int status, string message, object? extra)
    {
        var payload = new Dictionary<string, object?> { ["error"] = message };
        if (extra is not null)
            foreach (var p in extra.GetType().GetProperties())
                payload[Camel(p.Name)] = p.GetValue(extra);
        return Results.Json(payload, statusCode: status);
    }

    private static string Camel(string s)
        => string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s[1..];
}
