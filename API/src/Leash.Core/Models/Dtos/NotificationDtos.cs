namespace Leash.Core.Models.Dtos;

/// <summary>One notification, as <c>web/src/types</c> declares it.</summary>
public sealed record NotificationDto(
    string Id,
    string UserId,
    string Kind,
    string Title,
    string Body,
    string Href,
    DateTimeOffset? ReadAt,
    DateTimeOffset CreatedAt);

/// <summary>
/// <c>GET /notifications</c>: the caller's own, newest first, with the unread
/// count across all of them (not just this page). <see cref="NextCursor"/> is
/// null at the end, as on every other list.
/// </summary>
public sealed record NotificationFeed(NotificationDto[] Items, int Unread, string? NextCursor);

/// <summary>
/// <c>POST /notifications</c>: mark these read.
///
/// <b>The ids are required</b> (REQUIREMENTS.md N7). The reference took an
/// optional id and cleared <i>everything</i> without one, so opening the bell
/// also cleared notifications that arrived after the panel was fetched and
/// every one beyond the thirty it showed — things the person never saw.
/// The client sends the ids it rendered; nothing else changes.
/// </summary>
public sealed record MarkNotificationsReadRequest(string[] Ids);

public sealed record MarkNotificationsReadResult(int Unread);

/// <summary>What a status machine says when it notifies somebody.</summary>
public sealed record NotifyInput(string Kind, string Title, string Body, string Href);

/// <summary>What one drain of the outbox did. For the log line and the tests.</summary>
public sealed record OutboxReport(int Claimed, int Sent, int Retried, int Failed, int Skipped);
