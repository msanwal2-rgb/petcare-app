using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// The authorization core (REQUIREMENTS.md section 4): "may this user touch
/// this record?", asked of the database and answered yes or no.
///
/// Every predicate takes a user id the caller has <b>already established</b> —
/// from the authenticated principal, never from a request body. None of them
/// establishes identity; that is authentication, and it happened upstream in
/// <see cref="ISessionValidator"/>.
///
/// ── How to use these ──
///
/// The rule from AGENTS.md, restated because this is the interface it is about:
/// <b>authorization is checked in the API on every request, re-checked on every
/// write, and never inferred from a previous request.</b> A caller that checked
/// <see cref="OwnsPetAsync"/> when it rendered the form checks it again when it
/// handles the submit.
///
/// ── The scope parameter ──
///
/// Every predicate takes an optional <see cref="ITransactionScope"/>, matching
/// the repository convention. It is there for the re-check on a write: a
/// service that opens a transaction, verifies the caller may act, and then
/// writes must run the verification <i>inside</i> that transaction. Run outside
/// it, the check reads a snapshot the write can no longer rely on — the row it
/// approved may have been handed to someone else between the two statements.
///
/// ── Refusals are not distinguished from absences ──
///
/// Every predicate answers false for a row that does not exist, the same as for
/// a row the caller may not touch. That is deliberate: ids in this system are
/// readable and sequential (<c>p1</c>, <c>p2</c>, …), so a caller able to tell
/// "no such pet" from "not your pet" can enumerate the table. Controllers turn
/// both into 404 for the same reason.
/// </summary>
public interface IAccessService
{
    /// <summary>
    /// Whether the caller holds a staff role. <c>admin</c> satisfies every staff
    /// check (REQUIREMENTS.md A12).
    /// </summary>
    Task<bool> HasStaffRoleAsync(
        string userId, string role,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Is the caller this pet's owner? Nothing else counts.</summary>
    Task<bool> OwnsPetAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// May the caller see this pet at all — its owner, a caretaker with a
    /// qualifying booking, or a vet with a qualifying appointment?
    ///
    /// Distinct from <see cref="CanAccessPetRecordsAsync"/>, which governs the
    /// clinical history. This is the pet as a <i>booking</i> sees it: name,
    /// breed, feeding instructions, behaviour notes.
    /// </summary>
    Task<bool> CanViewPetAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// May the caller read this pet's health record, and if so, as which vet?
    ///
    /// The owner always may. A vet may once they hold a qualifying appointment
    /// for the animal — treating someone's pet is what earns access to its
    /// history, and it ends there. A caretaker never may: a booking is not
    /// clinical access.
    /// </summary>
    Task<RecordAccess> CanAccessPetRecordsAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Is the caller one of the two sides of this booking — the owner who
    /// placed it, or the user behind the caretaker profile it was placed with?
    /// </summary>
    Task<bool> IsBookingParticipantAsync(
        string userId, string bookingId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Is the caller one of the two sides of this appointment — the owner, or
    /// the user behind the vet profile it was booked with?
    /// </summary>
    Task<bool> IsAppointmentParticipantAsync(
        string userId, string appointmentId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Does the caller own the caretaker profile with this id?</summary>
    Task<bool> OwnsCaretakerProfileAsync(
        string userId, string caretakerId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Does the caller own the vet profile with this id?</summary>
    Task<bool> OwnsVetProfileAsync(
        string userId, string vetId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>Does the caller own the shelter profile with this id?</summary>
    Task<bool> OwnsShelterProfileAsync(
        string userId, string shelterId,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
