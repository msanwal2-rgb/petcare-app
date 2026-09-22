using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// What a caretaker search asks for. Every field is optional; an empty filter
/// is "show me everyone", one page at a time.
/// </summary>
public sealed record CaretakerSearchFilter(
    double? Lat = null,
    double? Lng = null,
    double? RadiusMiles = null,
    string? ServiceType = null,
    string? Species = null,
    DateOnly? StartDate = null,
    decimal? MinPrice = null,
    decimal? MaxPrice = null,
    string? Cursor = null,
    int Limit = 24);

/// <summary>
/// One row of a search result: the profile, the person, their price range and
/// how far away they are.
/// </summary>
public sealed class CaretakerSearchRow
{
    public CaretakerProfileEntity Profile { get; set; } = new();
    public UserEntity User { get; set; } = new();
    public int MinRateCents { get; set; }
    public int MaxRateCents { get; set; }
    public double? DistanceMiles { get; set; }
}

/// <summary>
/// <c>caretaker_profiles</c> and the two tables that hang off it.
///
/// ── Search runs in PostgreSQL, not in memory ──
///
/// REQUIREMENTS.md C4 is explicit, and STATUS.md §5 makes it a standing rule
/// from this milestone: <b>no endpoint loads an unbounded set.</b> The
/// reference implementation read every caretaker row with its pricing and
/// availability, then filtered and sorted the array in Node. That is fine for
/// ten fixtures and is a table scan plus a full materialisation for ten
/// thousand — and it cannot paginate, because the page boundary is decided
/// after the work is done.
///
/// So the filtering, the distance, the price range and the ordering all happen
/// in one statement, and the caller gets a page and a cursor.
/// </summary>
public interface ICaretakerRepository
{
    Task<(IReadOnlyList<CaretakerSearchRow> Rows, string? NextCursor)> SearchAsync(
        CaretakerSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<CaretakerProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<CaretakerProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<PricingEntryEntity>> ListPricingAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<AvailabilityDayEntity>> ListAvailabilityAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The rate card line for one service, or null if they do not offer it.</summary>
    Task<PricingEntryEntity?> GetPricingForServiceAsync(
        string caretakerId, string serviceType,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<CaretakerProfileEntity> CreateAsync(
        CaretakerProfileEntity profile,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<CaretakerProfileEntity?> UpdateAsync(
        string id, CaretakerPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Replace the whole rate card. Delete-then-insert rather than a merge,
    /// because a pricing row has no client-stable identity to merge on.
    /// </summary>
    Task ReplacePricingAsync(
        string caretakerId, IReadOnlyList<PricingEntryEntity> pricing,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Replace the whole calendar, for the same reason.</summary>
    Task ReplaceAvailabilityAsync(
        string caretakerId, IReadOnlyList<AvailabilityDayEntity> availability,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Write the derived reputation columns. Separate from
    /// <see cref="UpdateAsync"/> so that the only path to these three is
    /// <see cref="Services.ReputationService"/> — a caretaker's own patch
    /// cannot reach this method because the patch DTO has no such fields.
    /// </summary>
    Task SetReputationAsync(
        string caretakerId, double? rating, int? reviewCount, int? responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>The scalar columns a caretaker may edit about themselves.</summary>
public sealed record CaretakerPatch(
    string? Bio = null,
    string[]? ServicesOffered = null,
    int? ServiceRadiusMiles = null,
    string[]? AcceptedSpecies = null,
    bool? FencedYard = null,
    bool? HasOtherPets = null,
    bool? SmokeFree = null,
    string[]? Certifications = null,
    string? BackgroundCheckStatus = null);
