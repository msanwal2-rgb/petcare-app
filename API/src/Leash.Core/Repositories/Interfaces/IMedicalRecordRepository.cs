using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Everything the application does to <c>medical_records</c>.
///
/// ── The one place "is this prescription active?" is answered ──
///
/// REQUIREMENTS.md P8 is explicit about this, because the system it replaces got
/// it wrong in the most expensive way available: it had <b>four</b>
/// implementations of that question, and only the SQL one gated money. The
/// others disagreed with it, which meant the badge on the product page and the
/// rule at checkout were answering different questions.
///
/// So <see cref="ListActivePrescriptionsAsync"/> is the only expression of it
/// in this codebase. <see cref="ListAuthorizedProductSlugsAsync"/> is derived
/// from the same SQL predicate rather than restating it, and M6's checkout gate
/// must call one of these two — not write a third.
/// </summary>
public interface IMedicalRecordRepository
{
    /// <summary>
    /// A pet's whole timeline, newest first. Ordered by <c>occurredAt</c>, not
    /// <c>createdAt</c>: a vet writing up Tuesday's visit on Thursday files it
    /// under Tuesday, which is where a reader looks for it.
    /// </summary>
    Task<IReadOnlyList<MedicalRecordEntity>> ListForPetAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<MedicalRecordEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<MedicalRecordEntity> CreateAsync(
        MedicalRecordEntity record,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<bool> DeleteAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The pet's prescriptions that are still valid at <paramref name="asOf"/>
    /// — the exact set the store checks before letting an Rx-only product into
    /// an order.
    ///
    /// A missing <c>expiresAt</c> means the vet set no end date, which counts as
    /// valid. <c>refillsLeft = 0</c> does not, because the authorisation is used
    /// up; a null <c>refillsLeft</c> means the vet set no limit and does.
    /// </summary>
    Task<IReadOnlyList<MedicalRecordEntity>> ListActivePrescriptionsAsync(
        string petId, DateTimeOffset asOf,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The distinct product slugs this pet's active prescriptions authorise.
    /// Derived from the same predicate as
    /// <see cref="ListActivePrescriptionsAsync"/>.
    /// </summary>
    Task<IReadOnlyList<string>> ListAuthorizedProductSlugsAsync(
        string petId, DateTimeOffset asOf,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
