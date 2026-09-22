namespace Leash.Core.Models.Dtos;

/// <summary>One line on a caretaker's rate card. <see cref="Rate"/> is USD.</summary>
public sealed record PricingEntryDto(string ServiceType, string Unit, decimal Rate);

/// <summary>A bookable window within a day, as "09:00"/"17:00" wall-clock text.</summary>
public sealed record SlotDto(string Start, string End);

/// <summary>One day of a caretaker's calendar. Empty slots means "not available".</summary>
public sealed record AvailabilityDayDto(DateOnly Date, SlotDto[] Slots);

/// <summary>What an owner wants to know about where their animal would stay.</summary>
public sealed record HomeEnvironmentDto(
    bool FencedYard, bool HasOtherPets, bool SmokeFree);

/// <summary>
/// A caretaker's profile.
///
/// <see cref="Rating"/>, <see cref="ReviewCount"/> and
/// <see cref="ResponseRatePct"/> are <b>derived</b> — a caretaker cannot type
/// them in. They are absent from <see cref="CaretakerPatchRequest"/> for that
/// reason, and <see cref="Services.ReputationService"/> is the only thing that
/// writes them.
/// </summary>
public sealed record CaretakerProfileDto(
    string Id,
    string UserId,
    string Bio,
    string[] ServicesOffered,
    PricingEntryDto[] Pricing,
    int ServiceRadiusMiles,
    string[] AcceptedSpecies,
    HomeEnvironmentDto HomeEnvironment,
    string[] Certifications,
    string BackgroundCheckStatus,
    double Rating,
    int ReviewCount,
    int ResponseRatePct,
    AvailabilityDayDto[] Availability);

/// <summary>The cheapest and dearest line on a rate card, in USD.</summary>
public sealed record PriceRangeDto(decimal Min, decimal Max);

/// <summary>
/// A caretaker joined to the person behind it — the shape a search result and a
/// profile page actually render.
///
/// The nested user is the <b>public</b> projection. A search result carrying an
/// email address and home coordinates is the mistake M1 fixed on
/// <c>GET /users/{id}</c>, and it would come straight back here.
/// </summary>
public sealed record CaretakerWithUserDto(
    CaretakerProfileDto Profile,
    PublicUserDto User,
    PriceRangeDto PriceRange,
    double? DistanceMiles);

/// <summary>
/// A page of search results plus the cursor for the next one.
///
/// <see cref="NextCursor"/> is null at the end of the results. It is opaque to
/// the client by intent — it encodes the sort key of the last row, and a client
/// that parsed it would break the first time the sort changed.
/// </summary>
public sealed record CaretakerSearchPage(
    CaretakerWithUserDto[] Items, string? NextCursor);

/// <summary>
/// An edit to one's own caretaker profile.
///
/// No <c>rating</c>, no <c>reviewCount</c>, no <c>responseRatePct</c> and no
/// <c>userId</c>. The first three are derived and the fourth is the identity of
/// the profile — accepting any of them would let a caretaker award themselves a
/// reputation or take over somebody else's listing.
///
/// <see cref="Pricing"/> and <see cref="Availability"/> are <b>replace-whole</b>
/// when present: sending them swaps the entire set, and omitting them leaves it
/// untouched. A per-row merge would need stable client-side ids for rows that
/// have none.
/// </summary>
public sealed record CaretakerPatchRequest(
    string? Bio,
    string[]? ServicesOffered,
    PricingEntryDto[]? Pricing,
    int? ServiceRadiusMiles,
    string[]? AcceptedSpecies,
    HomeEnvironmentDto? HomeEnvironment,
    string[]? Certifications,
    string? BackgroundCheckStatus,
    AvailabilityDayDto[]? Availability);
