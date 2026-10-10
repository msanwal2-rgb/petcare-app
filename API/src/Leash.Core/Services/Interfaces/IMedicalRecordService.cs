using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>Why a health-record operation was refused.</summary>
public enum RecordFailure
{
    /// <summary>No such pet or record. 404.</summary>
    NotFound,

    /// <summary>The caller has no clinical access to this animal. 403.</summary>
    NoAccess,

    /// <summary>
    /// The caller has access but may not author <i>this type</i> — an owner
    /// reaching for a clinical entry type. 403, with a message naming what they
    /// can add.
    /// </summary>
    TypeNotAuthorable,

    /// <summary>The caller did not write this record, so may not remove it. 403.</summary>
    NotAuthor,

    /// <summary>
    /// The record cites an <c>appointmentId</c> that is not this pet's, or not
    /// the author's (REQUIREMENTS.md V8). 400 — the request is understood and
    /// the caller may well have access; the two ids simply do not go together.
    /// </summary>
    AppointmentMismatch,
}

/// <summary>
/// A pet's health timeline.
///
/// A record is the durable output of veterinary care, and <b>the store reads
/// it</b>: an unexpired <c>prescription</c> is what authorises an Rx-only
/// product. That is why authorship is constrained here rather than in the UI —
/// a prescription written by the patient's owner would defeat the entire gate.
/// </summary>
public interface IMedicalRecordService
{
    /// <summary>
    /// The pet's timeline, newest first. Owner or treating vet; a caretaker
    /// with a booking may see the pet but not its clinical history.
    /// </summary>
    Task<(IReadOnlyList<MedicalRecordDto>? Records, RecordFailure? Failure)> ListForPetAsync(
        string callerId, string petId, CancellationToken ct = default);

    /// <summary>
    /// Write an entry. A treating vet may write any type and the record is
    /// stamped with their vet profile; an owner may write only the
    /// self-reported types, with no vet attached.
    /// </summary>
    Task<(MedicalRecordDto? Record, RecordFailure? Failure)> CreateAsync(
        string callerId, string petId, MedicalRecordRequest input,
        CancellationToken ct = default);

    /// <summary>
    /// Withdraw an entry. <b>Author only.</b> A pet's owner can read their
    /// animal's whole history but cannot delete what a vet wrote about it — a
    /// health record its subject can rewrite is not a record.
    /// </summary>
    Task<RecordFailure?> DeleteAsync(
        string callerId, string recordId, CancellationToken ct = default);
}
