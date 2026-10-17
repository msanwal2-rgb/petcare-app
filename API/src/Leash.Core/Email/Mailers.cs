using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Leash.Core.Email;

/// <summary>
/// The fallback with no provider configured: log the message, including the
/// link, so the verification and reset flows are fully exercisable locally.
///
/// Registered whenever <c>Email:ResendApiKey</c> is absent, which is the
/// normal state of a development machine and of the test suite.
/// </summary>
public sealed class LogMailer(ILogger<LogMailer> log) : IMailer
{
    public Task SendAsync(MailMessage message, CancellationToken ct = default)
    {
        log.LogInformation(
            "[mailer:dev] To: {To}\nSubject: {Subject}\n{Text}",
            message.To, message.Subject, message.Text);
        return Task.CompletedTask;
    }
}

/// <summary>
/// Real delivery via Resend.
///
/// Worth configuring before taking payments: a membership whose renewal fails
/// emails the member a link to fix their card, and without a provider that
/// email is a line in a server log nobody reads.
/// </summary>
public sealed class ResendMailer(HttpClient http, IConfiguration config) : IMailer
{
    private readonly string _apiKey = config["Email:ResendApiKey"]!;
    private readonly string _from = config["Email:From"] ?? "Leash <onboarding@resend.dev>";

    public async Task SendAsync(MailMessage message, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.resend.com/emails")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new
                {
                    from = _from,
                    to = message.To,
                    subject = message.Subject,
                    html = message.Html,
                    text = message.Text,
                }),
                Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        // Resend drops a second request with the same key, which is what makes
        // the outbox's at-least-once delivery read as exactly-once in an inbox.
        if (message.IdempotencyKey is not null)
            request.Headers.Add("Idempotency-Key", message.IdempotencyKey);

        using var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var detail = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Email send failed ({(int)response.StatusCode}): {detail}");
        }
    }
}
