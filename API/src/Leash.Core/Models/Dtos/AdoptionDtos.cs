namespace Leash.Core.Models.Dtos;

// ── Shelters ─────────────────────────────────────────────────────────────

/// <summary>
/// Where a shelter is. Five flat columns on the table, one object on the wire —
/// the shape <c>web/src/types</c> declares.
/// </summary>
public sealed record ShelterAddressDto(string Line, string City, string State, double Lat, double Lng);

/// <summary>
/// A shelter's profile (REQUIREMENTS.md §10.3).
///
/// <see cref="VerificationStatus"/> is set by staff and
/// <see cref="ResponseRatePct"/> is derived from application statuses. Neither
/// is on <see cref="ShelterPatchRequest"/>, so neither can be typed in. There is
/// no rating and no review count at all (R9).
/// </summary>
public sealed record ShelterProfileDto(
    string Id,
    string UserId,
    string Name,
    string Bio,
    string Kind,
    string RegistrationNumber,
    string RegistrationState,
    string VerificationStatus,
    string[] AcceptedSpecies,
    string WebsiteUrl,
    string Phone,
    string Email,
    ShelterAddressDto Address,
    string AdoptionPolicy,
    int ResponseRatePct,
    DateTimeOffset CreatedAt);

/// <summary>
/// A shelter joined to its account, as a search result and the shelter page
/// render it. Nested like <see cref="VetWithUserDto"/>, and the user is the
/// <b>public</b> projection for the same reason.
/// </summary>
public sealed record ShelterWithUserDto(
    ShelterProfileDto Profile,
    PublicUserDto User,
    /// <summary>How many animals they have available right now.</summary>
    int AvailableCount,
    /// <summary>Straight-line miles to the shelter, when the search gave an origin.</summary>
    double? DistanceMiles);

public sealed record ShelterSearchPage(ShelterWithUserDto[] Items, string? NextCursor);

public sealed record ShelterSearchQuery(
    double? Lat, double? Lng, double? RadiusMiles, string? Species, string? Kind,
    bool WithAvailable, bool VerifiedOnly, string? Cursor, int Limit);

/// <summary>
/// An edit to one's own shelter profile. Every field optional; an omitted one is
/// left alone. <c>address</c> is all five columns or none.
/// </summary>
public sealed record ShelterPatchRequest(
    string? Name,
    string? Bio,
    string? Kind,
    string? RegistrationNumber,
    string? RegistrationState,
    string[]? AcceptedSpecies,
    string? WebsiteUrl,
    string? Phone,
    string? Email,
    ShelterAddressDto? Address,
    string? AdoptionPolicy);

// ── Listings ─────────────────────────────────────────────────────────────

/// <summary>Where the animal actually is — a fostered dog is not at the shelter.</summary>
public sealed record ListingLocationDto(string City, string State, double Lat, double Lng);

/// <summary>An adoption listing. <see cref="FeeCents"/> is integer cents: it reaches the ledger.</summary>
public sealed record AdoptionListingDto(
    string Id,
    string ShelterId,
    string PetId,
    string Status,
    int FeeCents,
    string Currency,
    string Headline,
    string Story,
    string GoodWithKids,
    string GoodWithDogs,
    string GoodWithCats,
    string HouseTrained,
    string EnergyLevel,
    bool SpecialNeeds,
    string SpecialNeedsNotes,
    bool SpayedNeutered,
    bool Microchipped,
    ListingLocationDto Location,
    DateTimeOffset IntakeAt,
    DateTimeOffset? PublishedAt,
    DateTimeOffset? ClosedAt,
    DateTimeOffset CreatedAt);

/// <summary>A listing with the animal it is about — what a card renders.</summary>
public sealed record AdoptionListingWithPetDto(
    AdoptionListingDto Listing,
    PetDto Pet,
    string ShelterName,
    double? DistanceMiles);

/// <summary>
/// A page of the directory. <see cref="Total"/> counts every match, radius
/// included, so "N waiting" is the number the filters actually describe.
/// </summary>
public sealed record AdoptionListingPage(AdoptionListingWithPetDto[] Items, string? NextCursor, int Total);

public sealed record ListingSearchQuery(
    double? Lat, double? Lng, double? RadiusMiles, string? Species, string? ShelterId,
    string? GoodWithKids, string? GoodWithDogs, string? GoodWithCats, string? EnergyLevel,
    int? MaxFeeCents, string? Q, string? Cursor, int Limit);

/// <summary>
/// List an animal. No <c>status</c> (a listing moves through its own endpoint)
/// and no <c>shelterId</c> (it is the caller's). The location defaults to the
/// shelter's own address.
/// </summary>
public sealed record CreateListingRequest(
    string PetId,
    int? FeeCents,
    string? Headline,
    string? Story,
    string? GoodWithKids,
    string? GoodWithDogs,
    string? GoodWithCats,
    string? HouseTrained,
    string? EnergyLevel,
    bool? SpecialNeeds,
    string? SpecialNeedsNotes,
    bool? SpayedNeutered,
    bool? Microchipped,
    string? City,
    string? State,
    double? Lat,
    double? Lng,
    DateTimeOffset? IntakeAt);

/// <summary>An edit. No <c>petId</c>: a listing is about one animal for life.</summary>
public sealed record UpdateListingRequest(
    int? FeeCents,
    string? Headline,
    string? Story,
    string? GoodWithKids,
    string? GoodWithDogs,
    string? GoodWithCats,
    string? HouseTrained,
    string? EnergyLevel,
    bool? SpecialNeeds,
    string? SpecialNeedsNotes,
    bool? SpayedNeutered,
    bool? Microchipped,
    string? City,
    string? State,
    double? Lat,
    double? Lng,
    DateTimeOffset? IntakeAt);

public sealed record ListingStatusRequest(string Status);

// ── Applications ─────────────────────────────────────────────────────────

/// <summary>
/// An application to adopt. <see cref="PetName"/>, <see cref="PetPhotoUrl"/>
/// and <see cref="FeeCents"/> are snapshots taken at submission, so the row
/// still means something after the listing changes or goes.
/// </summary>
public sealed record AdoptionApplicationDto(
    string Id,
    string ListingId,
    string ShelterId,
    string PetId,
    string PetName,
    string PetPhotoUrl,
    string ApplicantId,
    string Status,
    int FeeCents,
    int HouseholdAdults,
    int HouseholdChildren,
    bool HasOtherPets,
    string OtherPetsNotes,
    string HomeType,
    bool FencedYard,
    bool OwnsHome,
    int HoursAlonePerDay,
    string Experience,
    string Message,
    string DecisionNote,
    DateTimeOffset? DecidedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset CreatedAt);

/// <summary>
/// An application as the shelter reviewing it sees it: who is asking, and
/// whether they have paid. <see cref="PaymentStatus"/> is null until a fee has
/// been charged, and stays null for a waived one.
/// </summary>
public sealed record AdoptionApplicationWithApplicantDto(
    AdoptionApplicationDto Application,
    PublicUserDto Applicant,
    string? PaymentStatus);

public sealed record AdoptionApplicationPage(AdoptionApplicationDto[] Items, string? NextCursor);

public sealed record ShelterQueuePage(AdoptionApplicationWithApplicantDto[] Items, string? NextCursor);

/// <summary>Apply to adopt. No <c>applicantId</c> — it is the caller.</summary>
public sealed record CreateApplicationRequest(
    string ListingId,
    int HouseholdAdults,
    int HouseholdChildren,
    bool HasOtherPets,
    string? OtherPetsNotes,
    string HomeType,
    bool FencedYard,
    bool OwnsHome,
    int HoursAlonePerDay,
    string? Experience,
    string? Message);

public sealed record ApplicationStatusRequest(string Status, string? Note);

/// <summary>
/// <see cref="Force"/> cancels any live booking or appointment standing in the
/// way (R7). Never sent without showing the person what it will cancel.
/// </summary>
public sealed record CompleteAdoptionRequest(bool? Force);

public sealed record CompletedAdoptionDto(AdoptionApplicationDto Application, PetDto Pet);

/// <summary>The fee's payment handoff and where the payment now stands.</summary>
public sealed record AdoptionPaymentDto(PaymentHandoffDto Payment, string Status);

public sealed record ReverseAdoptionRequest(string Reason);

public sealed record ReversedAdoptionDto(PetDto Pet);
