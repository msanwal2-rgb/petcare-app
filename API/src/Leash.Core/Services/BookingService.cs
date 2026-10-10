using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Bookings. See <see cref="IBookingService"/> for the contract; the two tables
/// below are the whole of the lifecycle.
/// </summary>
public sealed class BookingService(
    IBookingRepository bookings,
    ICaretakerRepository caretakers,
    IAccessService access,
    IReputationService reputation,
    IUnitOfWork unitOfWork) : IBookingService
{
    /// <summary>
    /// What may follow what (REQUIREMENTS.md §11.1).
    ///
    /// <c>completed</c>, <c>declined</c> and <c>cancelled</c> are terminal —
    /// they map to empty, which is what makes "revive a declined booking"
    /// impossible without a special case for it.
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new()
    {
        [BookingStatuses.Requested] =
            [BookingStatuses.Accepted, BookingStatuses.Declined, BookingStatuses.Cancelled],
        [BookingStatuses.Accepted] =
            [BookingStatuses.InProgress, BookingStatuses.Cancelled],
        [BookingStatuses.InProgress] =
            [BookingStatuses.Completed, BookingStatuses.Cancelled],
        [BookingStatuses.Completed] = [],
        [BookingStatuses.Declined] = [],
        [BookingStatuses.Cancelled] = [],
    };

    /// <summary>
    /// Who may drive each transition (REQUIREMENTS.md §11.1, C8).
    ///
    /// Answering a request is the whole of what a caretaker does, so
    /// <c>accepted</c> and <c>declined</c> are theirs. So are
    /// <c>in_progress</c> and <c>completed</c>: they are the one who knows
    /// whether the dog was actually walked. Either side may cancel.
    ///
    /// <c>requested</c> maps to nobody, because it is not a transition — it is
    /// where a booking starts.
    /// </summary>
    private static readonly Dictionary<string, BookingActor[]> ActorAllowed = new()
    {
        [BookingStatuses.Requested] = [],
        [BookingStatuses.Accepted] = [BookingActor.Caretaker],
        [BookingStatuses.Declined] = [BookingActor.Caretaker],
        [BookingStatuses.InProgress] = [BookingActor.Caretaker],
        [BookingStatuses.Completed] = [BookingActor.Caretaker],
        [BookingStatuses.Cancelled] = [BookingActor.Owner, BookingActor.Caretaker],
    };

    public async Task<(BookingDto? Booking, BookingFailure? Failure)> GetAsync(
        string callerId, string bookingId, CancellationToken ct = default)
    {
        // M2's predicate, finally with a caller. It resolves the caretaker
        // profile to its user, which is the step that makes "is this my
        // booking?" answerable at all.
        if (!await access.IsBookingParticipantAsync(callerId, bookingId, ct: ct))
            return (null, BookingFailure.NotParticipant);

        var booking = await bookings.GetByIdAsync(bookingId, ct: ct);
        return booking is null
            ? (null, BookingFailure.NotFound)
            : (booking.ToDto(), null);
    }

    public async Task<BookingPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default)
    {
        var (rows, next) = await bookings.ListByOwnerAsync(callerId, cursor, limit, ct: ct);
        return new BookingPage([.. rows.Select(b => b.ToDto())], next);
    }

    public async Task<BookingPage?> ListForCaretakerAsync(
        string callerId, string caretakerId, string? cursor, int limit,
        CancellationToken ct = default)
    {
        // A caretaker's queue is theirs. Without this an owner could read every
        // booking any caretaker holds, which is the whole marketplace's
        // schedule.
        if (!await access.OwnsCaretakerProfileAsync(callerId, caretakerId, ct: ct))
            return null;

        var (rows, next) = await bookings.ListByCaretakerAsync(
            caretakerId, cursor, limit, ct: ct);

        return new BookingPage([.. rows.Select(b => b.ToDto())], next);
    }

    /// <summary>
    /// Request a booking.
    ///
    /// The price is computed here, from the caretaker's own rate card, and the
    /// request body has no price field to ignore (REQUIREMENTS.md C5). The
    /// running total the booking form shows is an estimate for the customer; if
    /// the two disagree, the rate card is right.
    ///
    /// Every pet on the request is checked against the caller. A booking is how
    /// a caretaker gets to read a pet — <c>CanViewPet</c> grants on exactly this
    /// row — so an unchecked <c>petIds</c> would let anyone hand any animal's
    /// file to any caretaker by naming it in a booking.
    /// </summary>
    public async Task<(BookingDto? Booking, BookingFailure? Failure)> CreateAsync(
        string callerId, CreateBookingRequest input, CancellationToken ct = default)
    {
        if (input.EndDateTime <= input.StartDateTime)
            return (null, BookingFailure.BadDates);

        // REQUIREMENTS.md C13, and see LeadTime for why the member arm is
        // hard-coded false until M7 brings entitlements.
        if (!LeadTime.IsMet(input.StartDateTime, Ids.Now(), member: false))
            return (null, BookingFailure.LeadTime);

        await using var scope = await unitOfWork.BeginAsync(ct);

        foreach (var petId in input.PetIds)
        {
            if (!await access.OwnsPetAsync(callerId, petId, scope, ct))
                return (null, BookingFailure.NotYourPet);
        }

        var caretaker = await caretakers.GetByIdAsync(input.CaretakerId, scope, ct);
        if (caretaker is null) return (null, BookingFailure.CaretakerNotFound);

        var rate = await caretakers.GetPricingForServiceAsync(
            input.CaretakerId, input.ServiceType, scope, ct);

        // Both halves matter: a rate card line without the service listed is a
        // leftover, and a listed service without a rate has no honest price.
        if (rate is null || !caretaker.ServicesOffered.Contains(input.ServiceType))
            return (null, BookingFailure.ServiceNotOffered);

        var booking = new BookingEntity
        {
            Id = Ids.New("b"),
            OwnerId = callerId,
            CaretakerId = input.CaretakerId,
            PetIds = input.PetIds,
            ServiceType = input.ServiceType,
            StartDateTime = input.StartDateTime,
            EndDateTime = input.EndDateTime,
            Notes = input.Notes ?? "",
            Status = BookingStatuses.Requested,
            CreatedAt = Ids.Now(),
            PriceTotalCents = PriceBooking(
                rate.RateCents, rate.Unit, input.StartDateTime, input.EndDateTime),
        };

        var created = await bookings.CreateAsync(booking, scope, ct);

        // A new request is one more thing left unanswered until they reply.
        await reputation.RefreshCaretakerResponseRateAsync(created.CaretakerId, scope, ct);

        await scope.CommitAsync(ct);
        return (created.ToDto(), null);
    }

    /// <summary>
    /// Move a booking.
    ///
    /// Legality first, then authority — and the order is deliberate. An illegal
    /// move reports as illegal even when the caller would have been entitled to
    /// a legal one, because "you cannot revive a cancelled booking" is more
    /// useful than "you are not allowed to accept", and because the alternative
    /// leaks the current status to someone probing with the wrong verb.
    ///
    /// A no-op (same status in, same status out) is allowed and changes nothing
    /// — a double-tapped Accept button is not an error.
    /// </summary>
    public async Task<(BookingDto? Booking, BookingFailure? Failure)> UpdateStatusAsync(
        string callerId, string bookingId, string status, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var booking = await bookings.GetByIdAsync(bookingId, scope, ct);
        if (booking is null) return (null, BookingFailure.NotFound);

        var actor = await ActorFor(callerId, booking, scope, ct);
        if (actor is null) return (null, BookingFailure.NotParticipant);

        var from = booking.Status;
        if (from == status) return (booking.ToDto(), null);

        if (!Transitions.TryGetValue(from, out var allowed) || !allowed.Contains(status))
            return (null, BookingFailure.InvalidTransition);

        if (!ActorAllowed[status].Contains(actor.Value))
            return (null, BookingFailure.WrongActor);

        var updated = await bookings.UpdateStatusAsync(bookingId, status, scope, ct);
        if (updated is null) return (null, BookingFailure.NotFound);

        await reputation.RefreshCaretakerResponseRateAsync(updated.CaretakerId, scope, ct);

        await scope.CommitAsync(ct);
        return (updated.ToDto(), null);
    }

    /// <summary>
    /// Which side of this booking the caller is on, or null if neither.
    ///
    /// The caretaker side is a profile id, so it resolves through the profile to
    /// its user — comparing <c>callerId</c> to <c>booking.CaretakerId</c>
    /// directly would answer "no" to every caretaker who ever lived.
    /// </summary>
    private async Task<BookingActor?> ActorFor(
        string callerId, BookingEntity booking, ITransactionScope scope, CancellationToken ct)
    {
        if (booking.OwnerId == callerId) return BookingActor.Owner;

        return await access.OwnsCaretakerProfileAsync(callerId, booking.CaretakerId, scope, ct)
            ? BookingActor.Caretaker
            : null;
    }

    /// <summary>
    /// What a booking costs, in integer cents, from the rate card and the
    /// duration.
    ///
    /// Hours round to the nearest, days round <b>up</b> — a stay that runs into
    /// a fourth day occupies a fourth day, whatever the clock says. Both floor
    /// at one unit, so a fifteen-minute walk is charged as the hour it takes up
    /// on a caretaker's calendar rather than as a quarter of one.
    ///
    /// All integer arithmetic. The reference multiplied a float rate by a count
    /// and rounded afterwards, which is how <c>$210.00000000000003</c> reaches a
    /// receipt; there is nothing to round here because cents times a whole
    /// number is cents.
    /// </summary>
    public static int PriceBooking(
        int rateCents, string unit, DateTimeOffset start, DateTimeOffset end)
    {
        var span = end - start;

        var units = unit == PricingUnits.Day
            ? Math.Max(1, (int)Math.Ceiling(span.TotalDays))
            : Math.Max(1, (int)Math.Round(span.TotalHours, MidpointRounding.AwayFromZero));

        return rateCents * units;
    }
}
