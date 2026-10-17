using Leash.Core.Persistence;
using Leash.Core.Services.Interfaces;

namespace Leash.Api.Jobs;

/// <summary>
/// Runs <see cref="IFulfilmentService"/> on an interval (REQUIREMENTS.md S16), and
/// the payments housekeeping beside it: retrying refunds the provider never
/// acknowledged, and purging old webhook payloads.
///
/// ── Why the interval barely matters ──
///
/// The service advances each order to the stage its <i>age</i> has earned, so
/// it is idempotent and correct at any cadence — run it every ten minutes or
/// once a day and orders end up in the same place. The default is hourly: often
/// enough that a demo order visibly moves, rare enough to be no load.
///
/// ── Configuration ──
///
/// <c>Fulfilment:Enabled</c> (default true) and
/// <c>Fulfilment:IntervalMinutes</c> (default 60). The integration tests turn
/// it off, because a background job advancing the seeded orders while a test
/// asserts on them is the kind of flake that takes a day to find.
///
/// ── Scaling out ──
///
/// <b>Run this on one instance.</b> Two instances running it concurrently are
/// <i>safe</i> — every move is conditional on the status that was read, so the
/// loser of a race simply does nothing — but they would do the same work twice.
/// When the API runs on more than one machine, either set
/// <c>Fulfilment:Enabled=false</c> on all but one, or move this to a scheduled
/// job. That is a deploy decision and is noted in STATUS.md.
/// </summary>
public sealed class FulfilmentWorker(
    IServiceProvider services,
    IConfiguration config,
    ILogger<FulfilmentWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Fulfilment:Enabled", true))
        {
            log.LogInformation("Fulfilment job disabled by configuration");
            return;
        }

        var interval = TimeSpan.FromMinutes(
            Math.Max(1, config.GetValue("Fulfilment:IntervalMinutes", 60)));

        // A short pause first, so the job does not compete with startup and so a
        // process that crashes on boot does not also move orders on its way down.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(interval);

        do
        {
            try
            {
                var fulfilment = services.GetRequiredService<IFulfilmentService>();
                var report = await fulfilment.RunAsync(Ids.Now(), stoppingToken);

                if (report.Advanced.Count > 0 || report.AbandonedReleased.Count > 0)
                {
                    log.LogInformation(
                        "Fulfilment: scanned {Scanned}, advanced {Advanced}, released {Released} abandoned checkouts",
                        report.Scanned, report.Advanced.Count, report.AbandonedReleased.Count);
                }

                // Payments housekeeping rides on the same tick: it is the same
                // one-instance, idempotent kind of work. Refunds the provider never
                // acknowledged are re-sent under their original key, and settled
                // webhook payloads — email addresses, card last-fours — are dropped
                // once nobody will replay them.
                var retried = await services.GetRequiredService<Core.Services.Interfaces.IPaymentLedger>()
                    .RetryUnacknowledgedRefundsAsync(Ids.Now(), TimeSpan.FromMinutes(10), stoppingToken);
                var purged = await services.GetRequiredService<Core.Payments.IWebhookEventStore>()
                    .PurgeOldEventsAsync(Ids.Now(), retentionDays: 90, stoppingToken);

                if (retried > 0 || purged > 0)
                {
                    log.LogInformation("Payments: retried {Retried} unacknowledged refunds, purged {Purged} webhook events",
                        retried, purged);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception e)
            {
                // Logged and survived. A job that dies on one bad row stops
                // moving every other order too, and nothing would say so.
                log.LogError(e, "Fulfilment run failed; will retry next interval");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }
}
