using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// Why an adoption action was refused. One list for the whole module so the
/// controller maps each to a status code in exactly one place.
/// </summary>
public enum AdoptionFailure
{
    /// <summary>404 — or not yours to see, which reads the same so ids cannot be probed.</summary>
    NotFound,
    /// <summary>403 — a listing or profile that belongs to somebody else.</summary>
    NotYours,
    /// <summary>403 — shelter actions need a shelter profile.</summary>
    NoShelterProfile,
    /// <summary>400 — the request named an animal or listing that does not exist.</summary>
    PetNotFound,
    ListingNotFound,
    /// <summary>403 — only the animal's owner may list it.</summary>
    PetNotYours,
    /// <summary>409.</summary>
    AlreadyListed,
    /// <summary>409 — the shelter no longer owns the animal.</summary>
    NotShelterOwned,
    /// <summary>409 — an illegal status move.</summary>
    InvalidTransition,
    /// <summary>403 — a legal move, by the wrong party.</summary>
    WrongActor,
    /// <summary>409.</summary>
    ListingUnavailable,
    /// <summary>400 — a shelter applying for its own animal.</summary>
    OwnListing,
    /// <summary>409 — one open application per person per animal.</summary>
    Duplicate,
    /// <summary>409 — one approved application per listing.</summary>
    AlreadyApproved,
    /// <summary>403 — the fee is the applicant's to pay.</summary>
    NotApplicant,
    /// <summary>403 — the handover is the shelter's to record.</summary>
    NotShelter,
    /// <summary>409 — nobody pays before they are approved.</summary>
    NotApproved,
    /// <summary>409 — a waived fee has nothing to pay.</summary>
    NoFee,
    /// <summary>409.</summary>
    AlreadyPaid,
    /// <summary>502 — the payment provider failed.</summary>
    PaymentSetupFailed,
    /// <summary>409.</summary>
    FeeUnpaid,
    /// <summary>409 — a booking or appointment would straddle the transfer (R7).</summary>
    LiveEngagements,
}

/// <summary>
/// A refusal and what the UI needs to explain it: the statuses involved, the
/// rival who is already approved, or the engagements standing in the way.
/// </summary>
public sealed record AdoptionRefusal(AdoptionFailure Kind)
{
    public string? From { get; init; }
    public string? To { get; init; }
    public string? ApplicationId { get; init; }
    public string? PaymentStatus { get; init; }
    public string[]? BookingIds { get; init; }
    public string[]? AppointmentIds { get; init; }

    public static implicit operator AdoptionRefusal(AdoptionFailure kind) => new(kind);
}

/// <summary>Shelter profiles and the shelter directory.</summary>
public interface IShelterService
{
    Task<ShelterSearchPage> SearchAsync(ShelterSearchQuery query, CancellationToken ct = default);

    /// <summary>Public. Null for an unknown id.</summary>
    Task<ShelterWithUserDto?> GetAsync(string shelterId, CancellationToken ct = default);

    /// <summary>Public. Null when the user has no shelter profile.</summary>
    Task<ShelterProfileDto?> GetByUserAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// Create the caller's profile or edit it — one per user. A new profile
    /// starts unverified with a response rate of 100.
    /// </summary>
    Task<(ShelterProfileDto? Profile, AdoptionRefusal? Refusal)> UpsertAsync(
        string callerId, string userId, ShelterPatchRequest patch, CancellationToken ct = default);
}

/// <summary>Adoption listings: the public directory and the shelter's writes.</summary>
public interface IAdoptionListingService
{
    /// <summary>Public. Available animals only, longest-waiting first.</summary>
    Task<AdoptionListingPage> SearchAsync(ListingSearchQuery query, CancellationToken ct = default);

    /// <summary>
    /// Public, in any state but <c>draft</c> — a page that says an animal has
    /// been adopted is worth more than a 404. A draft is shown only to its shelter.
    /// </summary>
    Task<AdoptionListingWithPetDto?> GetAsync(string? callerId, string listingId, CancellationToken ct = default);

    Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> CreateAsync(
        string callerId, CreateListingRequest input, CancellationToken ct = default);

    Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> UpdateAsync(
        string callerId, string listingId, UpdateListingRequest patch, CancellationToken ct = default);

    Task<(AdoptionListingWithPetDto? Listing, AdoptionRefusal? Refusal)> SetStatusAsync(
        string callerId, string listingId, string status, CancellationToken ct = default);
}

/// <summary>Applications to adopt, and the fee.</summary>
public interface IAdoptionApplicationService
{
    Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> CreateAsync(
        string callerId, CreateApplicationRequest input, CancellationToken ct = default);

    /// <summary>Either side may read it; anybody else is told it does not exist.</summary>
    Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> GetAsync(
        string callerId, string applicationId, CancellationToken ct = default);

    Task<AdoptionApplicationPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>The caller's shelter's queue. Refused without a shelter profile.</summary>
    Task<(ShelterQueuePage? Page, AdoptionRefusal? Refusal)> ListForShelterAsync(
        string callerId, string? status, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>
    /// Move an application. The shelter decides; the applicant may only
    /// withdraw. <c>completed</c> is not reachable here — see
    /// <see cref="IAdoptionTransferService.CompleteAsync"/>.
    /// </summary>
    Task<(AdoptionApplicationDto? Application, AdoptionRefusal? Refusal)> UpdateStatusAsync(
        string callerId, string applicationId, string status, string? note, CancellationToken ct = default);

    /// <summary>
    /// Start paying the adoption fee (R5) — the applicant's, once approved.
    /// Through the same ledger as an order: the demo provider settles inline
    /// and a real one by webhook, and both land in the same reconciler.
    /// </summary>
    Task<(AdoptionPaymentDto? Payment, AdoptionRefusal? Refusal)> StartPaymentAsync(
        string callerId, string applicationId, CancellationToken ct = default);
}

/// <summary>The handover itself, and putting an animal back.</summary>
public interface IAdoptionTransferService
{
    /// <summary>
    /// Complete an adoption (R6): the pet and its whole health record move to
    /// the adopter. The shelter's, once the fee has settled. Refused while a
    /// booking or appointment is open for the animal unless
    /// <paramref name="force"/>, which cancels each through its own machine (R7).
    /// </summary>
    Task<(CompletedAdoptionDto? Result, AdoptionRefusal? Refusal)> CompleteAsync(
        string callerId, string applicationId, bool force, CancellationToken ct = default);

    /// <summary>
    /// Put a completed adoption back (R8) — support staff, audited as
    /// <c>adoption.reverse</c>. Does not refund: whether the fee comes back is a
    /// conversation between a shelter and a person.
    /// </summary>
    Task<(ReversedAdoptionDto? Result, AdminRefusal? Refusal)> ReverseAsync(
        StaffActor actor, string applicationId, string reason, CancellationToken ct = default);
}
