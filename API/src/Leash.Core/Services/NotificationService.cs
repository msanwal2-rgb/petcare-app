using System.Globalization;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Notifications;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace Leash.Core.Services;

/// <summary>See <see cref="INotifier"/>.</summary>
public sealed class Notifier(
    INotificationRepository notifications,
    IEnumerable<INotificationChannel> channels,
    IUnitOfWork unitOfWork,
    ILogger<Notifier> log) : INotifier
{
    private readonly string[] _outOfBand =
        [.. channels.Where(c => c.Enabled).Select(c => c.Name).Distinct()];

    public async Task<NotificationDto?> NotifyAsync(
        string userId, NotifyInput input, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        if (scope is not null) return await WriteAsync(userId, input, scope, ct);

        try
        {
            await using var own = await unitOfWork.BeginAsync(ct);
            var written = await WriteAsync(userId, input, own, ct);
            await own.CommitAsync(ct);
            return written;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Could not record a {Kind} notification for {UserId}", input.Kind, userId);
            return null;
        }
    }

    private async Task<NotificationDto?> WriteAsync(
        string userId, NotifyInput input, ITransactionScope scope, CancellationToken ct)
    {
        var now = Ids.Now();

        var row = await notifications.InsertAsync(new NotificationEntity
        {
            Id = Ids.New("n"),
            UserId = userId,
            Kind = input.Kind,
            Title = input.Title,
            Body = input.Body,
            Href = input.Href,
            CreatedAt = now,
        }, scope, ct);

        if (row is null) return null;

        await notifications.EnqueueAsync(row.Id, _outOfBand, now, scope, ct);
        return row.ToDto();
    }
}

/// <summary>See <see cref="INotificationService"/>.</summary>
public sealed class NotificationService(INotificationRepository notifications) : INotificationService
{
    public const int DefaultLimit = 30;
    public const int MaxLimit = 50;

    public async Task<NotificationFeed> ListMineAsync(
        string callerId, string? cursor, int limit = DefaultLimit, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, MaxLimit);

        var (beforeAt, beforeSeq) = DecodeCursor(cursor);
        var rows = await notifications.ListForUserAsync(callerId, beforeAt, beforeSeq, limit, ct: ct);

        var page = rows.Take(limit).ToArray();
        var next = rows.Count > limit
            ? Cursor.EncodeParts(
                page[^1].CreatedAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
                page[^1].Seq.ToString(CultureInfo.InvariantCulture))
            : null;

        var unread = await notifications.CountUnreadAsync(callerId, ct: ct);
        return new NotificationFeed([.. page.Select(n => n.ToDto())], unread, next);
    }

    public async Task<MarkNotificationsReadResult> MarkReadAsync(
        string callerId, IReadOnlyCollection<string> ids, CancellationToken ct = default)
    {
        await notifications.MarkReadAsync(callerId, ids, Ids.Now(), ct: ct);
        return new MarkNotificationsReadResult(await notifications.CountUnreadAsync(callerId, ct: ct));
    }

    /// <summary>Anything unparseable starts from the top, as with every cursor here.</summary>
    private static (DateTimeOffset? At, long? Seq) DecodeCursor(string? cursor)
    {
        var parts = Cursor.DecodeParts(cursor, 2);
        if (parts is null) return (null, null);

        var okAt = DateTimeOffset.TryParse(
            parts[0], CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at);
        var okSeq = long.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var seq);

        return okAt && okSeq ? (at, seq) : (null, null);
    }
}

/// <summary>
/// See <see cref="INotificationOutbox"/>. Delivery is at-least-once: a drain
/// that sends and then dies before recording it leaves a row that is sent
/// again once its lease expires. The email carries the outbox id as its
/// idempotency key so the provider can drop that duplicate.
/// </summary>
public sealed class NotificationOutbox(
    INotificationRepository notifications,
    IEnumerable<INotificationChannel> channels,
    ILogger<NotificationOutbox> log) : INotificationOutbox
{
    /// <summary>A drain that has held a row this long is presumed dead, and the row is claimable again.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(5);

    /// <summary>The wait after each failed attempt. One more failure than there are entries gives up.</summary>
    public static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(30),
        TimeSpan.FromHours(2),
        TimeSpan.FromHours(6),
    ];

    public static int MaxAttempts => Backoff.Length + 1;

    private readonly Dictionary<string, INotificationChannel> _channels =
        channels.GroupBy(c => c.Name).ToDictionary(g => g.Key, g => g.First());

    public async Task<OutboxReport> DrainAsync(
        DateTimeOffset now, int batchSize = 25, CancellationToken ct = default)
    {
        var claimed = await notifications.ClaimDueAsync(now, now - Lease, batchSize, ct);
        int sent = 0, retried = 0, failed = 0, skipped = 0;

        foreach (var delivery in claimed)
        {
            if (!_channels.TryGetValue(delivery.Channel, out var channel) || !channel.Enabled)
            {
                await notifications.CompleteAsync(
                    delivery.Id, delivery.LockedAt, OutboxStatuses.Skipped, null,
                    $"Channel '{delivery.Channel}' is not available", ct);
                skipped++;
                continue;
            }

            // A suspended or deleted account is not emailed about its bookings.
            // Deleted accounts have had their address scrubbed (A16) anyway.
            // A guest is (STATUS §3-G): their inbox is all they have to go on.
            if (delivery.RecipientStatus != AccountStatus.Active
                && !AccountStatus.IsUnclaimed(delivery.RecipientStatus))
            {
                await notifications.CompleteAsync(
                    delivery.Id, delivery.LockedAt, OutboxStatuses.Skipped, null,
                    $"Recipient is {delivery.RecipientStatus}", ct);
                skipped++;
                continue;
            }

            try
            {
                await channel.DeliverAsync(delivery, ct);
                await notifications.CompleteAsync(
                    delivery.Id, delivery.LockedAt, OutboxStatuses.Sent, Ids.Now(), null, ct);
                sent++;
            }
            catch (Exception e) when (e is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                var error = Truncate(e.Message, 1000);

                if (delivery.Attempts >= MaxAttempts)
                {
                    log.LogError(e, "Giving up on {Channel} delivery {Id} after {Attempts} attempts",
                        delivery.Channel, delivery.Id, delivery.Attempts);
                    await notifications.CompleteAsync(
                        delivery.Id, delivery.LockedAt, OutboxStatuses.Failed, null, error, ct);
                    failed++;
                }
                else
                {
                    log.LogWarning(e, "{Channel} delivery {Id} failed (attempt {Attempts}); will retry",
                        delivery.Channel, delivery.Id, delivery.Attempts);
                    await notifications.RescheduleAsync(
                        delivery.Id, delivery.LockedAt, now + Backoff[delivery.Attempts - 1], error, ct);
                    retried++;
                }
            }
        }

        return new OutboxReport(claimed.Count, sent, retried, failed, skipped);
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
