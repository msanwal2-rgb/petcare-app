using Microsoft.Extensions.Configuration;
namespace Leash.Core.Configuration;

/// <summary>
/// The origin that emailed links are built from.
///
/// Deliberately configuration, never the request. The obvious implementation —
/// read the <c>Host</c> header off the request that asked for the reset — is a
/// live account-takeover: a request carrying <c>Host: attacker.example</c>
/// produces a password-reset link pointing at attacker.example with a valid,
/// single-use token in it, and the victim clicks it inside a genuine email
/// from us. The reference project hit exactly this and fixed it the same way
/// (<c>lib/server/origin.ts</c>).
///
/// So this class exists to make the request unavailable at the point where a
/// link is built. There is no overload that takes an <c>HttpRequest</c>.
/// </summary>
public sealed class AppOrigin(IConfiguration config)
{
    private readonly string _origin =
        (config["App:Origin"] ?? "http://localhost:5173").TrimEnd('/');

    /// <summary>
    /// Where this deployment lives, without a trailing slash.
    ///
    /// The development default is the Vite dev server rather than the API's own
    /// port: a verification link has to open the SPA route that reads the
    /// token, and in development that is served by Vite on :5173. In
    /// production the two are one origin anyway.
    /// </summary>
    public override string ToString() => _origin;

    /// <summary>Build an absolute app URL. <paramref name="path"/> starts with '/'.</summary>
    public string Url(string path) => $"{_origin}{path}";
}
