using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Pets. The rules are all authorization rules, so this is mostly
/// <see cref="IAccessService"/> plus a repository call.
/// </summary>
public sealed class PetService(
    IPetRepository pets,
    IAppointmentRepository appointments,
    IAccessService access,
    IUnitOfWork unitOfWork) : IPetService
{
    public async Task<IReadOnlyList<PetDto>> ListMineAsync(
        string callerId, CancellationToken ct = default)
    {
        var rows = await pets.ListByOwnerAsync(callerId, ct: ct);
        return [.. rows.Select(p => p.ToDto())];
    }

    public async Task<PetDto?> GetAsync(
        string callerId, string petId, CancellationToken ct = default)
    {
        if (!await access.CanViewPetAsync(callerId, petId, ct: ct)) return null;

        var pet = await pets.GetByIdAsync(petId, ct: ct);
        return pet?.ToDto();
    }

    public async Task<IReadOnlyList<PetDto>> GetManyAsync(
        string callerId, IReadOnlyCollection<string> petIds,
        CancellationToken ct = default)
    {
        if (petIds.Count == 0) return [];

        // One predicate call per id. Sequential rather than concurrent on
        // purpose: each opens its own connection when no transaction is in
        // play, and a capped list of 50 fanned out at once is 50 connections
        // from a pool sized for requests, not for one request's internals.
        var allowed = new List<string>(petIds.Count);
        foreach (var id in petIds)
        {
            if (await access.CanViewPetAsync(callerId, id, ct: ct)) allowed.Add(id);
        }

        var rows = await pets.GetManyAsync(allowed, ct: ct);
        return [.. rows.Select(p => p.ToDto())];
    }

    public async Task<PetDto> CreateAsync(
        string callerId, PetInputRequest input, CancellationToken ct = default)
    {
        var now = Ids.Now();
        var entity = new PetEntity
        {
            Id = Ids.New("p"),
            OwnerId = callerId,

            // The honest answer for a pet somebody is entering themselves: this
            // owner has had it since now. The seeded fixtures sit at the epoch
            // instead, which is what grandfathers their existing caretaker and
            // vet grants — see db/petapp.sql's default on this column.
            OwnedSince = now,

            Name = input.Name,
            Species = input.Species,
            Breed = input.Breed,
            Sex = input.Sex,
            Dob = input.Dob,
            WeightLbs = input.WeightLbs,
            PhotoUrl = input.PhotoUrl,
            Vaccinated = input.Vaccinated,
            Allergies = input.Allergies,
            Medications = input.Medications,
            BehaviorNotes = input.BehaviorNotes,
            FeedingInstructions = input.FeedingInstructions,
            VetName = input.VetContact.Name,
            VetPhone = input.VetContact.Phone,
        };

        var created = await pets.CreateAsync(entity, ct: ct);
        return created.ToDto();
    }

    public async Task<(PetDto? Pet, PetFailure? Failure)> UpdateAsync(
        string callerId, string petId, PetPatchRequest patch,
        CancellationToken ct = default)
    {
        // Read and write in one transaction: the ownership check and the UPDATE
        // must see the same row, or an adoption completing between them lets
        // the outgoing owner write to an animal that is no longer theirs.
        await using var scope = await unitOfWork.BeginAsync(ct);

        var existing = await pets.GetByIdAsync(petId, scope, ct);
        if (existing is null) return (null, PetFailure.NotFound);

        if (existing.OwnerId != callerId)
        {
            // A caretaker or treating vet may read this animal, so saying
            // "not yours" tells them nothing they could not already see.
            // Anyone else gets 404 and learns nothing at all.
            var visible = await access.CanViewPetAsync(callerId, petId, scope, ct);
            return (null, visible ? PetFailure.NotOwner : PetFailure.NotFound);
        }

        var updated = await pets.UpdateAsync(petId, ToPatch(patch), scope, ct);
        if (updated is null) return (null, PetFailure.NotFound);

        await scope.CommitAsync(ct);
        return (updated.ToDto(), null);
    }

    /// <summary>
    /// Delete, guarded on clinical history.
    ///
    /// ── Why an owner cannot delete a pet that has any ──
    ///
    /// All three foreign keys pointing at <c>pets</c> are
    /// <c>ON DELETE CASCADE</c>, so the raw DELETE would take the animal's
    /// medical records, its vet appointments and any adoption listing with it.
    /// That directly contradicts the rule this module already enforces one level
    /// down: only a record's <i>author</i> may remove it, because a health
    /// record its subject can rewrite is not a record. An owner who cannot
    /// delete one vet's vaccination note should not be able to delete forty of
    /// them by deleting the patient.
    ///
    /// So deletion is for the case it is actually needed for — a pet entered by
    /// mistake, before anything clinical has attached to it. Anything else is a
    /// 409 that says why.
    ///
    /// <b>Known gap:</b> this leaves no way to retire a pet that has died. That
    /// wants a soft delete (a <c>deletedAt</c> column, filtered from lists and
    /// kept for the records to hang from), which is a schema change and a
    /// decision about what a dead pet's owner should still be able to see. It is
    /// recorded in STATUS.md rather than guessed at here.
    /// </summary>
    public async Task<PetFailure?> DeleteAsync(
        string callerId, string petId, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var existing = await pets.GetByIdAsync(petId, scope, ct);
        if (existing is null) return PetFailure.NotFound;

        if (existing.OwnerId != callerId)
        {
            var visible = await access.CanViewPetAsync(callerId, petId, scope, ct);
            return visible ? PetFailure.NotOwner : PetFailure.NotFound;
        }

        var history = await pets.CountHistoryAsync(petId, scope, ct);
        if (history.Any) return PetFailure.HasHistory;

        var deleted = await pets.DeleteAsync(petId, scope, ct);
        if (!deleted) return PetFailure.NotFound;

        await scope.CommitAsync(ct);
        return null;
    }

    public async Task<IReadOnlyList<AppointmentTimelineDto>?> ListAppointmentsAsync(
        string callerId, string petId, CancellationToken ct = default)
    {
        if (!await access.CanViewPetAsync(callerId, petId, ct: ct)) return null;

        var rows = await appointments.ListForPetAsync(petId, ct: ct);

        // ToDto decides per row whether this caller gets the fee. A vet reading
        // a patient's history sees every visit; they see what the owner paid for
        // none of them.
        return [.. rows.Select(a => a.ToDto(callerId))];
    }

    /// <summary>
    /// The wire shape flattened to the column shape: <c>vetContact</c> is one
    /// nested object on the request and two columns in the table, and a patch
    /// that omits it must leave both alone.
    /// </summary>
    private static PetPatch ToPatch(PetPatchRequest p) => new(
        p.Name, p.Species, p.Breed, p.Sex, p.Dob, p.WeightLbs, p.PhotoUrl,
        p.Vaccinated, p.Allergies, p.Medications, p.BehaviorNotes,
        p.FeedingInstructions, p.VetContact?.Name, p.VetContact?.Phone);
}
