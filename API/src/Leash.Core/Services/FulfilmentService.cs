using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Automatic order progress (REQUIREMENTS.md S16).
///
/// ── Time-based, not one step per tick ──
///
/// Each order is advanced to whatever stage its <i>age</i> has earned, however
/// many steps that takes. That makes the job idempotent and correct at any
/// interval: run it hourly, daily, or twice by accident, and the result is the
/// same. The reference was pushed into this by a once-a-day cron limit; the
/// property is worth having regardless, because a job that is wrong if it runs
/// late or twice will eventually run late or twice.
///
/// Every move goes through <see cref="IOrderLifecycle.MoveAsync"/>, so
/// transitions are still validated and each one writes its tracking event —
/// the same events a move from the ops console writes.
///
/// <b>Anything off the happy path is left alone.</b> A cancelled or refunded
/// order is somebody's decision, and an unpaid one is a payment problem a timer
/// cannot fix; neither is in <see cref="Delivery.Journey"/>, so neither moves.
/// </summary>
public sealed class FulfilmentService(
    IOrderRepository orders,
    IOrderLifecycle lifecycle) : IFulfilmentService
{
    /// <summary>The page size the job reads the queue in. Bounded, so a backlog is not one query.</summary>
    private const int Batch = 100;

    /// <summary>The carrier name every automatic shipment is stamped with.</summary>
    public const string Carrier = "Leash Delivery";

    public async Task<FulfilmentReport> RunAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        // Housekeeping first. Correctness already lives in the checkout path,
        // which reclaims holds on the products somebody is buying; this closes
        // out the rest so dead checkouts stop sitting in customers' lists.
        var released = await lifecycle.ReleaseExpiredAsync(null, now, ct: ct);

        var scanned = 0;
        var advanced = new List<(string, string, string)>();
        string? cursor = null;

        do
        {
            var (rows, next) = await orders.ListForFulfilmentAsync(cursor, Batch, ct: ct);
            cursor = next;
            scanned += rows.Count;

            foreach (var order in rows)
            {
                var from = order.Status;
                var at = Array.IndexOf(Delivery.Journey, from);
                if (at < 0) continue;

                var target = Array.IndexOf(
                    Delivery.Journey, Delivery.EarnedStatus(order.PlacedAt, now));
                if (target <= at) continue;

                // Walk every intermediate stage so each writes its event — a
                // customer should still see it was packed before it shipped.
                var reached = from;
                foreach (var status in Delivery.Journey[(at + 1)..(target + 1)])
                {
                    var shipping = status == OrderStatuses.Shipped;
                    var (_, failure) = await lifecycle.MoveAsync(
                        order.Id, status,
                        new OrderMove(
                            Location: $"{order.ShipCity}, {order.ShipState}",
                            Carrier: shipping ? Carrier : null,
                            TrackingNumber: shipping ? Delivery.TrackingNumberFor(order.Id) : null,
                            OccurredAt: now),
                        ct);

                    // A concurrent change won — staff moved it, or it was
                    // cancelled under us. Leave it for the next run to judge.
                    if (failure is not null) break;
                    reached = status;
                }

                if (reached != from) advanced.Add((order.Id, from, reached));
            }
        } while (cursor is not null);

        return new FulfilmentReport(scanned, advanced, released);
    }
}
