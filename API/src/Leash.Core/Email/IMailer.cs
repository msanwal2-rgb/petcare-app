using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
namespace Leash.Core.Email;

/// <summary>
/// One email. <paramref name="IdempotencyKey"/> is passed to the provider when
/// set, so a retried send of the same message is delivered once.
/// </summary>
public sealed record MailMessage(
    string To, string Subject, string Html, string Text, string? IdempotencyKey = null);

public interface IMailer
{
    Task SendAsync(MailMessage message, CancellationToken ct = default);
}

/// <summary>
/// Whether dev-only endpoints may return the action link in their response
/// bodies, so the verification and reset flows are walkable without an email
/// provider.
///
/// <b>Forced off outside development, whatever configuration says.</b> With it
/// on, <c>POST /auth/forgot-password</c> hands an unauthenticated caller a
/// working password-reset link for any address — that is account takeover as a
/// feature, and in the reference project <c>EMAIL_DEV_MODE=true</c> had been
/// the committed default in the example env file for months. A convenience one
/// misconfigured variable away from giving away every account should not be
/// reachable by misconfiguring that variable.
/// </summary>
public sealed class EmailDevMode(IConfiguration config, IHostEnvironment env)
{
    public bool Enabled { get; } =
        env.IsDevelopment() && config.GetValue("Email:DevMode", false);
}
