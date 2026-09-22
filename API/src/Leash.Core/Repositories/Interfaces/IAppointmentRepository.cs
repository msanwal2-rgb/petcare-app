using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// <c>vet_appointments</c>.
///
/// M3 needs one read: a pet's visit history for the health-record panel. M5 owns
/// booking, the status machine and the actor rules, and will grow this
/// interface rather than start a second one.
/// </summary>
public interface IAppointmentRepository
{
    /// <summary>
    /// Every visit for this pet, newest first — scoped by the <b>pet</b>, not by
    /// whoever booked each visit.
    ///
    /// That distinction is the bug this replaces. The reference implementation's
    /// health-record panel asked for the caller's own appointments and filtered
    /// client-side, which is self-only: a treating vet opening a patient's
    /// record got a 403 and an empty panel, and an adopter could not see the
    /// history their animal arrived with.
    /// </summary>
    Task<IReadOnlyList<VetAppointmentEntity>> ListForPetAsync(
        string petId, ITransactionScope? scope = null, CancellationToken ct = default);
}
