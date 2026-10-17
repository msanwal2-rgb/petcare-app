using System.Net;
using Leash.Core.Configuration;
using Leash.Core.Email;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;

namespace Leash.Core.Notifications;

/// <summary>
/// An out-of-band way to reach somebody (REQUIREMENTS.md N3).
///
/// The in-app channel is not one of these: it is the <c>notifications</c> row,
/// written in the announcing transaction. Everything that leaves the process —
/// email now, push later — implements this, gets one outbox row per
/// notification, and is called by the drain, never by the status machine.
/// Adding a channel is a class and a registration; no call site changes.
/// </summary>
public interface INotificationChannel
{
    /// <summary>The <c>notification_outbox.channel</c> value. See <see cref="NotificationChannels"/>.</summary>
    string Name { get; }

    /// <summary>
    /// Whether new notifications are enqueued for this channel. A disabled
    /// channel gets no outbox rows, so nothing piles up waiting for a channel
    /// that does not exist yet.
    /// </summary>
    bool Enabled { get; }

    /// <summary>
    /// Deliver one. Throwing means "try again later" — the drain catches it,
    /// records the message and reschedules with backoff.
    /// </summary>
    Task DeliverAsync(OutboxDeliveryEntity delivery, CancellationToken ct);
}

/// <summary>
/// Email via <see cref="IMailer"/>: Resend when <c>Email:ResendApiKey</c> is
/// set, the logging stand-in otherwise (REQUIREMENTS.md N4).
/// </summary>
public sealed class EmailChannel(IMailer mailer, AppOrigin origin) : INotificationChannel
{
    public string Name => NotificationChannels.Email;

    public bool Enabled => true;

    public Task DeliverAsync(OutboxDeliveryEntity delivery, CancellationToken ct)
        => mailer.SendAsync(NotificationEmail.Render(delivery, origin), ct);
}

/// <summary>
/// Push — the seam, deliberately unimplemented. There are no device tokens to
/// send to until the native app exists (BUILD_PLAN.md §8a). Disabled, so no
/// outbox rows are written for it; if one ever is, delivering it fails loudly
/// rather than reporting a push that never happened as sent.
/// </summary>
public sealed class PushChannel : INotificationChannel
{
    public string Name => NotificationChannels.Push;

    public bool Enabled => false;

    public Task DeliverAsync(OutboxDeliveryEntity delivery, CancellationToken ct)
        => throw new NotSupportedException("Push notifications are not implemented yet.");
}

/// <summary>
/// The notification email.
///
/// <b>Every interpolated value is HTML-encoded</b> (REQUIREMENTS.md N5). The
/// reference built this HTML with template literals around <c>title</c>,
/// <c>body</c> and <c>user.name</c>. Two of those carry text other people
/// typed: a user's own name, and an appointment's <c>reason</c>, which the
/// owner writes and which the confirmation body quotes — so a reason of
/// <c>&lt;a href="https://evil"&gt;Reschedule here&lt;/a&gt;</c> arrived in the
/// owner's inbox as a working link inside a genuine email from us. The plain
/// text part needs no escaping and gets none.
/// </summary>
public static class NotificationEmail
{
    public static MailMessage Render(OutboxDeliveryEntity d, AppOrigin origin)
    {
        var firstName = d.RecipientName.Split(' ', 2)[0];
        var link = SafePath(d.Href) is { } path ? origin.Url(path) : null;

        var line = string.IsNullOrEmpty(d.Body) ? d.Title : $"{d.Title}\n\n{d.Body}";
        var text = $"Hi {firstName},\n\n{line}\n\n"
                   + (link is null ? "" : $"{link}\n\n")
                   + "Leash";

        var html = $"<p>Hi {E(firstName)},</p>"
                   + $"<p><strong>{E(d.Title)}</strong></p>"
                   + (string.IsNullOrEmpty(d.Body) ? "" : $"<p>{E(d.Body)}</p>")
                   + (link is null ? "" : $"<p><a href=\"{E(link)}\">View it on Leash</a></p>")
                   + "<p>— Leash</p>";

        // The outbox row id: a retry after a send whose acknowledgement was
        // lost is the same email, and the provider can drop the duplicate.
        return new MailMessage(d.RecipientEmail, d.Title, html, text, IdempotencyKey: d.Id);
    }

    private static string E(string value) => WebUtility.HtmlEncode(value);

    /// <summary>
    /// The href only if it is an app-relative path. Every href is built by a
    /// status machine from an id, so this never refuses one in practice; it is
    /// here so that "server-built" stays true of the link in the email even if
    /// that ever changes.
    /// </summary>
    private static string? SafePath(string href)
        => href.StartsWith('/') && !href.StartsWith("//", StringComparison.Ordinal) ? href : null;
}
