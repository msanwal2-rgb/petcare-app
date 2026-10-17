using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>shelter_profiles</c> row. Mutable with parameterless construction for
/// Dapper, like every entity here (<c>text[]</c> and <c>timestamptz</c> defeat
/// constructor matching).
///
/// <see cref="VerificationStatus"/> is staff's (V11) and
/// <see cref="ResponseRatePct"/> is <see cref="Services.ReputationService"/>'s;
/// the shelter's own patch reaches neither.
/// </summary>
public class ShelterProfileEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Bio { get; set; } = "";
    public string Kind { get; set; } = "";
    public string RegistrationNumber { get; set; } = "";
    public string RegistrationState { get; set; } = "";
    public string VerificationStatus { get; set; } = "";

    /// <summary>Nullable in the schema; read as empty.</summary>
    public string[]? AcceptedSpecies { get; set; }

    public string WebsiteUrl { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public string AdoptionPolicy { get; set; } = "";
    public int ResponseRatePct { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public ShelterProfileDto ToDto() => new(
        Id, UserId, Name, Bio, Kind, RegistrationNumber, RegistrationState,
        VerificationStatus, AcceptedSpecies ?? [], WebsiteUrl, Phone, Email,
        new ShelterAddressDto(AddressLine, City, State, Lat, Lng),
        AdoptionPolicy, ResponseRatePct, CreatedAt);
}

/// <summary>
/// The <c>adoption_listings</c> row: a thin wrapper around an animal the
/// shelter already owns. The <c>pets</c> row is the animal; this says it is on
/// offer, what it costs, and what an adopter filters on.
/// </summary>
public class AdoptionListingEntity
{
    public string Id { get; set; } = "";
    public string ShelterId { get; set; } = "";
    public string PetId { get; set; } = "";
    public string Status { get; set; } = "";
    public int FeeCents { get; set; }
    public string Currency { get; set; } = "";
    public string Headline { get; set; } = "";
    public string Story { get; set; } = "";
    public string GoodWithKids { get; set; } = "";
    public string GoodWithDogs { get; set; } = "";
    public string GoodWithCats { get; set; } = "";
    public string HouseTrained { get; set; } = "";
    public string EnergyLevel { get; set; } = "";
    public bool SpecialNeeds { get; set; }
    public string SpecialNeedsNotes { get; set; } = "";
    public bool SpayedNeutered { get; set; }
    public bool Microchipped { get; set; }
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public double Lat { get; set; }
    public double Lng { get; set; }
    public DateTimeOffset IntakeAt { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public AdoptionListingDto ToDto() => new(
        Id, ShelterId, PetId, Status, FeeCents, Currency, Headline, Story,
        GoodWithKids, GoodWithDogs, GoodWithCats, HouseTrained, EnergyLevel,
        SpecialNeeds, SpecialNeedsNotes, SpayedNeutered, Microchipped,
        new ListingLocationDto(City, State, Lat, Lng),
        IntakeAt, PublishedAt, ClosedAt, CreatedAt);
}

/// <summary>A listing read with its animal, its shelter's name and, on a located search, a distance.</summary>
public class ListingRow
{
    public AdoptionListingEntity Listing { get; set; } = null!;
    public PetEntity Pet { get; set; } = null!;
    public string ShelterName { get; set; } = "";
    public double? DistanceMiles { get; set; }

    public AdoptionListingWithPetDto ToDto() =>
        new(Listing.ToDto(), Pet.ToDto(), ShelterName, DistanceMiles);
}

/// <summary>A shelter read with its account and its available-animal count.</summary>
public class ShelterRow
{
    public ShelterProfileEntity Profile { get; set; } = null!;
    public UserEntity User { get; set; } = null!;
    public int AvailableCount { get; set; }
    public double? DistanceMiles { get; set; }

    public ShelterWithUserDto ToDto() =>
        new(Profile.ToDto(), User.ToPublicDto(), AvailableCount, DistanceMiles);
}

/// <summary>The <c>adoption_applications</c> row.</summary>
public class AdoptionApplicationEntity
{
    public string Id { get; set; } = "";
    public string ListingId { get; set; } = "";
    public string ShelterId { get; set; } = "";
    public string PetId { get; set; } = "";
    public string PetName { get; set; } = "";
    public string PetPhotoUrl { get; set; } = "";
    public string ApplicantId { get; set; } = "";
    public string Status { get; set; } = "";
    public int FeeCents { get; set; }
    public int HouseholdAdults { get; set; }
    public int HouseholdChildren { get; set; }
    public bool HasOtherPets { get; set; }
    public string OtherPetsNotes { get; set; } = "";
    public string HomeType { get; set; } = "";
    public bool FencedYard { get; set; }
    public bool OwnsHome { get; set; }
    public int HoursAlonePerDay { get; set; }
    public string Experience { get; set; } = "";
    public string Message { get; set; } = "";
    public string DecisionNote { get; set; } = "";
    public DateTimeOffset? DecidedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public AdoptionApplicationDto ToDto() => new(
        Id, ListingId, ShelterId, PetId, PetName, PetPhotoUrl, ApplicantId, Status,
        FeeCents, HouseholdAdults, HouseholdChildren, HasOtherPets, OtherPetsNotes,
        HomeType, FencedYard, OwnsHome, HoursAlonePerDay, Experience, Message,
        DecisionNote, DecidedAt, CompletedAt, CreatedAt);
}

/// <summary>An application in a shelter's queue, with who is asking and what they have paid.</summary>
public class QueueRow
{
    public AdoptionApplicationEntity Application { get; set; } = null!;
    public UserEntity Applicant { get; set; } = null!;
    public string? PaymentStatus { get; set; }

    public AdoptionApplicationWithApplicantDto ToDto() =>
        new(Application.ToDto(), Applicant.ToPublicDto(), PaymentStatus);
}
