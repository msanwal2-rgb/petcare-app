using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Completing an adoption: the moment an animal changes hands. See
/// <see cref="IAdoptionTransferService"/>.
///
/// <b>This is the only service that moves <c>pets."ownerId"</c></b>, and it
/// does so only through <see cref="IAdoptionRepository.TransferPetAsync"/> —
/// the pet PATCH has no owner field. Moving an animal is not a field edit: it
/// ends one household's access to a health record, begins another's, and takes
/// money on the way.
///
/// ── Three phases, as in the reference ──
///
/// <b>0. Preconditions</b>, all reads, outside any transaction. Two concurrent
/// completions can both pass them — which is fine, because phase 1 is
/// conditional. A forced completion cancels the live engagements here, each
/// through its own status machine, so the caretaker or clinic is told rather
/// than finding a silent UPDATE.
///
/// <b>1. The transfer</b>, one transaction: the conditional move of
/// <c>ownerId</c> and <c>ownedSince</c> together, the listing adopted, the
/// application completed, every rival closed, and every notice written.
///
/// <b>2.</b> Nothing. The reference notified after its commit; here the notices
/// commit with the move (N1), so there is no window in which an adoption
/// happened and nobody was told.
/// </summary>
public sealed class AdoptionTransferService(
    IAdoptionRepository adoptions,
    IShelterRepository shelters,
    IPetRepository pets,
    IPaymentRepository payments,
    IBookingService bookings,
    IAppointmentService appointments,
    IReputationService reputation,
    INotifier notifier,
    StaffGate gate,
    IAuditLog audit,
    IUnitOfWork unitOfWork) : IAdoptionTransferService
{
    /// <summary>Engagements that would straddle the transfer if it were let through.</summary>
    private static readonly string[] LiveBookings =
        [BookingStatuses.Requested, BookingStatuses.Accepted, BookingStatuses.InProgress];

    private static readonly string[] LiveAppointments =
        [AppointmentStatuses.Requested, AppointmentStatuses.Confirmed, AppointmentStatuses.InProgress];

    public async Task<(CompletedAdoptionDto? Result, AdoptionRefusal? Refusal)> CompleteAsync(
        string callerId, string applicationId, bool force, CancellationToken ct = default)
    {
        // ── Phase 0: preconditions ──────────────────────────────────────

        var application = await adoptions.GetApplicationAsync(applicationId, ct: ct);
        if (application is null) return (null, AdoptionFailure.NotFound);

        var shelter = await shelters.GetByIdAsync(application.ShelterId, ct: ct);
        if (shelter is null) return (null, AdoptionFailure.NotFound);

        // The shelter records the handover, because the shelter is who hands
        // over. The applicant pays; that is a different endpoint.
        if (shelter.UserId != callerId) return (null, AdoptionFailure.NotShelter);

        if (application.Status != ApplicationStatuses.Approved)
            return (null, new AdoptionRefusal(AdoptionFailure.InvalidTransition) { From = application.Status });

        var pet = await pets.GetByIdAsync(application.PetId, ct: ct);
        if (pet is null) return (null, AdoptionFailure.NotFound);

        // Also the idempotency guard: a double-submit finds the animal already
        // moved and refuses, rather than re-severing a household that has
        // settled in.
        if (pet.OwnerId != shelter.UserId) return (null, AdoptionFailure.NotShelterOwned);

        if (application.FeeCents > 0)
        {
            var payment = await payments.GetForAdoptionAsync(applicationId, ct: ct);
            if (payment?.Status != PaymentStatuses.Paid)
                return (null, new AdoptionRefusal(AdoptionFailure.FeeUnpaid) { PaymentStatus = payment?.Status });
        }

        var (bookingIds, appointmentIds) = await adoptions.ListLiveEngagementsAsync(
            pet.Id, LiveBookings, LiveAppointments, ct: ct);

        if (bookingIds.Length + appointmentIds.Length > 0)
        {
            var inTheWay = new AdoptionRefusal(AdoptionFailure.LiveEngagements)
            {
                BookingIds = bookingIds,
                AppointmentIds = appointmentIds,
            };

            // Refusing is the default: the alternative cancels somebody's
            // arrangement — a sitter with the animal in their house — from a
            // flow they are not party to. The ids go back so the UI can name
            // what is in the way, and the shelter decides (R7).
            if (!force) return (null, inTheWay);

            // Forced: through each machine, as the shelter — the owner of
            // record, so the owner's "cancel" is the legal move. Each writes
            // its own notice to the other party.
            foreach (var id in bookingIds)
            {
                var (_, failure) = await bookings.UpdateStatusAsync(callerId, id, BookingStatuses.Cancelled, ct);
                if (failure is not null) return (null, inTheWay);
            }
            foreach (var id in appointmentIds)
            {
                var (_, failure) = await appointments.UpdateStatusAsync(callerId, id, AppointmentStatuses.Cancelled, ct);
                if (failure is not null) return (null, inTheWay);
            }
        }

        // ── Phase 1: the transfer ───────────────────────────────────────

        await using var scope = await unitOfWork.BeginAsync(ct);
        var now = Ids.Now();

        // The whole feature, in one statement. Exactly one concurrent caller
        // matches the row; the other is told the shelter no longer owns it.
        if (!await adoptions.TransferPetAsync(pet.Id, shelter.UserId, application.ApplicantId, now, scope, ct))
            return (null, AdoptionFailure.NotShelterOwned);

        var listing = await adoptions.GetListingAsync(application.ListingId, scope, forUpdate: true, ct: ct);
        if (listing is not null && listing.Status != ListingStatuses.Adopted)
        {
            await adoptions.SetListingStatusAsync(
                listing.Id, listing.Status, ListingStatuses.Adopted, now, scope, ct);
        }

        await adoptions.CompleteApplicationAsync(applicationId, now, scope, ct);

        // Everyone else who applied hears now, rather than refreshing a
        // listing that will never come back.
        var closed = await adoptions.CloseRivalsAsync(
            application.ListingId, applicationId, $"{application.PetName} has been adopted.", now, scope, ct);

        await reputation.RefreshShelterResponseRateAsync(shelter.Id, scope, ct);

        await notifier.NotifyAsync(application.ApplicantId,
            Notices.AdoptionCompleted(pet.Id, application.PetName, shelter.Name), scope, ct);
        foreach (var applicantId in closed)
            await notifier.NotifyAsync(applicantId, Notices.AdoptionClosed(application.PetName), scope, ct);

        var completed = await adoptions.GetApplicationAsync(applicationId, scope, ct: ct);
        var moved = await pets.GetByIdAsync(pet.Id, scope, ct);

        await scope.CommitAsync(ct);
        return (new CompletedAdoptionDto(completed!.ToDto(), moved!.ToDto()), null);
    }

    /// <summary>
    /// Adoptions fall through — the dog is frightened of the baby, the allergy
    /// turns out to be real. Without this the only tool would be an ownership
    /// backdoor somebody reopened by hand in production.
    ///
    /// It severs in the other direction for free: the adopter's caretakers and
    /// vets lose access on the same write, because the mechanism has never
    /// cared which way an animal moves.
    /// </summary>
    public async Task<(ReversedAdoptionDto? Result, AdminRefusal? Refusal)> ReverseAsync(
        StaffActor actor, string applicationId, string reason, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Support, ct) is { } refusal) return (null, refusal);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var application = await adoptions.GetApplicationAsync(applicationId, scope, forUpdate: true, ct: ct);
        if (application is null)
            return (null, new AdminRefusal(AdminFailure.NotFound, $"Application {applicationId} not found"));

        if (application.Status != ApplicationStatuses.Completed)
            return (null, new AdminRefusal(AdminFailure.Conflict, "That adoption was never completed"));

        var shelter = await shelters.GetByIdAsync(application.ShelterId, scope, ct);
        if (shelter is null)
            return (null, new AdminRefusal(AdminFailure.NotFound, "The shelter no longer exists"));

        var now = Ids.Now();

        // The same statement as the transfer, the other way round.
        if (!await adoptions.TransferPetAsync(application.PetId, application.ApplicantId, shelter.UserId, now, scope, ct))
        {
            return (null, new AdminRefusal(AdminFailure.Conflict,
                "The adopter no longer owns that animal, so there is nothing to put back"));
        }

        var listing = await adoptions.GetListingAsync(application.ListingId, scope, forUpdate: true, ct: ct);
        if (listing is not null && listing.Status != ListingStatuses.Available)
        {
            await adoptions.SetListingStatusAsync(
                listing.Id, listing.Status, ListingStatuses.Available, now, scope, ct);
        }

        await adoptions.ReverseApplicationAsync(applicationId, reason, now, scope, ct);

        var pet = (await pets.GetByIdAsync(application.PetId, scope, ct))!;

        await audit.RecordAsync(actor, "adoption.reverse", "adoption_application", applicationId,
            $"Returned {pet.Name} to the shelter", new { reason, petId = pet.Id }, scope, ct);

        await notifier.NotifyAsync(application.ApplicantId,
            Notices.AdoptionReversed(application.PetName, shelter.Name, reason), scope, ct);

        await scope.CommitAsync(ct);
        return (new ReversedAdoptionDto(pet.ToDto()), null);
    }
}
