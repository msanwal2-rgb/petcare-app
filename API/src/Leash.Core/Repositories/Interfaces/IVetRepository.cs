using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// What a vet search asks for (REQUIREMENTS.md V3). Every field is optional; an
/// empty filter is "show me everyone", one page at a time.
/// </summary>
public sealed record VetSearchFilter(
    double? Lat = null,
    double? Lng = null,
    double? RadiusMiles = null,
    string? Specialty = null,
    string? Species = null,
    string? Mode = null,
    bool EmergencyOnly = false,
    string? Cursor = null,
    int Limit = 24);

/// <summary>One row of a search result: the profile, the person, and the distance.</summary>
public sealed class VetSearchRow
{
    public VetProfileEntity Profile { get; set; } = new();
    public UserEntity User { get; set; } = new();
    public double? DistanceMiles { get; set; }
}

/// <summary>
/// A partial edit, flattened from <see cref="VetPatchRequest"/> to the column
/// shape — <c>clinic</c> is one nested object on the wire and five columns in
/// the table, and a patch that omits it must leave all five alone.
/// </summary>
public sealed record VetPatch(
    string? Bio,
    string[]? Specialties,
    string? LicenseNumber,
    string? LicenseState,
    int? YearsExperience,
    string[]? AcceptedSpecies,
    string[]? ConsultModes,
    int? ConsultFeeCents,
    bool? EmergencyAvailable,
    string? ClinicName,
    string? ClinicCity,
    string? ClinicState,
    double? Lat,
    double? Lng);

/// <summary>
/// <c>vet_profiles</c> and its calendar.
///
/// Deliberately the same interface as <see cref="ICaretakerRepository"/> minus
/// the rate card: a vet has one fee rather than a card of them, so there is no
/// <c>pricing_entries</c> analogue and no price-range filter.
///
/// <b>Search runs in PostgreSQL, not in memory</b> — REQUIREMENTS.md V3, and
/// the standing rule from M4. The reference implementation read every vet row
/// with its availability and its user, then filtered and sorted the array in
/// Node; that cannot paginate, because the page boundary is decided after the
/// work is done.
/// </summary>
public interface IVetRepository
{
    Task<(IReadOnlyList<VetSearchRow> Rows, string? NextCursor)> SearchAsync(
        VetSearchFilter filter,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<VetProfileEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<VetProfileEntity?> GetByUserIdAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<VetAvailabilityDayEntity>> ListAvailabilityAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<VetProfileEntity> CreateAsync(
        VetProfileEntity profile,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<VetProfileEntity?> UpdateAsync(
        string id, VetPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Replace-whole. Sending a calendar swaps the entire set.</summary>
    Task ReplaceAvailabilityAsync(
        string vetId, IReadOnlyList<VetAvailabilityDayEntity> availability,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Write the derived columns. Null leaves one alone, so the response-rate
    /// path and the rating path do not overwrite each other's work.
    /// <see cref="Services.ReputationService"/> is the only caller.
    /// </summary>
    Task SetReputationAsync(
        string vetId, double? rating, int? reviewCount, int? responseRatePct,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
