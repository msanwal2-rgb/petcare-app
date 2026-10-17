using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// The only writer of the three derived reputation columns.
///
/// M4 built the caretaker arm and M5 added the vet one. M10 brings a shelter
/// response rate — shelters have no rating or review count deliberately, until
/// <c>Review.kind</c> grows an adoption arm.
/// </summary>
public interface IReputationService
{
    /// <summary>
    /// Recompute from the caretaker's request history. Called whenever a request
    /// arrives or moves, which are the only two events that can change it.
    /// </summary>
    Task RefreshCaretakerResponseRateAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The vet arm of the above. An appointment says <c>confirmed</c> where a
    /// booking says <c>accepted</c>; nothing else about the rule differs.
    /// </summary>
    Task RefreshVetResponseRateAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The shelter arm (M10). An application counts as answered once the
    /// shelter has picked it up; a withdrawal counts as neither. Shelters have a
    /// response rate only — no rating and no review count (R9).
    /// </summary>
    Task RefreshShelterResponseRateAsync(
        string shelterId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Fold a new rating into the caretaker behind <paramref name="userId"/>.
    /// A no-op for a user with no caretaker profile.
    /// </summary>
    Task ApplyCaretakerRatingAsync(
        string userId, double rating,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Fold a new rating into the vet behind <paramref name="userId"/>. A no-op
    /// for a user with no vet profile — which is every owner, and is how this
    /// stays safe to call with whatever recipient a review names.
    /// </summary>
    Task ApplyVetRatingAsync(
        string userId, double rating,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>Why a caretaker-profile operation was refused.</summary>
public enum CaretakerFailure
{
    NotFound,

    /// <summary>Editing somebody else's profile. 403.</summary>
    NotYours,
}

/// <summary>
/// Caretaker profiles: search, read, and edit your own.
/// </summary>
public interface ICaretakerService
{
    /// <summary>
    /// Search. Filtered, distanced, sorted and paginated in PostgreSQL
    /// (REQUIREMENTS.md C4) — never in memory.
    ///
    /// Public: browsing the marketplace is what brings people to it, and a
    /// result carries only the public projection of the person.
    /// </summary>
    Task<CaretakerSearchPage> SearchAsync(
        CaretakerSearchQuery query, CancellationToken ct = default);

    Task<CaretakerWithUserDto?> GetAsync(string caretakerId, CancellationToken ct = default);

    /// <summary>The caretaker profile belonging to a user, or null if they have none.</summary>
    Task<CaretakerProfileDto?> GetByUserAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// Create or update the caller's own profile. Self-only: the
    /// <paramref name="userId"/> in the route must be the caller.
    /// </summary>
    Task<(CaretakerProfileDto? Profile, CaretakerFailure? Failure)> UpsertAsync(
        string callerId, string userId, CaretakerPatchRequest patch,
        CancellationToken ct = default);
}

/// <summary>The search filter as it arrives from the query string.</summary>
public sealed record CaretakerSearchQuery(
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
