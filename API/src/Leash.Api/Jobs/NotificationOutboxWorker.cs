using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;
using Leash.Core.Services.Interfaces;

namespace Leash.Api.Jobs;

/// <summary>
/// Drains <c>notification_outbox</c> (REQUIREMENTS.md N6): the email half of
/// every notification, delivered here rather than fired unawaited from the
/// request that raised it.
///
/// <c>Notifications:Outbox:Enabled</c> (default true) and
/// <c>Notifications:Outbox:IntervalSeconds</c> (default 15). Off under the
/// integration tests, which drive <see cref="INotificationOutbox"/> directly.
///
/// <b>Safe on every instance</b>, unlike the fulfilment job: rows are claimed
/// with <c>FOR UPDATE SKIP LOCKED</c> under a lease, so two drains take
/// disjoint work rather than duplicating it.
/// </summary>
public sealed class NotificationOutboxWorker(
    IServiceProvider services,
    IConfiguration config,
    ILogger<NotificationOutboxWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Notifications:Outbox:Enabled", true))
        {
            log.LogInformation("Notification outbox drain disabled by configuration");
            return;
        }

        var interval = TimeSpan.FromSeconds(
            Math.Max(1, config.GetValue("Notifications:Outbox:IntervalSeconds", 15)));

        using var timer = new PeriodicTimer(interval);

        do
        {
            try
            {
                var outbox = services.GetRequiredService<INotificationOutbox>();

                // Keep going while a drain comes back full, so a backlog clears
                // in one tick rather than one batch per interval.
                OutboxReport report;
                do
                {
                    report = await outbox.DrainAsync(Ids.Now(), ct: stoppingToken);
                    if (report.Claimed > 0)
                    {
                        log.LogInformation(
                            "Outbox: {Sent} sent, {Retried} to retry, {Failed} failed, {Skipped} skipped",
                            report.Sent, report.Retried, report.Failed, report.Skipped);
                    }
                } while (report.Claimed >= 25 && !stoppingToken.IsCancellationRequested);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                log.LogError(e, "Outbox drain failed; will retry next interval");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }
}
