using System.Net;
using System.Security.Cryptography;
using System.Text;
using Leash.Core.Configuration;
using Leash.Core.Email;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Security;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

public sealed class EmailFlowService(
    IUserRepository users,
    IVerificationTokenRepository tokens,
    IRefreshTokenRepository refreshTokens,
    IUnitOfWork unitOfWork,
    IMailer mailer,
    AppOrigin origin) : IEmailFlowService
{
    private static readonly Dictionary<string, TimeSpan> Ttl = new()
    {
        // Long enough to survive an email sitting unread overnight.
        [TokenTypes.VerifyEmail] = TimeSpan.FromHours(24),

        // Short, because it is a password bypass sitting in someone's inbox.
        [TokenTypes.ResetPassword] = TimeSpan.FromHours(1),
    };

    public async Task<string> RequestEmailVerificationAsync(
        string userId, string email, string name, CancellationToken ct = default)
    {
        var raw = await IssueTokenAsync(userId, TokenTypes.VerifyEmail, ct);
        var link = origin.Url($"/verify-email?token={Uri.EscapeDataString(raw)}");

        var (html, text) = Shell(
            "Verify your email",
            $"Hi {FirstName(name)}, confirm your email to finish setting up your Leash account.",
            link, "Verify email");

        await mailer.SendAsync(
            new MailMessage(email, "Verify your Leash email", html, text), ct);

        return link;
    }

    public async Task<UserDto?> VerifyEmailAsync(
        string rawToken, CancellationToken ct = default)
    {
        // Consume and apply together: a token spent without the flag being set
        // means the person clicked a valid link and stayed unverified, with the
        // link now useless.
        await using var scope = await unitOfWork.BeginAsync(ct);

        var userId = await ConsumeTokenAsync(rawToken, TokenTypes.VerifyEmail, scope, ct);
        if (userId is null) return null;

        var updated = await users.MarkVerifiedAsync(userId, scope, ct);
        if (updated is null) return null;

        await scope.CommitAsync(ct);
        return updated.ToDto();
    }

    public async Task<string?> RequestPasswordResetAsync(
        string email, CancellationToken ct = default)
    {
        var user = await users.GetByEmailAsync(email, ct: ct);

        // No link and no error. The difference between "we sent one" and "no
        // such account" is an account-enumeration oracle.
        if (user is null) return null;

        var raw = await IssueTokenAsync(user.Id, TokenTypes.ResetPassword, ct);
        var link = origin.Url($"/reset-password?token={Uri.EscapeDataString(raw)}");

        var (html, text) = Shell(
            "Reset your password",
            "We received a request to reset your Leash password. This link expires in 1 hour. " +
            "If you didn't ask for this, you can ignore this email.",
            link, "Reset password");

        await mailer.SendAsync(
            new MailMessage(user.Email, "Reset your Leash password", html, text), ct);

        return link;
    }

    /// <summary>
    /// Consume a reset token, set the new password, bump the revocation
    /// watermark and drop every refresh token — all in one transaction.
    ///
    /// This is the operation where a partial write is actively harmful. Someone
    /// resets their password <em>because</em> their account was compromised; if
    /// the hash lands and the watermark does not, the attacker's cookie stays
    /// valid for its full thirty days and the reset accomplished nothing it was
    /// for. Four writes, one commit (REQUIREMENTS.md A5).
    /// </summary>
    public async Task<bool> ResetPasswordAsync(
        string rawToken, string newPassword, CancellationToken ct = default)
    {
        // Hashing is deliberately outside the transaction: bcrypt at cost 10 is
        // ~100ms of CPU, and holding a row lock across it would serialise
        // unrelated resets behind each other.
        var passwordHash = Passwords.Hash(newPassword);
        var now = Ids.Now();

        await using var scope = await unitOfWork.BeginAsync(ct);

        var userId = await ConsumeTokenAsync(rawToken, TokenTypes.ResetPassword, scope, ct);
        if (userId is null) return false;

        if (!await users.SetPasswordAndRevokeSessionsAsync(
                userId, passwordHash, now, scope, ct))
            return false;

        // The watermark already refuses them, but leaving the rows would let a
        // stolen refresh token sit there until it expired, showing up in any
        // audit of live sessions as though it were one.
        await refreshTokens.RevokeAllForUserAsync(userId, now, scope, ct);

        await scope.CommitAsync(ct);
        return true;
    }

    /// <summary>
    /// Mint a token, store only its hash, and return the raw value to email.
    ///
    /// Hashed rather than encrypted because nothing ever needs to read a token
    /// back: verification only asks "does the token presented match one we
    /// issued?", and a one-way function answers that.
    /// </summary>
    private async Task<string> IssueTokenAsync(
        string identifier, string type, CancellationToken ct)
    {
        var raw = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        var now = Ids.Now();

        await tokens.CreateAsync(
            Ids.New("tok"), identifier, HashToken(raw), type,
            now.Add(Ttl[type]), now, ct: ct);

        return raw;
    }

    /// <summary>
    /// Spend a token and return its identifier, or null if it is unknown,
    /// expired, or of the wrong type.
    ///
    /// Type is checked rather than assumed: a verification token and a reset
    /// token are both 32 random bytes, and without this check a link that only
    /// proves "you can read this inbox" would also set a password.
    /// </summary>
    private async Task<string?> ConsumeTokenAsync(
        string raw, string type, ITransactionScope scope, CancellationToken ct)
    {
        var row = await tokens.ConsumeAsync(HashToken(raw), scope, ct);

        if (row is null) return null;
        if (row.Type != type) return null;
        if (row.ExpiresAt <= Ids.Now()) return null;

        return row.Identifier;
    }

    private static string HashToken(string raw)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    private static string FirstName(string name)
        => name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? name;

    /// <summary>
    /// The one email template.
    ///
    /// Every interpolated value is HTML-escaped. Two of them — the display name
    /// and the link — are attacker-influenced: a name is whatever someone typed
    /// at signup, and an unescaped one closes the anchor and injects markup into
    /// mail we send from our own domain.
    /// </summary>
    private static (string Html, string Text) Shell(
        string title, string intro, string link, string cta)
    {
        Func<string, string> e = WebUtility.HtmlEncode;

        var html = $"""
            <div style="font-family:sans-serif;max-width:480px;margin:auto">
              <h2>{e(title)}</h2>
              <p>{e(intro)}</p>
              <p><a href="{e(link)}" style="display:inline-block;background:#1b3b36;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">{e(cta)}</a></p>
              <p style="color:#888;font-size:12px">Or paste this link: {e(link)}</p>
            </div>
            """;

        return (html, $"{title}\n\n{intro}\n\n{cta}: {link}");
    }
}
