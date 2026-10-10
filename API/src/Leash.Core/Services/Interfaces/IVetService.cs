using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>Why a vet-profile operation was refused.</summary>
public enum VetFailure
{
    NotFound,

    /// <summary>Editing somebody else's profile. 403.</summary>
    NotYours,
}

/// <summary>The search filter as it arrives from the query string.</summary>
public sealed record VetSearchQuery(
    double? Lat = null,
    double? Lng = null,
    double? RadiusMiles = null,
    string? Specialty = null,
    string? Species = null,
    string? Mode = null,
    bool EmergencyOnly = false,
    string? Cursor = null,
    int Limit = 24);

/// <summary>
/// Vet profiles: search, read, and edit your own.
///
/// The mirror of <see cref="ICaretakerService"/>, with one rule of its own:
/// <b>a vet cannot set their own <c>verificationStatus</c></b>
/// (REQUIREMENTS.md V11). The licence badge is the only thing on the profile
/// that means anything to an owner precisely because its subject cannot grant
/// it, so it is absent from <see cref="VetPatchRequest"/> and staff set it in
/// M9.
/// </summary>
public interface IVetService
{
    /// <summary>
    /// Search. Filtered, distanced, sorted and paginated in PostgreSQL
    /// (REQUIREMENTS.md V3) — never in memory.
    ///
    /// Public: browsing is what brings people to the marketplace, and a result
    /// carries only the public projection of the person.
    /// </summary>
    Task<VetSearchPage> SearchAsync(VetSearchQuery query, CancellationToken ct = default);

    Task<VetWithUserDto?> GetAsync(string vetId, CancellationToken ct = default);

    /// <summary>The vet profile belonging to a user, or null if they have none.</summary>
    Task<VetProfileDto?> GetByUserAsync(string userId, CancellationToken ct = default);

    /// <summary>
    /// Create or update the caller's own profile. Self-only: the
    /// <paramref name="userId"/> in the route must be the caller.
    /// </summary>
    Task<(VetProfileDto? Profile, VetFailure? Failure)> UpsertAsync(
        string callerId, string userId, VetPatchRequest patch,
        CancellationToken ct = default);
}
