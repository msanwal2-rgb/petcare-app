using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>One <c>notifications</c> row — the in-app channel.</summary>
public class NotificationEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Href { get; set; } = "";
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>The tie-break for "newest first". Never on the wire.</summary>
    public long Seq { get; set; }

    public NotificationDto ToDto() => new(Id, UserId, Kind, Title, Body, Href, ReadAt, CreatedAt);
}

/// <summary>
/// A claimed <c>notification_outbox</c> row, joined to what delivering it
/// needs: the notification and its recipient.
///
/// The recipient's address is read at delivery time rather than copied into the
/// outbox when it is enqueued, so the outbox holds no personal data of its own
/// and an account deleted in the meantime is noticed (and skipped) rather than
/// emailed.
/// </summary>
public class OutboxDeliveryEntity
{
    public string Id { get; set; } = "";
    public string Channel { get; set; } = "";
    public int Attempts { get; set; }
    public DateTimeOffset LockedAt { get; set; }

    public string NotificationId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string Href { get; set; } = "";

    public string RecipientEmail { get; set; } = "";
    public string RecipientName { get; set; } = "";
    public string RecipientStatus { get; set; } = "";
}
