using System.IdentityModel.Tokens.Jwt;
using System.Security.Cryptography;
using System.Text;
using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace Leash.Core.Services;

/// <summary>
/// The mobile half of dual auth (REQUIREMENTS.md A18): a short-lived JWT access
/// token plus a long-lived, single-use, rotating refresh token.
///
/// The asymmetry between the two is the point. The access token is
/// self-contained and never looked up, so the common case costs nothing; it is
/// short enough that the revocation watermark closes the gap within minutes. The
/// refresh token is the opposite — one database row, single use, rotated on
/// every use, so a stolen one is detectable rather than merely long-lived.
/// </summary>
public sealed class TokenService : ITokenService
{
    /// <summary>The claim carrying the user id, in both credentials.</summary>
    public const string SubjectClaim = "sub";

    /// <summary>
    /// Short, because the access token is the credential nothing re-checks
    /// against the database. Fifteen minutes is the window in which a
    /// suspension has not taken effect yet.
    /// </summary>
    public static readonly TimeSpan AccessLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Long, because a phone that has been in a drawer for a month should not
    /// force a fresh sign-in. Safe only because rotation makes reuse visible.
    /// </summary>
    public static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);

    private readonly IRefreshTokenRepository _tokens;
    private readonly ISessionValidator _sessions;
    private readonly IUnitOfWork _unitOfWork;
    private readonly SigningCredentials _signing;
    private readonly string _issuer;
    private readonly string _audience;

    public TokenService(
        IRefreshTokenRepository tokens,
        ISessionValidator sessions,
        IUnitOfWork unitOfWork,
        IConfiguration config)
    {
        _tokens = tokens;
        _sessions = sessions;
        _unitOfWork = unitOfWork;

        var secret = config["Auth:Secret"]
            ?? throw new InvalidOperationException(
                "Auth:Secret is not set. It signs session cookies and mobile " +
                "access tokens; without it neither can be issued.");

        // HS256 rather than a key pair: there is one issuer and one verifier,
        // both this process, so asymmetric signing would add key distribution
        // for no benefit. Revisit if a second service ever verifies these.
        _signing = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            SecurityAlgorithms.HmacSha256);

        _issuer = config["Auth:Issuer"] ?? "leash";
        _audience = config["Auth:Audience"] ?? "leash-app";
    }

    public object ValidationParameters => new TokenValidationParameters
    {
        ValidIssuer = _issuer,
        ValidAudience = _audience,
        IssuerSigningKey = _signing.Key,
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateIssuerSigningKey = true,
        ValidateLifetime = true,

        // The access token is minutes long; a generous skew would undo that.
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = SubjectClaim,
    };

    public async Task<TokenPairDto> IssueAsync(
        string userId, string userAgent, CancellationToken ct = default)
    {
        var now = Ids.Now();
        var raw = NewRefreshToken();

        await _tokens.CreateAsync(
            Ids.New("rt"), userId, HashToken(raw), now,
            now.Add(RefreshLifetime), userAgent, ct: ct);

        return new TokenPairDto(
            WriteAccessToken(userId, now), raw, (int)AccessLifetime.TotalSeconds);
    }

    /// <summary>
    /// Spend a refresh token and issue the next pair.
    ///
    /// The whole sequence runs in one transaction, holding a row lock from the
    /// first read to the final write. That is not defensive padding — it is the
    /// only thing that makes "single use" true. Two refreshes arriving together
    /// on one token would otherwise both read an unrevoked row and both mint a
    /// pair, and rotation would be a long-lived bearer token with extra steps.
    ///
    /// Every failure mode is distinguished internally and collapsed to one
    /// message at the controller: a caller learns that refreshing failed, not
    /// which of the reasons applied.
    /// </summary>
    public async Task<(TokenPairDto? Pair, RefreshFailure? Failure)> RotateAsync(
        string rawRefreshToken, string userAgent, CancellationToken ct = default)
    {
        var hash = HashToken(rawRefreshToken);
        var now = Ids.Now();

        await using var scope = await _unitOfWork.BeginAsync(ct);

        var row = await _tokens.FindForUpdateAsync(hash, scope, ct);
        if (row is null) return (null, RefreshFailure.Invalid);

        // An already-rotated token came back. An honest client cannot do this:
        // it discarded the old token when it received the new one. So either it
        // was stolen, or the legitimate client never received its replacement —
        // and both are best answered by ending every session on the account.
        if (row.RevokedAt is not null)
        {
            await _tokens.RevokeAllForUserAsync(row.UserId, now, scope, ct);
            await scope.CommitAsync(ct);
            return (null, RefreshFailure.Replayed);
        }

        if (row.ExpiresAt <= now) return (null, RefreshFailure.Invalid);

        // The watermark applies to refresh tokens too, so a password reset ends
        // mobile sessions without having to find their rows. Read inside the
        // transaction, so a suspension landing mid-rotation is not missed.
        if (await _sessions.ValidateAsync(row.UserId, row.IssuedAt, ct) is not null)
            return (null, RefreshFailure.Rejected);

        var raw = NewRefreshToken();
        var replacementId = Ids.New("rt");

        await _tokens.CreateAsync(
            replacementId, row.UserId, HashToken(raw), now,
            now.Add(RefreshLifetime), userAgent, scope, ct);

        await _tokens.MarkRotatedAsync(row.Id, replacementId, now, scope, ct);

        await scope.CommitAsync(ct);

        return (new TokenPairDto(
            WriteAccessToken(row.UserId, now), raw, (int)AccessLifetime.TotalSeconds), null);
    }

    public Task RevokeAllForUserAsync(string userId, CancellationToken ct = default)
        => _tokens.RevokeAllForUserAsync(userId, Ids.Now(), ct: ct);

    private string WriteAccessToken(string userId, DateTimeOffset issuedAt)
    {
        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims:
            [
                new(SubjectClaim, userId),

                // A unique id per token, so one can be named in a log without
                // quoting the token itself.
                new("jti", Guid.NewGuid().ToString()),
            ],
            notBefore: issuedAt.UtcDateTime,
            expires: issuedAt.Add(AccessLifetime).UtcDateTime,
            signingCredentials: _signing);

        // JwtSecurityToken writes iat from its own clock, which drifts from the
        // instant this session was actually established. The watermark
        // comparison reads iat, so it is set explicitly rather than left to land
        // a few milliseconds off.
        token.Payload["iat"] = issuedAt.ToUnixTimeSeconds();

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// 32 bytes from a CSPRNG. The token is the credential; it is not derived
    /// from anything guessable about the account.
    /// </summary>
    private static string NewRefreshToken()
        => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    /// <summary>
    /// Only the hash is stored, as with verification tokens: a dump of
    /// <c>refresh_tokens</c> is not a set of working logins.
    /// </summary>
    private static string HashToken(string raw)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
