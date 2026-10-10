using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// The health timeline. See <see cref="IMedicalRecordService"/> for the
/// contract; the rule worth reading twice is in <see cref="CreateAsync"/>.
/// </summary>
public sealed class MedicalRecordService(
    IMedicalRecordRepository records,
    IAppointmentRepository appointments,
    IAccessService access,
    IUnitOfWork unitOfWork) : IMedicalRecordService
{
    public async Task<(IReadOnlyList<MedicalRecordDto>? Records, RecordFailure? Failure)>
        ListForPetAsync(string callerId, string petId, CancellationToken ct = default)
    {
        var clinical = await access.CanAccessPetRecordsAsync(callerId, petId, ct: ct);
        if (!clinical.Allowed) return (null, RecordFailure.NoAccess);

        var rows = await records.ListForPetAsync(petId, ct: ct);
        return ([.. rows.Select(r => r.ToDto())], null);
    }

    /// <summary>
    /// Write an entry.
    ///
    /// Two checks, and they are different questions:
    ///
    ///  1. <b>May the caller touch this animal's record at all?</b>
    ///     <see cref="IAccessService.CanAccessPetRecordsAsync"/> answers it, and
    ///     hands back the vet profile id when access came via a qualifying
    ///     appointment. That id is what the record is stamped with — taken from
    ///     the check that granted access, never looked up again and never read
    ///     from the request body, because a client that could name its own
    ///     author could write a prescription as somebody else's vet.
    ///
    ///  2. <b>May they author <i>this type</i>?</b> An owner reaches the first
    ///     check trivially — it is their pet — so without this one an owner
    ///     could write themselves a prescription and unlock Rx-only products in
    ///     the store. Owners get the two self-reported types; everything
    ///     clinical needs a vet.
    ///
    ///  3. <b>Does the cited appointment belong here?</b> REQUIREMENTS.md V8.
    ///     See <see cref="AppointmentBelongsAsync"/>.
    ///
    /// The whole thing runs in one transaction so the access decision and the
    /// INSERT see the same world: an appointment cancelled between them must not
    /// leave a record written on the strength of it.
    /// </summary>
    public async Task<(MedicalRecordDto? Record, RecordFailure? Failure)> CreateAsync(
        string callerId, string petId, MedicalRecordRequest input,
        CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var clinical = await access.CanAccessPetRecordsAsync(callerId, petId, scope, ct);
        if (!clinical.Allowed) return (null, RecordFailure.NoAccess);

        var authoringAsVet = clinical.AsVetId is not null;
        if (!authoringAsVet && !MedicalRecordTypes.OwnerMayAuthor(input.Type))
            return (null, RecordFailure.TypeNotAuthorable);

        if (!await AppointmentBelongsAsync(
                input.AppointmentId, petId, callerId, clinical.AsVetId, scope, ct))
            return (null, RecordFailure.AppointmentMismatch);

        var entity = new MedicalRecordEntity
        {
            Id = Ids.New("mr"),
            PetId = petId,
            AppointmentId = input.AppointmentId,
            VetId = clinical.AsVetId,
            AuthorUserId = callerId,
            Type = input.Type,
            Title = input.Title,
            Details = input.Details ?? "",
            OccurredAt = input.OccurredAt,
            NextDueAt = input.NextDueAt,
            MedicationName = input.MedicationName,
            Dosage = input.Dosage,
            RefillsLeft = input.RefillsLeft,
            ExpiresAt = input.ExpiresAt,
            ProductSlugs = input.ProductSlugs ?? [],
            CreatedAt = Ids.Now(),
        };

        var created = await records.CreateAsync(entity, scope, ct);
        await scope.CommitAsync(ct);

        return (created.ToDto(), null);
    }

    /// <summary>
    /// Whether a cited <c>appointmentId</c> is one this record may hang from
    /// (REQUIREMENTS.md V8).
    ///
    /// The reference implementation accepted whatever id the body carried and
    /// wrote it, so a record could be filed against an unrelated visit — of a
    /// different animal, at a different clinic. The id is a foreign key onto
    /// <c>vet_appointments</c>, so the database only ever checked that
    /// <i>something</i> was there.
    ///
    /// Two rules, depending on who is writing:
    ///
    ///  - <b>a vet</b> may cite an appointment for this pet that is
    ///    <i>theirs</i>. Citing another clinic's visit would attach their
    ///    findings to somebody else's consultation;
    ///  - <b>an owner</b> may cite an appointment for this pet that they
    ///    booked — which is how "my weight reading from Tuesday's visit" files
    ///    itself under Tuesday's visit.
    ///
    /// Both require the appointment to be for <i>this pet</i>, which is the half
    /// the defect was really about. Null cites nothing and is always fine: most
    /// records are not attached to a visit at all.
    /// </summary>
    private async Task<bool> AppointmentBelongsAsync(
        string? appointmentId, string petId, string callerId, string? asVetId,
        ITransactionScope scope, CancellationToken ct)
    {
        if (appointmentId is null) return true;

        var appointment = await appointments.GetByIdAsync(appointmentId, scope, ct);
        if (appointment is null || appointment.PetId != petId) return false;

        return asVetId is not null
            ? appointment.VetId == asVetId
            : appointment.OwnerId == callerId;
    }

    public async Task<RecordFailure?> DeleteAsync(
        string callerId, string recordId, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var record = await records.GetByIdAsync(recordId, scope, ct);
        if (record is null) return RecordFailure.NotFound;

        // Authorship, not ownership. The pet's owner reads this record and
        // cannot remove it; the vet who wrote it can withdraw their own.
        if (record.AuthorUserId != callerId) return RecordFailure.NotAuthor;

        var deleted = await records.DeleteAsync(recordId, scope, ct);
        if (!deleted) return RecordFailure.NotFound;

        await scope.CommitAsync(ct);
        return null;
    }
}
