using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// Why a pet operation was refused, when the reason changes the status code.
/// </summary>
public enum PetFailure
{
    /// <summary>No such pet, or none this caller may see. Both mean 404.</summary>
    NotFound,

    /// <summary>The caller may see the pet but may not do this to it. 403.</summary>
    NotOwner,

    /// <summary>
    /// The pet carries clinical history, so deleting it would destroy records
    /// the owner did not author. 409.
    /// </summary>
    HasHistory,
}

/// <summary>
/// Pets, and the authorization that governs them.
///
/// Every method takes the caller's id as its first argument and checks it
/// against <see cref="IAccessService"/> before touching a row — the check is
/// never inferred from a previous request, and never left to the controller.
/// The controller's job is to turn a <see cref="PetFailure"/> into a status
/// code.
///
/// ── Why refusals collapse into 404 ──
///
/// A pet the caller may not see is reported as <see cref="PetFailure.NotFound"/>
/// rather than a distinct "forbidden". Ids in this system are readable and
/// sequential (<c>p1</c>, <c>p2</c>, …), so a caller able to tell "no such pet"
/// from "not your pet" can map the table by watching which ids come back
/// forbidden. <see cref="PetFailure.NotOwner"/> exists for the narrower case
/// where the caller can legitimately <i>see</i> the animal — a sitter, a
/// treating vet — and is being told they cannot edit it. Revealing existence
/// there gives nothing away, because they could already read it.
/// </summary>
public interface IPetService
{
    /// <summary>The caller's own pets. Self-only; there is no "list someone else's".</summary>
    Task<IReadOnlyList<PetDto>> ListMineAsync(
        string callerId, CancellationToken ct = default);

    /// <summary>
    /// One pet, if the caller may see it: its owner, a caretaker with a
    /// qualifying booking, or a treating vet.
    /// </summary>
    Task<PetDto?> GetAsync(
        string callerId, string petId, CancellationToken ct = default);

    /// <summary>
    /// Batch resolve, <b>filtered to what the caller may see</b> rather than
    /// refused wholesale.
    ///
    /// The callers are legitimately mixed — a booking detail page asks for every
    /// pet on the booking and a caretaker is entitled to all of them — so an id
    /// the caller may not see is simply absent from the answer, which also makes
    /// an unknown id and a forbidden one indistinguishable from outside.
    /// </summary>
    Task<IReadOnlyList<PetDto>> GetManyAsync(
        string callerId, IReadOnlyCollection<string> petIds,
        CancellationToken ct = default);

    /// <summary>
    /// Create a pet owned by the caller, stamping <c>ownedSince</c> to now.
    ///
    /// Not the epoch: this owner really has had the animal since now, so a
    /// caretaker booked before it existed gets nothing from it.
    /// </summary>
    Task<PetDto> CreateAsync(
        string callerId, PetInputRequest input, CancellationToken ct = default);

    /// <summary>Edit. Owner only — a sitter who may read a pet may not rewrite it.</summary>
    Task<(PetDto? Pet, PetFailure? Failure)> UpdateAsync(
        string callerId, string petId, PetPatchRequest patch,
        CancellationToken ct = default);

    /// <summary>
    /// Delete. Owner only, and <b>only while the animal has no clinical
    /// history</b> — see the implementation for why.
    /// </summary>
    Task<PetFailure?> DeleteAsync(
        string callerId, string petId, CancellationToken ct = default);

    /// <summary>
    /// This animal's visit history, for anyone who may see the animal. Visits
    /// the caller did not book come back without their fee.
    /// </summary>
    Task<IReadOnlyList<AppointmentTimelineDto>?> ListAppointmentsAsync(
        string callerId, string petId, CancellationToken ct = default);
}
