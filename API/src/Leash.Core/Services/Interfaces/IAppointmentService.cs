using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>Which side of an appointment somebody is on.</summary>
public enum AppointmentActor
{
    Owner,
    Vet,
}

/// <summary>Why an appointment operation was refused.</summary>
public enum AppointmentFailure
{
    NotFound,

    /// <summary>The caller is neither the owner nor the vet. 404.</summary>
    NotParticipant,

    /// <summary>No such vet profile. 404.</summary>
    VetNotFound,

    /// <summary>No such pet, or not the caller's. 403.</summary>
    NotYourPet,

    /// <summary>This clinic does not treat that species. 409.</summary>
    SpeciesNotAccepted,

    /// <summary>This clinic does not offer that consult mode. 409.</summary>
    ModeNotOffered,

    /// <summary>The window ends at or before it starts. 400.</summary>
    BadDates,

    /// <summary>Too soon — the request does not clear the minimum lead time. 409.</summary>
    LeadTime,

    /// <summary>
    /// The move is not on the transition table at all (REQUIREMENTS.md §11.2).
    /// <b>409</b>, and checked before the actor.
    /// </summary>
    InvalidTransition,

    /// <summary>
    /// A legal move, by the wrong party. <b>403.</b> This is the one that stops
    /// an owner confirming their own appointment (REQUIREMENTS.md V6).
    /// </summary>
    WrongActor,

    /// <summary>
    /// A visit summary written by somebody who is not the treating vet — an
    /// owner, or the wrong clinic. 403.
    /// </summary>
    NotTheVet,

    /// <summary>
    /// A visit summary on an appointment that is not <c>in_progress</c>. 409.
    /// Completing a visit is how a summary gets written, so there is no summary
    /// to write on one that has not started or has already ended.
    /// </summary>
    NotInProgress,

    /// <summary>
    /// A record in the summary names a type the server does not know, or the
    /// summary is empty. 400.
    /// </summary>
    BadSummary,

    /// <summary>
    /// A reschedule of an appointment that is no longer waiting to happen —
    /// started, finished, declined or cancelled. 409: the rule is about the
    /// appointment, and it is checked before the actor.
    /// </summary>
    NotReschedulable,

    /// <summary>A reschedule to a time that has already begun. 400.</summary>
    RescheduleInPast,
}

/// <summary>
/// Vet appointments: booking one, moving it through its lifecycle, and the
/// visit summary that ends it.
///
/// ── The status machine is §11.2, not §11.1 ──
///
/// It is the booking machine with one word changed — <c>confirmed</c> where a
/// booking says <c>accepted</c> — and the same two questions are asked
/// separately, in the same order:
///
///  1. <b>Is the move legal?</b> The transition table. An illegal move is a
///     <b>409</b>: the rule is about the appointment.
///  2. <b>Is this person allowed to make it?</b> The actor table. A legal move
///     by the wrong party is a <b>403</b>: the rule is about the person.
///
/// Legality is checked first, deliberately. "You cannot revive a cancelled
/// appointment" is more useful than "you are not allowed to confirm", and the
/// alternative leaks the current status to somebody probing with the wrong verb.
///
/// ── The seam that justifies the architecture ──
///
/// <see cref="CompleteWithSummaryAsync"/> is where vet care becomes a permanent
/// clinical record, and a <c>prescription</c> written there is what unlocks an
/// Rx-only product in M6's store. That is the one path in this build where two
/// modules genuinely depend on each other rather than merely coexisting, so it
/// is one transaction and the record is stamped with the vet profile the access
/// check returned — never one looked up separately.
/// </summary>
public interface IAppointmentService
{
    /// <summary>
    /// One appointment, to either of its two parties. Anyone else gets
    /// <see cref="AppointmentFailure.NotParticipant"/>, which the controller
    /// turns into 404 — ids are sequential, so "no such appointment" and "not
    /// yours" must be indistinguishable.
    /// </summary>
    Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)> GetAsync(
        string callerId, string appointmentId, CancellationToken ct = default);

    /// <summary>The caller's own appointments as the person who booked them.</summary>
    Task<AppointmentPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default);

    /// <summary>
    /// A clinic's schedule. The caller must own the vet profile; null when they
    /// do not.
    /// </summary>
    Task<AppointmentPage?> ListForVetAsync(
        string callerId, string vetId, string? cursor, int limit,
        CancellationToken ct = default);

    /// <summary>The caller's own appointments that overlap a window, soonest first.</summary>
    Task<AppointmentPage> ListMyScheduleAsync(
        string callerId, ScheduleWindow window, string? cursor, int limit,
        CancellationToken ct = default);

    /// <summary>
    /// A clinic's appointments that overlap a window, soonest first. Null
    /// unless the caller owns the vet profile.
    /// </summary>
    Task<AppointmentPage?> ListVetScheduleAsync(
        string callerId, string vetId, ScheduleWindow window, string? cursor, int limit,
        CancellationToken ct = default);

    /// <summary>
    /// The vet moves an appointment to a new time, and the owner is told.
    ///
    /// Only while it is <c>requested</c> or <c>confirmed</c> — once the visit
    /// has started there is nothing left to move (409, checked first). Only the
    /// vet (403): an owner who cannot make the new time cancels. The status
    /// stays as it was, so a confirmed visit is still confirmed at its new
    /// time and the owner keeps the right to cancel. Moving it to the time it
    /// already has is a no-op and tells nobody.
    /// </summary>
    Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)> RescheduleAsync(
        string callerId, string appointmentId, RescheduleAppointmentRequest input,
        CancellationToken ct = default);

    /// <summary>
    /// Book an appointment. The fee is computed here from the vet's own
    /// <c>consultFee</c>; the request has no fee field to ignore.
    /// </summary>
    Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)> CreateAsync(
        string callerId, CreateAppointmentRequest input, CancellationToken ct = default);

    /// <summary>Move an appointment. Legality first, then authority.</summary>
    Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)> UpdateStatusAsync(
        string callerId, string appointmentId, string status,
        CancellationToken ct = default);

    /// <summary>
    /// Complete a visit and write its summary in the same transaction
    /// (REQUIREMENTS.md V7).
    ///
    /// The treating vet only, and only from <c>in_progress</c>. Every record is
    /// stamped with this appointment's id and with the vet profile that granted
    /// clinical access, which is what makes REQUIREMENTS.md V8 structurally
    /// impossible rather than merely checked: there is no path by which a record
    /// can carry an appointment id belonging to a different pet or a different
    /// clinic.
    /// </summary>
    Task<(VisitSummaryResult? Result, AppointmentFailure? Failure)> CompleteWithSummaryAsync(
        string callerId, string appointmentId, VisitSummaryRequest input,
        CancellationToken ct = default);
}
