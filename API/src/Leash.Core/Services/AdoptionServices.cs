using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Core.Services;

/// <summary>
/// Adoption listings. See <see cref="IAdoptionListingService"/>.
///
/// A listing is a claim about an animal, and a shelter may only make it about
/// one that is actually theirs — checked when it is created and again every
/// time it is published, so a row cannot be edited back into circulation after
/// the animal has gone home.
/// </summary>
public sealed class AdoptionListingService(
    IAdoptionRepository adoptions,
    IShelterRepository shelters,
    IPetRepository pets,
    IAccessService access,
    IUnitOfWork unitOfWork) : IAdoptionListingService
{
    /// <summary>
    /// What may follow what (R3). <c>adopted → available</c> is the relist path:
    /// animals do come back. A same-status write is a no-op, not an error.
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new()
    {
        [ListingStatuses.Draft] = [ListingStatuses.Available, ListingStatuses.Withdrawn],
        [ListingStatuses.Available] = [ListingStatuses.Pending, ListingStatuses.Withdrawn],
        [ListingStatuses.Pending] =
            [ListingStatuses.Available, ListingStatuses.Adopted, ListingStatuses.Withdrawn],
        [ListingStatuses.Adopted] = [ListingStatuses.Available],
        [ListingStatuses.Withdrawn] = [ListingStatuses.Available],
    };

    public async Task<AdoptionListingPage> SearchAsync(ListingSearchQuery query, CancellationToken ct = default)
    {
        var (rows, next, total) = await adoptions.SearchListingsAsync(query, ct: ct);
        return new AdoptionListingPage([.. rows.Select(r => r.ToDto())], next, total);
    }

    public async Task<AdoptionListingWithPetDto?> GetAsync(
        string? callerId, string listingId, CancellationToken ct = default)
    {
        var row = await adoptions.GetListingRowAsync(listingId, ct: ct);
        if (row is null) return null;

        if (row.Listing.Status == ListingStatuses.Draft
            && (callerId is null || !await access.OwnsShelterProfileAsync(callerId, row.Listing.ShelterId, ct: ct)))
            return null;

        return row.ToDto();
    }

    public async Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> CreateAsync(
        string callerId, CreateListingRequest input, CancellationToken ct = default)
    {
        var shelter = await shelters.GetByUserIdAsync(callerId, ct: ct);
        if (shelter is null) return (null, AdoptionFailure.NoShelterProfile);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var pet = await pets.GetByIdAsync(input.PetId, scope, ct);
        if (pet is null) return (null, AdoptionFailure.PetNotFound);
        if (pet.OwnerId != shelter.UserId) return (null, AdoptionFailure.PetNotYours);

        if (await adoptions.PetIsListedAsync(pet.Id, scope, ct)) return (null, AdoptionFailure.AlreadyListed);

        var now = Ids.Now();
        var listing = new AdoptionListingEntity
        {
            Id = Ids.New("al"),
            ShelterId = shelter.Id,
            PetId = pet.Id,
            // Drafted, not published: publishing is its own step, and re-checks
            // ownership when it happens.
            Status = ListingStatuses.Draft,
            FeeCents = input.FeeCents ?? 0,
            Currency = "usd",
            Headline = input.Headline ?? "",
            Story = input.Story ?? "",
            GoodWithKids = input.GoodWithKids ?? TriStates.Unknown,
            GoodWithDogs = input.GoodWithDogs ?? TriStates.Unknown,
            GoodWithCats = input.GoodWithCats ?? TriStates.Unknown,
            HouseTrained = input.HouseTrained ?? TriStates.Unknown,
            EnergyLevel = input.EnergyLevel ?? EnergyLevels.Moderate,
            SpecialNeeds = input.SpecialNeeds ?? false,
            SpecialNeedsNotes = input.SpecialNeedsNotes ?? "",
            SpayedNeutered = input.SpayedNeutered ?? false,
            Microchipped = input.Microchipped ?? false,
            // The shelter's own address unless the animal is somewhere else —
            // a fostered dog is in somebody's house.
            City = input.City ?? shelter.City,
            State = input.State ?? shelter.State,
            Lat = input.Lat ?? shelter.Lat,
            Lng = input.Lng ?? shelter.Lng,
            IntakeAt = input.IntakeAt ?? now,
            CreatedAt = now,
            UpdatedAt = now,
        };

        try
        {
            await adoptions.CreateListingAsync(listing, scope, ct);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // Two creates for one animal at once: the unique index on petId is
            // the arbiter, and the loser hears what it would have heard later.
            return (null, AdoptionFailure.AlreadyListed);
        }

        var row = await adoptions.GetListingRowAsync(listing.Id, scope, ct);
        await scope.CommitAsync(ct);
        return (row!.ToDto(), null);
    }

    public async Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> UpdateAsync(
        string callerId, string listingId, UpdateListingRequest p, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var listing = await adoptions.GetListingAsync(listingId, scope, forUpdate: true, ct: ct);
        if (listing is null) return (null, AdoptionFailure.NotFound);
        if (!await OwnsAsync(callerId, listing, scope, ct)) return (null, AdoptionFailure.NotYours);

        await adoptions.UpdateListingAsync(listingId, new ListingPatch(
            p.FeeCents, p.Headline, p.Story, p.GoodWithKids, p.GoodWithDogs, p.GoodWithCats,
            p.HouseTrained, p.EnergyLevel, p.SpecialNeeds, p.SpecialNeedsNotes, p.SpayedNeutered,
            p.Microchipped, p.City, p.State, p.Lat, p.Lng, p.IntakeAt), Ids.Now(), scope, ct);

        var row = await adoptions.GetListingRowAsync(listingId, scope, ct);
        await scope.CommitAsync(ct);
        return (row!.ToDto(), null);
    }

    public async Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> SetStatusAsync(
        string callerId, string listingId, string status, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var listing = await adoptions.GetListingAsync(listingId, scope, forUpdate: true, ct: ct);
        if (listing is null) return (null, AdoptionFailure.NotFound);

        var shelter = await shelters.GetByIdAsync(listing.ShelterId, scope, ct);
        if (shelter is null || shelter.UserId != callerId) return (null, AdoptionFailure.NotYours);

        var from = listing.Status;
        if (from != status)
        {
            if (!Transitions.TryGetValue(from, out var allowed) || !allowed.Contains(status))
                return (null, new AdoptionRefusal(AdoptionFailure.InvalidTransition) { From = from, To = status });

            // Publishing asserts the claim again: an animal already adopted out
            // cannot be offered a second time by editing a row.
            if (status == ListingStatuses.Available)
            {
                var pet = await pets.GetByIdAsync(listing.PetId, scope, ct);
                if (pet?.OwnerId != shelter.UserId) return (null, AdoptionFailure.NotShelterOwned);
            }

            await adoptions.SetListingStatusAsync(listingId, from, status, Ids.Now(), scope, ct);
        }

        var row = await adoptions.GetListingRowAsync(listingId, scope, ct);
        await scope.CommitAsync(ct);
        return (row!.ToDto(), null);
    }

    /// <summary>M2's predicate, with its guard against a missing profile matching a missing caller.</summary>
    private Task<bool> OwnsAsync(
        string callerId, AdoptionListingEntity listing, ITransactionScope scope, CancellationToken ct)
        => access.OwnsShelterProfileAsync(callerId, listing.ShelterId, scope, ct);
}

/// <summary>
/// Applications to adopt, and the fee. See <see cref="IAdoptionApplicationService"/>.
///
/// Like every machine here, two questions are asked separately and both are
/// enforced: <see cref="Transitions"/> says what is reachable,
/// <see cref="ActorAllowed"/> says who may do it. Legality first, then
/// authority, as in <see cref="BookingService"/>.
/// </summary>
public sealed class AdoptionApplicationService(
    IAdoptionRepository adoptions,
    IShelterRepository shelters,
    IPetRepository pets,
    IPaymentRepository payments,
    ISubscriptionRepository customers,
    IPaymentProvider provider,
    IPaymentLedger ledger,
    IReputationService reputation,
    INotifier notifier,
    IAccessService access,
    IUnitOfWork unitOfWork) : IAdoptionApplicationService
{
    private enum Actor { Applicant, Shelter }

    /// <summary>
    /// What may follow what (R4). <c>completed</c> is reached through the
    /// transfer command, never a status write: it moves an animal and takes
    /// money, and a PATCH would hide that.
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new()
    {
        [ApplicationStatuses.Submitted] =
            [ApplicationStatuses.UnderReview, ApplicationStatuses.Rejected, ApplicationStatuses.Withdrawn],
        [ApplicationStatuses.UnderReview] =
            [ApplicationStatuses.Approved, ApplicationStatuses.Rejected, ApplicationStatuses.Withdrawn],
        [ApplicationStatuses.Approved] =
            [ApplicationStatuses.Rejected, ApplicationStatuses.Withdrawn],
        [ApplicationStatuses.Completed] = [],
        [ApplicationStatuses.Rejected] = [],
        [ApplicationStatuses.Withdrawn] = [],
    };

    /// <summary>The shelter decides; the applicant may only walk away.</summary>
    private static readonly Dictionary<string, Actor[]> ActorAllowed = new()
    {
        [ApplicationStatuses.UnderReview] = [Actor.Shelter],
        [ApplicationStatuses.Approved] = [Actor.Shelter],
        [ApplicationStatuses.Rejected] = [Actor.Shelter],
        [ApplicationStatuses.Withdrawn] = [Actor.Applicant],
    };

    /// <summary>
    /// Apply. The listing row is locked for the length of the check, so two
    /// submissions from one person cannot both find no open application.
    /// </summary>
    public async Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> CreateAsync(
        string callerId, CreateApplicationRequest input, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var listing = await adoptions.GetListingAsync(input.ListingId, scope, forUpdate: true, ct: ct);
        if (listing is null || listing.Status == ListingStatuses.Draft)
            return (null, AdoptionFailure.ListingNotFound);

        if (listing.Status != ListingStatuses.Available)
            return (null, new AdoptionRefusal(AdoptionFailure.ListingUnavailable) { From = listing.Status });

        var shelter = await shelters.GetByIdAsync(listing.ShelterId, scope, ct);
        if (shelter is null) return (null, AdoptionFailure.ListingNotFound);

        // A data-entry accident, not a use case.
        if (shelter.UserId == callerId) return (null, AdoptionFailure.OwnListing);

        // One live application per person per animal. Re-applying after a
        // rejection is allowed — circumstances change.
        if (await adoptions.HasOpenApplicationAsync(listing.Id, callerId, scope, ct))
            return (null, AdoptionFailure.Duplicate);

        var pet = await pets.GetByIdAsync(listing.PetId, scope, ct);
        if (pet is null) return (null, AdoptionFailure.ListingNotFound);

        var now = Ids.Now();
        var application = new AdoptionApplicationEntity
        {
            Id = Ids.New("aa"),
            ListingId = listing.Id,
            ShelterId = listing.ShelterId,
            PetId = listing.PetId,
            // Snapshots, so this row still reads as an adoption of a named
            // animal at a quoted fee long after the listing changes.
            PetName = pet.Name,
            PetPhotoUrl = pet.PhotoUrl,
            FeeCents = listing.FeeCents,
            ApplicantId = callerId,
            Status = ApplicationStatuses.Submitted,
            HouseholdAdults = input.HouseholdAdults,
            HouseholdChildren = input.HouseholdChildren,
            HasOtherPets = input.HasOtherPets,
            OtherPetsNotes = input.OtherPetsNotes ?? "",
            HomeType = input.HomeType,
            FencedYard = input.FencedYard,
            OwnsHome = input.OwnsHome,
            HoursAlonePerDay = input.HoursAlonePerDay,
            Experience = input.Experience ?? "",
            Message = input.Message ?? "",
            DecisionNote = "",
            CreatedAt = now,
            UpdatedAt = now,
        };

        await adoptions.CreateApplicationAsync(application, scope, ct);

        // One more thing the shelter has not answered yet.
        await reputation.RefreshShelterResponseRateAsync(shelter.Id, scope, ct);
        await notifier.NotifyAsync(shelter.UserId, Notices.ApplicationReceived(pet.Name), scope, ct);

        await scope.CommitAsync(ct);
        return (application.ToDto(), null);
    }

    public async Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> GetAsync(
        string callerId, string applicationId, CancellationToken ct = default)
    {
        var application = await adoptions.GetApplicationAsync(applicationId, ct: ct);
        if (application is null || await ActorForAsync(callerId, application, null, ct) is null)
            return (null, AdoptionFailure.NotFound);

        return (application.ToDto(), null);
    }

    public async Task<AdoptionApplicationPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default)
    {
        var (rows, next) = await adoptions.ListByApplicantAsync(callerId, cursor, limit, ct);
        return new AdoptionApplicationPage([.. rows.Select(r => r.ToDto())], next);
    }

    public async Task<(ShelterQueuePage? Page, AdoptionRefusal? Refusal)> ListForShelterAsync(
        string callerId, string? status, string? cursor, int limit, CancellationToken ct = default)
    {
        var shelter = await shelters.GetByUserIdAsync(callerId, ct: ct);
        if (shelter is null) return (null, AdoptionFailure.NoShelterProfile);

        var (rows, next) = await adoptions.ListQueueAsync(shelter.Id, status, cursor, limit, ct);
        return (new ShelterQueuePage([.. rows.Select(r => r.ToDto())], next), null);
    }

    public async Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> UpdateStatusAsync(
        string callerId, string applicationId, string status, string? note, CancellationToken ct = default)
    {
        AdoptionApplicationEntity updated;
        bool refund;

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            var application = await adoptions.GetApplicationAsync(applicationId, scope, forUpdate: true, ct: ct);
            if (application is null) return (null, AdoptionFailure.NotFound);

            // Which party is asking comes from the session, never the body. A
            // stranger is told it does not exist.
            var actor = await ActorForAsync(callerId, application, scope, ct);
            if (actor is null) return (null, AdoptionFailure.NotFound);

            var from = application.Status;
            if (from == status) return (application.ToDto(), null);

            if (!Transitions.TryGetValue(from, out var allowed) || !allowed.Contains(status))
                return (null, new AdoptionRefusal(AdoptionFailure.InvalidTransition) { From = from, To = status });

            if (!ActorAllowed.TryGetValue(status, out var who) || !who.Contains(actor.Value))
                return (null, new AdoptionRefusal(AdoptionFailure.WrongActor) { To = status });

            var now = Ids.Now();

            if (status == ApplicationStatuses.Approved)
            {
                // At most one approved application per listing: two people
                // asked for money for one animal means somebody gets refunded
                // for an animal they were told they could have.
                if (await adoptions.FindApprovedRivalAsync(application.ListingId, application.Id, scope, ct) is { } rival)
                    return (null, new AdoptionRefusal(AdoptionFailure.AlreadyApproved) { ApplicationId = rival });

                // Approving takes the animal off the market without adopting it
                // out, so nobody else applies while this one is settled.
                var listing = await adoptions.GetListingAsync(application.ListingId, scope, forUpdate: true, ct: ct);
                if (listing is null
                    || !await adoptions.SetListingStatusAsync(
                        listing.Id, ListingStatuses.Available, ListingStatuses.Pending, now, scope, ct))
                {
                    return (null, new AdoptionRefusal(AdoptionFailure.ListingUnavailable) { From = listing?.Status });
                }
            }

            updated = (await adoptions.SetApplicationStatusAsync(applicationId, from, status, note, now, scope, ct))!;

            // Letting go of an approved applicant puts the animal back, and
            // gives back anything they paid.
            refund = from == ApplicationStatuses.Approved
                     && status is ApplicationStatuses.Rejected or ApplicationStatuses.Withdrawn;
            if (refund)
            {
                await adoptions.SetListingStatusAsync(
                    application.ListingId, ListingStatuses.Pending, ListingStatuses.Available, now, scope, ct);
            }

            await reputation.RefreshShelterResponseRateAsync(application.ShelterId, scope, ct);

            if (Notices.ForApplication(application.Id, status, application.PetName) is { } notice)
                await notifier.NotifyAsync(application.ApplicantId, notice, scope, ct);

            await scope.CommitAsync(ct);

            if (refund)
            {
                // After the commit: the ledger runs its own transaction and
                // calls the provider, which must never happen inside ours.
                await RefundFeeAsync(application.Id, actor == Actor.Shelter ? "shelter" : "system",
                    status == ApplicationStatuses.Withdrawn
                        ? "Applicant withdrew after approval"
                        : "Application rejected after approval",
                    ct);
            }
        }

        return (updated.ToDto(), null);
    }

    public async Task<(AdoptionPaymentDto? Payment, AdoptionRefusal? Refusal)> StartPaymentAsync(
        string callerId, string applicationId, CancellationToken ct = default)
    {
        var application = await adoptions.GetApplicationAsync(applicationId, ct: ct);
        if (application is null) return (null, AdoptionFailure.NotFound);

        // Money moves when the payer acts. Completing is the shelter's.
        if (application.ApplicantId != callerId) return (null, AdoptionFailure.NotApplicant);

        // Nobody pays before they are approved — which is what makes a rival's
        // refund impossible: only one person is ever asked for money.
        if (application.Status != ApplicationStatuses.Approved)
            return (null, new AdoptionRefusal(AdoptionFailure.NotApproved) { From = application.Status });

        // A waived fee has no payment row. A zero-value intent would be refused
        // by the provider anyway.
        if (application.FeeCents <= 0) return (null, AdoptionFailure.NoFee);

        if (await payments.GetForAdoptionAsync(applicationId, ct: ct) is { } existing)
            return Existing(existing);

        var customerRef = provider.Asynchronous ? await customers.GetCustomerIdAsync(callerId, ct: ct) : null;

        PaymentIntent intent;
        try
        {
            // The application id is the idempotency key and what the webhook
            // resolves back to: an adoption has no order.
            intent = await provider.CreateIntentAsync(new IntentRequest(
                application.FeeCents, "usd", applicationId, callerId, IdempotencyKey: applicationId, customerRef), ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return (null, AdoptionFailure.PaymentSetupFailed);
        }

        var now = Ids.Now();
        try
        {
            await payments.CreateAsync(new PaymentEntity
            {
                Id = Ids.New("pay"),
                UserId = callerId,
                Kind = PaymentKinds.AdoptionFee,
                AdoptionApplicationId = applicationId,
                Provider = provider.Name,
                ProviderRef = intent.Ref,
                ProviderCustomerId = customerRef ?? "",
                Status = PaymentStatuses.Unpaid,
                AmountCents = application.FeeCents,
                AmountRefundedCents = 0,
                Currency = intent.Currency,
                CreatedAt = now,
                UpdatedAt = now,
            }, ct: ct);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // A double-click: the other request's row won. Hand that one back
            // rather than a second charge for one animal.
            return Existing((await payments.GetForAdoptionAsync(applicationId, ct: ct))!);
        }

        // A synchronous provider has already settled; the reconciler the
        // webhook uses folds it in (M3), so there is one path, not two. No new
        // branch in the ledger or the webhook: both key on providerRef.
        if (!provider.Asynchronous) await ledger.ApplyIntentStateAsync(intent, ct: ct);

        var fresh = await payments.GetForAdoptionAsync(applicationId, ct: ct);
        return (new AdoptionPaymentDto(
            new PaymentHandoffDto(intent.Ref, intent.ClientSecret, provider.Name),
            fresh?.Status ?? PaymentStatuses.Unpaid), null);
    }

    /// <summary>
    /// An intent that exists is reused: paid is refused, anything else is
    /// handed back to retry. The client secret went out once and is not sent
    /// again (M5).
    /// </summary>
    private static (AdoptionPaymentDto?, AdoptionRefusal?) Existing(PaymentEntity payment)
        => payment.Status == PaymentStatuses.Paid
            ? (null, AdoptionFailure.AlreadyPaid)
            : (new AdoptionPaymentDto(
                new PaymentHandoffDto(payment.ProviderRef, null, payment.Provider), payment.Status), null);

    /// <summary>
    /// Send a settled fee back. Deliberately never called on a reversal — see
    /// <see cref="IAdoptionTransferService.ReverseAsync"/>.
    /// </summary>
    private async Task RefundFeeAsync(string applicationId, string initiatedBy, string note, CancellationToken ct)
    {
        var payment = await payments.GetForAdoptionAsync(applicationId, ct: ct);
        if (payment is null || payment.Status != PaymentStatuses.Paid) return;

        await ledger.RequestRefundAsync(new RefundRequest(
            PaymentId: payment.Id, Reason: RefundReasons.RequestedByCustomer,
            InitiatedBy: initiatedBy, Note: note), ct);
    }

    private async Task<Actor?> ActorForAsync(
        string callerId, AdoptionApplicationEntity application, ITransactionScope? scope, CancellationToken ct)
    {
        if (application.ApplicantId == callerId) return Actor.Applicant;
        return await access.OwnsShelterProfileAsync(callerId, application.ShelterId, scope, ct) ? Actor.Shelter : null;
    }
}
