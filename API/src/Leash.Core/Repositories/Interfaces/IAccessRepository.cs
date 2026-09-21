using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// The lookups the authorization predicates need, and nothing else.
///
/// ── Why this is its own repository ──
///
/// It reads five tables that M3, M4, M5 and M10 will each own a repository for,
/// so the obvious objection is that it duplicates them. It does not, and the
/// duplication is the point:
///
///  - <b>The projections are deliberately minimal.</b> Every method here returns
///    one or two columns. A feature repository returns whole rows, because its
///    callers render them. Routing an authorization check through
///    <c>IPetRepository.GetByIdAsync</c> would load medications, allergies and
///    the household vet's phone number in order to compare one string.
///  - <b>Nothing a feature team does can change what an authorization query
///    asks.</b> When M3 adds a column, widens a projection or adds a
///    soft-delete filter to <c>IPetRepository</c>, none of it reaches this file.
///    A shared method is a shared blast radius, and this is the code where the
///    blast radius is an authorization hole.
///
/// So these queries stay here, and stay short enough to verify by reading.
///
/// ── The status filter ──
///
/// <c>HasQualifyingBookingAsync</c> and <c>HasQualifyingAppointmentAsync</c>
/// take the disqualifying statuses as an argument rather than naming them in
/// the SQL. Which statuses void an engagement is a rule, and rules live in the
/// service (ARCHITECTURE.md section 1) — see
/// <see cref="Services.AccessService.DisqualifyingStatuses"/>.
/// </summary>
public interface IAccessRepository
{
    /// <summary>
    /// Who owns this pet and since when, or null if there is no such pet.
    ///
    /// Loaded once per predicate and threaded through the branches below. The
    /// reference implementation's note applies unchanged: before it was
    /// extracted, a single <c>canViewPet</c> fetched this same row three times.
    /// </summary>
    Task<PetOwnershipEntity?> GetPetOwnershipAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<BookingParticipantsEntity?> GetBookingParticipantsAsync(
        string bookingId, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<AppointmentParticipantsEntity?> GetAppointmentParticipantsAsync(
        string appointmentId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The user behind a caretaker profile, or null if there is no such profile.</summary>
    Task<string?> GetCaretakerProfileUserIdAsync(
        string caretakerId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The user behind a vet profile, or null if there is no such profile.</summary>
    Task<string?> GetVetProfileUserIdAsync(
        string vetId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The user behind a shelter profile, or null if there is no such profile.</summary>
    Task<string?> GetShelterProfileUserIdAsync(
        string shelterId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// This user's caretaker profile id, or null if they have none.
    /// <c>caretaker_profiles."userId"</c> is unique, so this is at most one row.
    /// </summary>
    Task<string?> GetCaretakerProfileIdForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// This user's vet profile id, or null if they have none.
    /// <c>vet_profiles."userId"</c> is unique, so this is at most one row.
    /// </summary>
    Task<string?> GetVetProfileIdForUserAsync(
        string userId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Does this caretaker hold a booking that covers this pet, is not in one of
    /// <paramref name="disqualifyingStatuses"/>, and was created <b>at or
    /// after</b> <paramref name="ownedSince"/>?
    ///
    /// The timestamp bound is the whole reason this method is not just "does a
    /// booking exist". See <see cref="Services.AccessService"/>.
    /// </summary>
    Task<bool> HasQualifyingBookingAsync(
        string caretakerId, string petId, DateTimeOffset ownedSince,
        IReadOnlyCollection<string> disqualifyingStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Does this vet hold an appointment for this pet, not in one of
    /// <paramref name="disqualifyingStatuses"/>, created <b>at or after</b>
    /// <paramref name="ownedSince"/>?
    /// </summary>
    Task<bool> HasQualifyingAppointmentAsync(
        string vetId, string petId, DateTimeOffset ownedSince,
        IReadOnlyCollection<string> disqualifyingStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
