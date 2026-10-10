using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Derived reputation: <c>rating</c>, <c>reviewCount</c> and
/// <c>responseRatePct</c>.
///
/// None of the three is something a professional may type in — neither patch
/// DTO has such a field — and <b>this is the only thing that writes them</b>.
///
/// ── Two arms, one set of rules ──
///
/// M4 built the caretaker arm and M5 added the vet one. They share
/// <see cref="ResponseRateFrom"/> and the shape of everything else; exactly two
/// things differ, and both are data rather than logic:
///
///  1. the answered-status list — an appointment says <c>confirmed</c> where a
///     booking says <c>accepted</c> (REQUIREMENTS.md §11.2 against §11.1);
///  2. which repository holds the counts and which holds the columns.
///
/// M10's shelter arm needs <c>responseRatePct</c> only. Shelters have no rating
/// and no review count deliberately, until <c>Review.kind</c> grows an adoption
/// arm.
/// </summary>
public sealed class ReputationService(
    IBookingRepository bookings,
    ICaretakerRepository caretakers,
    IAppointmentRepository appointments,
    IVetRepository vets) : IReputationService
{
    /// <summary>
    /// A request counts as answered once the caretaker has acted on it.
    /// Declining counts: replying is the point, and a caretaker who honestly
    /// says no is being responsive.
    /// </summary>
    private static readonly string[] BookingsAnswered =
    [
        BookingStatuses.Accepted, BookingStatuses.Declined,
        BookingStatuses.InProgress, BookingStatuses.Completed,
    ];

    /// <summary>
    /// The same rule for a clinic, spelled with §11.2's vocabulary.
    ///
    /// Written out rather than derived from <see cref="BookingsAnswered"/> by
    /// substituting one string: the two lists are equal today by coincidence of
    /// design, not by definition, and a table that changes one machine must not
    /// silently change the other.
    /// </summary>
    private static readonly string[] AppointmentsAnswered =
    [
        AppointmentStatuses.Confirmed, AppointmentStatuses.Declined,
        AppointmentStatuses.InProgress, AppointmentStatuses.Completed,
    ];

    /// <summary>
    /// Share of requests answered, as a whole percentage.
    ///
    /// <b>Cancellations count as neither.</b> Nothing records who cancelled or
    /// when, so a cancellation could equally mean the professional ignored the
    /// request until the customer gave up, or that the customer changed their
    /// mind an hour later. Guessing would quietly punish people for something
    /// they may not have done.
    /// </summary>
    public static int ResponseRateFrom(int answered, int waiting)
    {
        var total = answered + waiting;

        // Nobody has asked yet, so nothing has gone unanswered. Starting a new
        // professional at 0% would be a scarlet letter for having just signed up.
        if (total == 0) return 100;

        return (int)Math.Round(answered / (double)total * 100, MidpointRounding.AwayFromZero);
    }

    public async Task RefreshCaretakerResponseRateAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var counts = await bookings.CountRequestsAsync(
            caretakerId, BookingsAnswered, BookingStatuses.Requested, scope, ct);

        await caretakers.SetReputationAsync(
            caretakerId, rating: null, reviewCount: null,
            responseRatePct: ResponseRateFrom(counts.Answered, counts.Waiting),
            scope, ct);
    }

    /// <summary>
    /// The vet arm of the above. Called whenever an appointment arrives or
    /// moves, which are the only two events that can change the number.
    /// </summary>
    public async Task RefreshVetResponseRateAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var counts = await appointments.CountRequestsAsync(
            vetId, AppointmentsAnswered, AppointmentStatuses.Requested, scope, ct);

        await vets.SetReputationAsync(
            vetId, rating: null, reviewCount: null,
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

        var (blended, reviewCount) = Blend(profile.Rating, profile.ReviewCount, rating);

        await caretakers.SetReputationAsync(
            profile.Id, blended, reviewCount, responseRatePct: null, scope, ct);
    }

    /// <summary>
    /// The same, for the clinician an owner just reviewed.
    ///
    /// A no-op for a user with no vet profile — which is every owner, and is how
    /// this stays safe to call with whatever <c>toUserId</c> a review names.
    /// </summary>
    public async Task ApplyVetRatingAsync(
        string userId, double rating,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var profile = await vets.GetByUserIdAsync(userId, scope, ct);
        if (profile is null) return;

        var (blended, reviewCount) = Blend(profile.Rating, profile.ReviewCount, rating);

        await vets.SetReputationAsync(
            profile.Id, blended, reviewCount, responseRatePct: null, scope, ct);
    }

    /// <summary>The running average, written once so the two arms cannot drift.</summary>
    private static (double Rating, int ReviewCount) Blend(
        double currentRating, int currentCount, double newRating)
    {
        var reviewCount = currentCount + 1;
        return ((currentRating * currentCount + newRating) / reviewCount, reviewCount);
    }
}
