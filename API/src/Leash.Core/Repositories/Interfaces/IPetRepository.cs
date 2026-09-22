using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Everything the application does to the <c>pets</c> table.
///
/// Note what is absent: <b>no method changes <c>ownerId</c>.</b>
/// <see cref="CreateAsync"/> sets it once, and nothing here can move it
/// afterwards. An adoption transfer (M10) is the only thing that may, and when
/// it arrives it adds its own method here that writes <c>ownerId</c> and
/// <c>ownedSince</c> in the same statement — never one without the other, or
/// every caretaker and vet grant from the old household survives the transfer.
/// </summary>
public interface IPetRepository
{
    Task<PetEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<PetEntity>> ListByOwnerAsync(
        string ownerId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Batch-resolve by id, for a screen holding several ids at once. Returns
    /// only the rows that exist; the caller has already filtered the ids to the
    /// ones it may see.
    /// </summary>
    Task<IReadOnlyList<PetEntity>> GetManyAsync(
        IReadOnlyCollection<string> ids,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Insert, stamping <c>ownedSince</c>. The caller supplies the id and the
    /// timestamp so a transfer and a creation cannot disagree about the clock.
    /// </summary>
    Task<PetEntity> CreateAsync(
        PetEntity pet, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Apply a partial edit, writing only the properties the caller set.
    /// Returns the row as it now stands, or null if there was none.
    /// </summary>
    Task<PetEntity?> UpdateAsync(
        string id, PetPatch patch,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<bool> DeleteAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// How much history this pet has accumulated, for the delete guard. Two
    /// counts in one round trip because the guard needs both and a pet with
    /// either is not deletable.
    /// </summary>
    Task<PetHistoryCounts> CountHistoryAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// The columns a PATCH may touch, each null when the caller did not send it.
///
/// A dedicated type rather than passing <see cref="Models.Dtos.PetPatchRequest"/>
/// down: the request is the wire contract and this is what the SQL writes, and
/// the two differ in exactly the way that matters — the request nests
/// <c>vetContact</c>, the table has two flat columns.
/// </summary>
public sealed record PetPatch(
    string? Name = null,
    string? Species = null,
    string? Breed = null,
    string? Sex = null,
    DateOnly? Dob = null,
    int? WeightLbs = null,
    string? PhotoUrl = null,
    bool? Vaccinated = null,
    string[]? Allergies = null,
    string[]? Medications = null,
    string? BehaviorNotes = null,
    string? FeedingInstructions = null,
    string? VetName = null,
    string? VetPhone = null);

/// <summary>
/// What a pet would take with it if it were deleted.
///
/// A mutable class, not a positional record, because Dapper materialises it —
/// the same rule as every other row type here (ARCHITECTURE.md section 2).
/// </summary>
public sealed class PetHistoryCounts
{
    public int MedicalRecords { get; set; }
    public int Appointments { get; set; }

    public bool Any => MedicalRecords > 0 || Appointments > 0;
}
