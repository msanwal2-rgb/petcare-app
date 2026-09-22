using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Derived reputation: <c>rating</c>, <c>reviewCount</c> and
/// <c>responseRatePct</c>.
///
/// None of the three is something a professional may type in — the patch DTO
/// has no such fields — and <b>this is the only thing that writes them</b>. M5
/// adds the vet arm; the shape below is built to take it without a second
/// module.
/// </summary>
public sealed class ReputationService(
    IBookingRepository bookings,
    ICaretakerRepository caretakers) : IReputationService
{
    /// <summary>
    /// A request counts as answered once the caretaker has acted on it.
    /// Declining counts: replying is the point, and a caretaker who honestly
    /// says no is being responsive.
    /// </summary>
    private static readonly string[] Answered =
    [
        BookingStatuses.Accepted, BookingStatuses.Declined,
        BookingStatuses.InProgress, BookingStatuses.Completed,
    ];

    /// <summary>What is still sitting there.</summary>
    private const string Waiting = BookingStatuses.Requested;

    /// <summary>
    /// Share of requests answered, as a whole percentage.
    ///
    /// <b>Cancellations count as neither.</b> Nothing records who cancelled or
    /// when, so a cancellation could equally mean the caretaker ignored the
    /// request until the owner gave up, or that the owner changed their mind an
    /// hour later. Guessing would quietly punish people for something they may
    /// not have done.
    /// </summary>
    public static int ResponseRateFrom(int answered, int waiting)
    {
        var total = answered + waiting;

        // Nobody has asked yet, so nothing has gone unanswered. Starting a new
        // caretaker at 0% would be a scarlet letter for having just signed up.
        if (total == 0) return 100;

        return (int)Math.Round(answered / (double)total * 100, MidpointRounding.AwayFromZero);
    }

    public async Task RefreshCaretakerResponseRateAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var counts = await bookings.CountRequestsAsync(caretakerId, Answered, Waiting, scope, ct);

        await caretakers.SetReputationAsync(
            caretakerId, rating: null, reviewCount: null,
            responseRatePct: ResponseRateFrom(counts.Answered, counts.Waiting),
            scope, ct);
    }

    /// <summary>
    /// Fold one new rating into a caretaker's headline score.
    ///
    /// A running average rather than a recount over the review rows, because the
    /// seeded <c>reviewCount</c> stands for reputation earned before this
    /// database existed. Recounting would wipe a caretaker's 127 reviews the
    /// moment somebody left the 128th, which reads as a bug rather than as
    /// honesty.
    ///
    /// <b>Stored at full precision on purpose.</b> Rounding here would be
    /// rounding the accumulator: with 127 reviews behind them each new 1-star
    /// moves the mean by about 0.03, which vanishes at one decimal — so the
    /// stored value would round back to itself every time and the rating would
    /// freeze permanently, however many bad reviews arrived. The UI renders it
    /// to one decimal; the column keeps the whole number.
    ///
    /// Reviewing an owner is a no-op, not an error: owners get reviewed too and
    /// have no professional profile to score.
    /// </summary>
    public async Task ApplyCaretakerRatingAsync(
        string userId, double rating,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var profile = await caretakers.GetByUserIdAsync(userId, scope, ct);
        if (profile is null) return;

        var reviewCount = profile.ReviewCount + 1;
        var blended = (profile.Rating * profile.ReviewCount + rating) / reviewCount;

        await caretakers.SetReputationAsync(
            profile.Id, blended, reviewCount, responseRatePct: null, scope, ct);
    }
}
