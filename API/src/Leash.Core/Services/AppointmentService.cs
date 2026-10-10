using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Vet appointments. See <see cref="IAppointmentService"/> for the contract;
/// the two tables below are the whole of the lifecycle, and
/// <see cref="CompleteWithSummaryAsync"/> is the method worth reading twice.
/// </summary>
public sealed class AppointmentService(
    IAppointmentRepository appointments,
    IVetRepository vets,
    IPetRepository pets,
    IMedicalRecordRepository records,
    IAccessService access,
    IReputationService reputation,
    IUnitOfWork unitOfWork) : IAppointmentService
{
    /// <summary>
    /// What may follow what (REQUIREMENTS.md <b>§11.2</b>).
    ///
    /// The booking table with one word changed: <c>confirmed</c> where a
    /// booking says <c>accepted</c>. <c>completed</c>, <c>declined</c> and
    /// <c>cancelled</c> are terminal — they map to empty, which is what makes
    /// "revive a declined appointment" impossible without a special case for it.
    /// </summary>
    private static readonly Dictionary<string, string[]> Transitions = new()
    {
        [AppointmentStatuses.Requested] =
            [AppointmentStatuses.Confirmed, AppointmentStatuses.Declined,
             AppointmentStatuses.Cancelled],
        [AppointmentStatuses.Confirmed] =
            [AppointmentStatuses.InProgress, AppointmentStatuses.Cancelled],
        [AppointmentStatuses.InProgress] =
            [AppointmentStatuses.Completed, AppointmentStatuses.Cancelled],
        [AppointmentStatuses.Completed] = [],
        [AppointmentStatuses.Declined] = [],
        [AppointmentStatuses.Cancelled] = [],
    };

    /// <summary>
    /// Who may drive each transition (REQUIREMENTS.md §11.2, V6).
    ///
    /// Answering a request is the clinic's job, so <c>confirmed</c> and
    /// <c>declined</c> are theirs. So are <c>in_progress</c> and
    /// <c>completed</c>: the vet is the one who knows whether the animal was
    /// actually seen, and <c>completed</c> is what a visit summary hangs from.
    /// Either side may cancel.
    ///
    /// <c>requested</c> maps to nobody, because it is not a transition — it is
    /// where an appointment starts.
    /// </summary>
    private static readonly Dictionary<string, AppointmentActor[]> ActorAllowed = new()
    {
        [AppointmentStatuses.Requested] = [],
        [AppointmentStatuses.Confirmed] = [AppointmentActor.Vet],
        [AppointmentStatuses.Declined] = [AppointmentActor.Vet],
        [AppointmentStatuses.InProgress] = [AppointmentActor.Vet],
        [AppointmentStatuses.Completed] = [AppointmentActor.Vet],
        [AppointmentStatuses.Cancelled] = [AppointmentActor.Owner, AppointmentActor.Vet],
    };

    public async Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)>
        GetAsync(string callerId, string appointmentId, CancellationToken ct = default)
    {
        // M2's predicate, written for this milestone and unused until now. It
        // resolves the vet profile to its user, which is the step that makes
        // "is this my appointment?" answerable at all.
        if (!await access.IsAppointmentParticipantAsync(callerId, appointmentId, ct: ct))
            return (null, AppointmentFailure.NotParticipant);

        var appointment = await appointments.GetByIdAsync(appointmentId, ct: ct);
        return appointment is null
            ? (null, AppointmentFailure.NotFound)
            : (appointment.ToDto(), null);
    }

    public async Task<AppointmentPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default)
    {
        var (rows, next) = await appointments.ListByOwnerAsync(callerId, cursor, limit, ct: ct);
        return new AppointmentPage([.. rows.Select(a => a.ToDto())], next);
    }

    public async Task<AppointmentPage?> ListForVetAsync(
        string callerId, string vetId, string? cursor, int limit,
        CancellationToken ct = default)
    {
        // A clinic's schedule is the clinic's. Without this, any signed-in user
        // could read who is taking which animal to which vet and when.
        if (!await access.OwnsVetProfileAsync(callerId, vetId, ct: ct)) return null;

        var (rows, next) = await appointments.ListByVetAsync(vetId, cursor, limit, ct: ct);
        return new AppointmentPage([.. rows.Select(a => a.ToDto())], next);
    }

    /// <summary>
    /// Book an appointment.
    ///
    /// ── Three things the client does not get to say ──
    ///
    /// <b>The owner</b> comes from the authenticated caller, never from the
    /// body. That identity selects a <i>price</i> once M7 lands, so a route
    /// that took it from the request would be handing out members' discounts.
    ///
    /// <b>The fee</b> is read from the vet's own profile and recorded as three
    /// numbers — what the clinic lists, what was taken off, and what was
    /// actually quoted (REQUIREMENTS.md V4). A membership that lapses next month
    /// must not rewrite what somebody was told last week.
    ///
    /// <b>The pet</b> is checked against the caller, which the reference
    /// implementation did not do. An appointment is <i>how</i> a vet earns
    /// <c>CanAccessPetRecords</c> — the predicate grants on exactly this row —
    /// so an unchecked <c>petId</c> would let anyone hand any animal's clinical
    /// file, and the right to write prescriptions against it, to any clinic by
    /// naming it in a request.
    /// </summary>
    public async Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)>
        CreateAsync(string callerId, CreateAppointmentRequest input,
            CancellationToken ct = default)
    {
        if (input.EndDateTime <= input.StartDateTime)
            return (null, AppointmentFailure.BadDates);

        // REQUIREMENTS.md C13. See LeadTime for why the member arm is
        // hard-coded false until M7 brings entitlements — and note that the
        // same falsehood decides `priority` below, so the recorded flag and the
        // rule that was actually applied cannot disagree.
        const bool member = false;
        if (!LeadTime.IsMet(input.StartDateTime, Ids.Now(), member))
            return (null, AppointmentFailure.LeadTime);

        await using var scope = await unitOfWork.BeginAsync(ct);

        if (!await access.OwnsPetAsync(callerId, input.PetId, scope, ct))
            return (null, AppointmentFailure.NotYourPet);

        var vet = await vets.GetByIdAsync(input.VetId, scope, ct);
        if (vet is null) return (null, AppointmentFailure.VetNotFound);

        var pet = await pets.GetByIdAsync(input.PetId, scope, ct);
        if (pet is null) return (null, AppointmentFailure.NotYourPet);

        // Both are refusals about the clinic rather than about the request, so
        // both are 409 rather than 400: "we do not treat rabbits" is not a
        // malformed booking.
        if (!vet.AcceptedSpecies.Contains(pet.Species))
            return (null, AppointmentFailure.SpeciesNotAccepted);

        if (!vet.ConsultModes.Contains(input.Mode))
            return (null, AppointmentFailure.ModeNotOffered);

        // M7 replaces the zero with the plan's vet_consult_discount when the
        // caller holds one (REQUIREMENTS.md V5).
        var (baseFeeCents, discountPct, feeCents) = ConsultFee(vet.ConsultFeeCents, 0);

        var appointment = new VetAppointmentEntity
        {
            Id = Ids.New("a"),
            OwnerId = callerId,
            VetId = input.VetId,
            PetId = input.PetId,
            Mode = input.Mode,
            Reason = input.Reason,
            Symptoms = input.Symptoms ?? [],
            StartDateTime = input.StartDateTime,
            EndDateTime = input.EndDateTime,
            Status = AppointmentStatuses.Requested,
            Notes = input.Notes ?? "",
            CreatedAt = Ids.Now(),
            BaseFeeCents = baseFeeCents,
            DiscountPct = discountPct,
            Priority = member,
            FeeCents = feeCents,
        };

        var created = await appointments.CreateAsync(appointment, scope, ct);

        // A new request is one more thing left unanswered until the clinic replies.
        await reputation.RefreshVetResponseRateAsync(created.VetId, scope, ct);

        await scope.CommitAsync(ct);
        return (created.ToDto(), null);
    }

    /// <summary>
    /// Move an appointment.
    ///
    /// Legality first, then authority — and the order is deliberate. An illegal
    /// move reports as illegal even when the caller would have been entitled to
    /// a legal one, because "you cannot revive a cancelled appointment" is more
    /// useful than "you are not allowed to confirm", and because the alternative
    /// leaks the current status to someone probing with the wrong verb.
    ///
    /// A no-op (same status in, same status out) is allowed and changes nothing
    /// — a double-tapped Confirm button is not an error.
    /// </summary>
    public async Task<(AppointmentTimelineDto? Appointment, AppointmentFailure? Failure)>
        UpdateStatusAsync(string callerId, string appointmentId, string status,
            CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var appointment = await appointments.GetByIdAsync(appointmentId, scope, ct);
        if (appointment is null) return (null, AppointmentFailure.NotFound);

        var actor = await ActorFor(callerId, appointment, scope, ct);
        if (actor is null) return (null, AppointmentFailure.NotParticipant);

        var from = appointment.Status;
        if (from == status) return (appointment.ToDto(), null);

        if (!Transitions.TryGetValue(from, out var allowed) || !allowed.Contains(status))
            return (null, AppointmentFailure.InvalidTransition);

        if (!ActorAllowed[status].Contains(actor.Value))
            return (null, AppointmentFailure.WrongActor);

        var updated = await appointments.UpdateStatusAsync(appointmentId, status, scope, ct);
        if (updated is null) return (null, AppointmentFailure.NotFound);

        await reputation.RefreshVetResponseRateAsync(updated.VetId, scope, ct);

        await scope.CommitAsync(ct);
        return (updated.ToDto(), null);
    }

    /// <summary>
    /// Complete a visit and write its summary (REQUIREMENTS.md V7).
    ///
    /// <b>This is the seam the whole architecture exists for.</b> Vet care
    /// becomes a permanent clinical record here, and a <c>prescription</c>
    /// written on this path is what authorises an Rx-only product in M6's store.
    /// Everything below is in service of that not being forgeable.
    ///
    /// ── Why the vet profile id comes from the access check ──
    ///
    /// <see cref="IAccessService.CanAccessPetRecordsAsync"/> returns the profile
    /// it granted access <i>as</i>, and that is the id stamped on every record.
    /// It is never looked up separately and never read from the request body: a
    /// caller who could name their own <c>vetId</c> could write a prescription
    /// as somebody else's clinic, and the store would honour it.
    ///
    /// ── Why REQUIREMENTS.md V8 cannot happen here ──
    ///
    /// The defect V8 names is a record stamped with an unrelated appointment's
    /// id. On this path the appointment is the subject of the call, so the id is
    /// not something a client supplies — any <c>appointmentId</c> in the body is
    /// overwritten with this one, and the pet comes from the appointment row
    /// rather than the request. There is no combination of inputs that produces
    /// a mismatch. (<see cref="MedicalRecordService.CreateAsync"/> reaches the
    /// same guarantee the other way, by checking.)
    ///
    /// ── One transaction ──
    ///
    /// The access decision, every record, and the status move all commit
    /// together. A visit that ended up <c>completed</c> with half its notes
    /// written would be a clinical record that lies by omission, and an
    /// appointment cancelled between the check and the INSERT must not leave a
    /// prescription written on the strength of it.
    /// </summary>
    public async Task<(VisitSummaryResult? Result, AppointmentFailure? Failure)>
        CompleteWithSummaryAsync(string callerId, string appointmentId,
            VisitSummaryRequest input, CancellationToken ct = default)
    {
        if (input.Records.Length == 0) return (null, AppointmentFailure.BadSummary);

        if (input.Records.Any(r => !MedicalRecordTypes.IsValid(r.Type)))
            return (null, AppointmentFailure.BadSummary);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var appointment = await appointments.GetByIdAsync(appointmentId, scope, ct);
        if (appointment is null) return (null, AppointmentFailure.NotFound);

        var actor = await ActorFor(callerId, appointment, scope, ct);
        if (actor is null) return (null, AppointmentFailure.NotParticipant);

        // Legality before authority, as in UpdateStatusAsync: a summary is a
        // move to `completed`, and the only state that move is legal from is
        // `in_progress`.
        if (appointment.Status != AppointmentStatuses.InProgress)
            return (null, AppointmentFailure.NotInProgress);

        if (actor != AppointmentActor.Vet) return (null, AppointmentFailure.NotTheVet);

        var clinical = await access.CanAccessPetRecordsAsync(
            callerId, appointment.PetId, scope, ct);

        // Belt and braces, and the belt is load-bearing. The caller owning this
        // appointment's vet profile should imply AsVetId is that profile —
        // `vet_profiles."userId"` is unique — but this is the id that ends up
        // stamped on a prescription, so the invariant is asserted rather than
        // assumed. A mismatch refuses; it never falls back to a lookup.
        if (clinical.AsVetId is null || clinical.AsVetId != appointment.VetId)
            return (null, AppointmentFailure.NotTheVet);

        var written = new List<MedicalRecordDto>(input.Records.Length);
        foreach (var record in input.Records)
        {
            var entity = new MedicalRecordEntity
            {
                Id = Ids.New("mr"),

                // From the appointment, not the request. This is V8.
                PetId = appointment.PetId,
                AppointmentId = appointment.Id,
                VetId = clinical.AsVetId,

                AuthorUserId = callerId,
                Type = record.Type,
                Title = record.Title,
                Details = record.Details ?? "",

                // A vet writing up a visit is writing up *this* visit, so an
                // omitted date means when it ended rather than "now".
                OccurredAt = record.OccurredAt == default
                    ? appointment.EndDateTime
                    : record.OccurredAt,

                NextDueAt = record.NextDueAt,
                MedicationName = record.MedicationName,
                Dosage = record.Dosage,
                RefillsLeft = record.RefillsLeft,
                ExpiresAt = record.ExpiresAt,
                ProductSlugs = record.ProductSlugs ?? [],
                CreatedAt = Ids.Now(),
            };

            written.Add((await records.CreateAsync(entity, scope, ct)).ToDto());
        }

        var completed = await appointments.UpdateStatusAsync(
            appointment.Id, AppointmentStatuses.Completed, scope, ct);

        if (completed is null) return (null, AppointmentFailure.NotFound);

        await reputation.RefreshVetResponseRateAsync(completed.VetId, scope, ct);

        await scope.CommitAsync(ct);
        return (new VisitSummaryResult(completed.ToDto(), [.. written]), null);
    }

    /// <summary>
    /// Which side of this appointment the caller is on, or null if neither.
    ///
    /// The vet side is a <i>profile</i> id, so it resolves through the profile
    /// to its user — comparing <c>callerId</c> to <c>appointment.VetId</c>
    /// directly would answer "no" to every clinician who ever lived.
    /// </summary>
    private async Task<AppointmentActor?> ActorFor(
        string callerId, VetAppointmentEntity appointment,
        ITransactionScope scope, CancellationToken ct)
    {
        if (appointment.OwnerId == callerId) return AppointmentActor.Owner;

        return await access.OwnsVetProfileAsync(callerId, appointment.VetId, scope, ct)
            ? AppointmentActor.Vet
            : null;
    }

    /// <summary>
    /// What a consultation costs, in integer cents, from the clinic's list fee
    /// and the member discount (REQUIREMENTS.md V4/V5).
    ///
    /// All three numbers come back because all three are recorded. The discount
    /// is clamped to 0–100 rather than trusted: a negative one would be a
    /// surcharge nobody agreed to, and one over a hundred would pay the customer
    /// to attend.
    ///
    /// Integer arithmetic throughout. The reference implementation worked in
    /// float USD and rounded at the end — <c>Math.round(baseFee * (100 - pct)) /
    /// 100</c> — which is the arithmetic that puts <c>$89.60000000000001</c> on
    /// a receipt. Cents times a whole percentage divided by a hundred rounds
    /// once, here, and the result is exact from then on.
    /// </summary>
    public static (int BaseFeeCents, int DiscountPct, int FeeCents) ConsultFee(
        int listFeeCents, int discountPct)
    {
        var pct = Math.Clamp(discountPct, 0, 100);

        var feeCents = (int)Math.Round(
            listFeeCents * (100 - pct) / 100m, MidpointRounding.AwayFromZero);

        return (listFeeCents, pct, feeCents);
    }
}
