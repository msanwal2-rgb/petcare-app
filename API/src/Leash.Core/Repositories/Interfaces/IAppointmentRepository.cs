using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// <c>vet_appointments</c>.
///
/// Grown by M5 from the single read M3 needed. Both list methods are
/// cursor-paginated for the reason <see cref="IBookingRepository"/> gives: a
/// clinic with two years of history has thousands of rows, and "load them all
/// and show twenty" is the shape that works in the demo and falls over in
/// production.
///
/// <see cref="ListForPetAsync"/> is the exception and is deliberately
/// unpaginated: it backs one animal's health timeline, which is bounded by how
/// often a pet goes to the vet rather than by how busy the marketplace is.
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

    Task<VetAppointmentEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The appointments this person booked, newest first.</summary>
    Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByOwnerAsync(
        string ownerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// One clinic's schedule, newest first. <paramref name="vetId"/> is a
    /// <c>vet_profiles</c> id, not a user id.
    /// </summary>
    Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByVetAsync(
        string vetId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The visits this person booked that overlap <paramref name="window"/>,
    /// soonest first — the owner's calendar.
    /// </summary>
    Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByOwnerInWindowAsync(
        string ownerId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>One clinic's visits that overlap <paramref name="window"/>, soonest first.</summary>
    Task<(IReadOnlyList<VetAppointmentEntity> Rows, string? NextCursor)> ListByVetInWindowAsync(
        string vetId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<VetAppointmentEntity> CreateAsync(
        VetAppointmentEntity appointment,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move the visit's window, but only while its status is one of
    /// <paramref name="fromStatuses"/>. Null when it is gone or has moved on —
    /// a cancellation racing a reschedule wins cleanly rather than leaving a
    /// cancelled visit at a new time. Whether the caller may do it is the
    /// service's question.
    /// </summary>
    Task<VetAppointmentEntity?> RescheduleAsync(
        string id, DateTimeOffset startDateTime, DateTimeOffset endDateTime,
        IReadOnlyCollection<string> fromStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move the status. Returns the row as it now stands, or null if it is gone.
    ///
    /// The legality and actor checks are <b>not</b> here — they are rules, and
    /// they live in <see cref="Services.AppointmentService"/>. This writes what
    /// it is told.
    /// </summary>
    Task<VetAppointmentEntity?> UpdateStatusAsync(
        string id, string status,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// How many of this clinic's requests are answered and how many are still
    /// waiting — the two numbers a response rate is computed from.
    ///
    /// The same shape as <see cref="IBookingRepository.CountRequestsAsync"/>,
    /// and returning the same <see cref="RequestCounts"/> type, so
    /// <see cref="Services.ReputationService"/> computes both arms with one
    /// function. Only the answered list differs: an appointment says
    /// <c>confirmed</c> where a booking says <c>accepted</c>.
    /// </summary>
    Task<RequestCounts> CountRequestsAsync(
        string vetId, IReadOnlyCollection<string> answered, string waiting,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
