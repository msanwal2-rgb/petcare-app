using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// A partial edit to a shelter profile, flattened to the columns. Null leaves a
/// column alone. No <c>verificationStatus</c>, no <c>responseRatePct</c>.
/// </summary>
public sealed record ShelterPatch(
    string? Name, string? Bio, string? Kind, string? RegistrationNumber,
    string? RegistrationState, string[]? AcceptedSpecies, string? WebsiteUrl,
    string? Phone, string? Email, string? AddressLine, string? City, string? State,
    double? Lat, double? Lng, string? AdoptionPolicy);

/// <summary>Dapper over <c>shelter_profiles</c>.</summary>
public interface IShelterRepository
{
    Task<(IReadOnlyList<ShelterRow> Rows, string? NextCursor)> SearchAsync(
        ShelterSearchQuery query, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The shelter with its account and its available count, or null.</summary>
    Task<ShelterRow?> GetRowAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<ShelterProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<ShelterProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<ShelterProfileEntity> CreateAsync(
        ShelterProfileEntity profile, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<ShelterProfileEntity?> UpdateAsync(
        string id, ShelterPatch patch, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// How many applications this shelter has answered, and how many are still
    /// waiting — the inputs to <c>responseRatePct</c>.
    /// </summary>
    Task<(int Answered, int Waiting)> CountApplicationsAsync(
        string shelterId, string[] answered, string waiting,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task SetResponseRateAsync(
        string shelterId, int responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>A partial edit to a listing, already validated. Null leaves a column alone.</summary>
public sealed record ListingPatch(
    int? FeeCents, string? Headline, string? Story, string? GoodWithKids,
    string? GoodWithDogs, string? GoodWithCats, string? HouseTrained, string? EnergyLevel,
    bool? SpecialNeeds, string? SpecialNeedsNotes, bool? SpayedNeutered, bool? Microchipped,
    string? City, string? State, double? Lat, double? Lng, DateTimeOffset? IntakeAt);

/// <summary>Dapper over <c>adoption_listings</c>, <c>adoption_applications</c> and the transfer itself.</summary>
public interface IAdoptionRepository
{
    // ── Listings ─────────────────────────────────────────────────────────

    Task<(IReadOnlyList<ListingRow> Rows, string? NextCursor, int Total)> SearchListingsAsync(
        ListingSearchQuery query, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The listing with its animal and its shelter's name, or null.</summary>
    Task<ListingRow?> GetListingRowAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <param name="forUpdate">Lock the row until the scope ends.</param>
    Task<AdoptionListingEntity?> GetListingAsync(
        string id, ITransactionScope? scope = null, bool forUpdate = false, CancellationToken ct = default);

    Task<bool> PetIsListedAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task CreateListingAsync(
        AdoptionListingEntity listing, ITransactionScope? scope = null, CancellationToken ct = default);

    Task UpdateListingAsync(
        string id, ListingPatch patch, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move a listing, conditional on it still being <paramref name="from"/>.
    /// Sets <c>publishedAt</c> on a first publish, <c>closedAt</c> on adopting
    /// or withdrawing, and clears it on relisting. False when the row had moved.
    /// </summary>
    Task<bool> SetListingStatusAsync(
        string id, string from, string to, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default);

    // ── Applications ─────────────────────────────────────────────────────

    Task CreateApplicationAsync(
        AdoptionApplicationEntity application, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<AdoptionApplicationEntity?> GetApplicationAsync(
        string id, ITransactionScope? scope = null, bool forUpdate = false, CancellationToken ct = default);

    /// <summary>Does this person already have an open application for this listing?</summary>
    Task<bool> HasOpenApplicationAsync(
        string listingId, string applicantId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Another application already approved for this listing, if any.</summary>
    Task<string?> FindApprovedRivalAsync(
        string listingId, string exceptId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move an application, conditional on it still being <paramref name="from"/>.
    /// A null <paramref name="note"/> leaves the decision note alone. Null when
    /// the row had moved.
    /// </summary>
    Task<AdoptionApplicationEntity?> SetApplicationStatusAsync(
        string id, string from, string to, string? note, DateTimeOffset now,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The caller's own applications, newest first.</summary>
    Task<(IReadOnlyList<AdoptionApplicationEntity> Rows, string? NextCursor)> ListByApplicantAsync(
        string applicantId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>A shelter's queue, oldest first, with who is asking and whether they have paid.</summary>
    Task<(IReadOnlyList<QueueRow> Rows, string? NextCursor)> ListQueueAsync(
        string shelterId, string? status, string? cursor, int limit, CancellationToken ct = default);

    // ── The transfer ─────────────────────────────────────────────────────

    /// <summary>
    /// <b>The whole feature in one statement</b> (R6): move the animal and reset
    /// <c>ownedSince</c> together, conditional on <paramref name="fromOwnerId"/>
    /// still owning it. True for exactly one of any number of concurrent callers.
    /// </summary>
    Task<bool> TransferPetAsync(
        string petId, string fromOwnerId, string toOwnerId, DateTimeOffset now,
        ITransactionScope scope, CancellationToken ct = default);

    /// <summary>Bookings and appointments for this animal that would straddle a transfer.</summary>
    Task<(string[] BookingIds, string[] AppointmentIds)> ListLiveEngagementsAsync(
        string petId, string[] liveBookingStatuses, string[] liveAppointmentStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task CompleteApplicationAsync(
        string id, DateTimeOffset now, ITransactionScope scope, CancellationToken ct = default);

    /// <summary>
    /// Close every other open application for the listing with a note. Returns
    /// who was closed, so each can be told.
    /// </summary>
    Task<IReadOnlyList<string>> CloseRivalsAsync(
        string listingId, string exceptId, string note, DateTimeOffset now,
        ITransactionScope scope, CancellationToken ct = default);

    /// <summary>A completed application put back: <c>rejected</c>, the reason as its note, <c>completedAt</c> cleared.</summary>
    Task ReverseApplicationAsync(
        string id, string reason, DateTimeOffset now, ITransactionScope scope, CancellationToken ct = default);
}
