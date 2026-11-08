using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/appointments.test.ts</c>, plus the vet half of
/// <c>tests/reputation.test.ts</c> and the visit-summary path the reference has
/// no suite for.
///
/// The block that matters is "who may move an appointment". As with bookings,
/// the reference implementation's own code checked both tables — but its status
/// machine is <b>REQUIREMENTS.md §11.2, not §11.1</b>: an appointment is
/// <c>confirmed</c> where a booking is <c>accepted</c>, and a test that copied
/// the booking suite would pass for the wrong reason on every no-op.
///
/// ── Three deliberate departures from the reference suite ──
///
///  1. <b>Its fixtures book July 2026, which is now the past.</b> Lead time is
///     enforced (REQUIREMENTS.md C13), so creation tests use dates relative to
///     the clock rather than literals that rot.
///  2. <b>There is no actor-less path.</b> The reference passes the actor in as
///     an argument, so its suite can say "as a vet" about an appointment the
///     caller has nothing to do with. Here the actor is <i>derived</i> from the
///     caller, which is the only version that is safe over HTTP — so each test
///     names a real user and the wrong one is refused as a non-participant.
///  3. <b>The pet is checked against the caller.</b> The reference never did,
///     and an appointment is how a vet earns record access.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AppointmentServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Owner = "u1";        // owns p1 (dog) and p2 (cat); a3, a4, a8
    private const string VetUser = "u17";     // vet profile v1
    private const string Vet = "v1";
    private const string Stranger = "u2";     // owns p3

    private CoreHost _core = null!;
    private IAppointmentService _appointments = null!;
    private IMedicalRecordService _records = null!;
    private IReviewService _reviews = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();

        // The seed publishes July 2026 only. Open v1 and v2 all day so the cases
        // about something else are not refused for availability (STATUS §3-G).
        await Calendars.OpenVetAsync(db.ConnectionString, Vet);
        await Calendars.OpenVetAsync(db.ConnectionString, "v2");

        _core = new CoreHost(db.ConnectionString);
        _appointments = _core.Get<IAppointmentService>();
        _records = _core.Get<IMedicalRecordService>();
        _reviews = _core.Get<IReviewService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    /// <summary>
    /// A request comfortably clear of the 24-hour lead time, at 10:00 UTC —
    /// a whole visit inside one published day, never straddling midnight.
    /// </summary>
    private static CreateAppointmentRequest NewAppointment() => new(
        VetId: Vet,
        PetId: "p1",
        Mode: ConsultModes.InClinic,
        Reason: "Limping after a long walk",
        Symptoms: ["Limping"],
        StartDateTime: Calendars.DaysAhead(3, hour: 10),
        EndDateTime: Calendars.DaysAhead(3, hour: 10, minute: 30),
        Notes: "");

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_an_owners_appointments_newest_first()
    {
        var page = await _appointments.ListMineAsync(Owner, null, 24);

        Assert.Equal(3, page.Items.Length);
        for (var i = 1; i < page.Items.Length; i++)
            Assert.True(page.Items[i - 1].StartDateTime >= page.Items[i].StartDateTime);
    }

    [Fact]
    public async Task Returns_an_empty_page_for_somebody_with_no_appointments()
    {
        // u7 is a caretaker. They hold bookings, not consultations.
        Assert.Empty((await _appointments.ListMineAsync("u7", null, 24)).Items);
    }

    [Fact]
    public async Task Lists_a_clinics_schedule_to_the_clinic()
    {
        var page = await _appointments.ListForVetAsync(VetUser, Vet, null, 24);

        Assert.NotNull(page);
        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, a => Assert.Equal(Vet, a.VetId));
    }

    [Fact]
    public async Task Refuses_a_clinics_schedule_to_anybody_else()
    {
        // Otherwise any signed-in user could read which animals are being taken
        // where and when — which is a list of empty houses as much as a diary.
        Assert.Null(await _appointments.ListForVetAsync(Owner, Vet, null, 24));
        Assert.Null(await _appointments.ListForVetAsync(Stranger, Vet, null, 24));
    }

    [Fact]
    public async Task Gets_an_appointment_for_either_party()
    {
        var (asOwner, _) = await _appointments.GetAsync(Owner, "a3");
        Assert.Equal(AppointmentStatuses.Confirmed, asOwner!.Status);
        Assert.Equal("p1", asOwner.PetId);

        var (asVet, _) = await _appointments.GetAsync(VetUser, "a3");
        Assert.NotNull(asVet);
    }

    [Fact]
    public async Task Both_parties_see_what_the_visit_cost()
    {
        // The owner pays it and the vet charges it, so the fee is on the
        // appointment resource for both. It is the *pet timeline* that hides it
        // from a reader who did not book the visit.
        var (asOwner, _) = await _appointments.GetAsync(Owner, "a3");
        var (asVet, _) = await _appointments.GetAsync(VetUser, "a3");

        Assert.Equal(85m, asOwner!.Fee);
        Assert.Equal(85m, asVet!.Fee);
    }

    [Fact]
    public async Task Hides_an_appointment_from_everybody_else()
    {
        var (appointment, failure) = await _appointments.GetAsync(Stranger, "a3");

        Assert.Null(appointment);
        Assert.Equal(AppointmentFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Reports_not_participant_for_an_unknown_appointment()
    {
        // Indistinguishable from one that exists and is not yours, which is the
        // point: ids are sequential.
        var (_, failure) = await _appointments.GetAsync(Owner, "ghost");
        Assert.Equal(AppointmentFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Pages_through_an_owners_appointments_without_repeating_or_skipping()
    {
        var all = (await _appointments.ListMineAsync(Owner, null, 100)).Items;
        Assert.True(all.Length >= 3, "fixture needs at least three appointments for u1");

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _appointments.ListMineAsync(Owner, cursor, 1);
            seen.AddRange(page.Items.Select(a => a.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        // Same rows, same order, one at a time. The (startDateTime, id)
        // tie-break is what makes this hold.
        Assert.Equal(all.Select(a => a.Id), seen);
        Assert.Equal(seen.Distinct(), seen);
    }

    // ── Creation, and the fee ────────────────────────────────────────────

    [Fact]
    public async Task Creates_an_appointment_in_the_requested_state()
    {
        var (appointment, failure) = await _appointments.CreateAsync(Owner, NewAppointment());

        Assert.Null(failure);
        Assert.StartsWith("a_", appointment!.Id);
        Assert.Equal(AppointmentStatuses.Requested, appointment.Status);
        Assert.NotEqual(default, appointment.CreatedAt);
    }

    [Fact]
    public async Task Takes_the_fee_from_the_vets_profile_not_the_request()
    {
        // v2 charges $140; the request body has no fee field that could have
        // said otherwise.
        var (appointment, _) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { VetId = "v2" });

        Assert.Equal(140m, appointment!.Fee);
    }

    [Fact]
    public async Task Records_all_three_money_columns()
    {
        // REQUIREMENTS.md V4. With no membership the discount is zero and the
        // quoted fee equals the list fee — but all three are written, because
        // M7 needs somewhere to put the other two and a receipt needs to
        // survive a membership lapsing.
        var (appointment, _) = await _appointments.CreateAsync(Owner, NewAppointment());

        var row = await MoneyRowAsync(appointment!.Id);

        Assert.Equal(8500, row.BaseFeeCents);
        Assert.Equal(0, row.DiscountPct);
        Assert.Equal(8500, row.FeeCents);
        Assert.False(row.Priority);
    }

    [Fact]
    public async Task Refuses_an_unknown_vet()
    {
        var (_, failure) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { VetId = "ghost" });

        Assert.Equal(AppointmentFailure.VetNotFound, failure);
    }

    [Fact]
    public async Task Refuses_an_unknown_pet()
    {
        // Reported as "not your pet" rather than "no such pet", so a caller
        // cannot use this route to find out which ids exist.
        var (_, failure) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { PetId = "ghost" });

        Assert.Equal(AppointmentFailure.NotYourPet, failure);
    }

    [Fact]
    public async Task Refuses_an_appointment_for_somebody_elses_pet()
    {
        // The check the reference implementation has no counterpart for. An
        // appointment is *how* a vet earns CanAccessPetRecords, so an unchecked
        // petId hands any animal's clinical file — and the right to write
        // prescriptions against it — to any clinic that is named in a request.
        var (_, failure) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { PetId = "p3" });

        Assert.Equal(AppointmentFailure.NotYourPet, failure);
    }

    [Fact]
    public async Task A_refused_appointment_grants_no_record_access()
    {
        // The consequence of the test above, stated as the thing that actually
        // matters. v1's clinician must not be able to read p3's history because
        // somebody tried to book them for it.
        await _appointments.CreateAsync(Owner, NewAppointment() with { PetId = "p3" });

        var (list, failure) = await _records.ListForPetAsync(VetUser, "p3");

        Assert.Null(list);
        Assert.Equal(RecordFailure.NoAccess, failure);
    }

    [Fact]
    public async Task Refuses_a_species_the_vet_does_not_treat()
    {
        // p7 (Ziggy) is a rabbit — species "other". v1 accepts dogs and cats.
        var (_, failure) = await _appointments.CreateAsync(
            "u5", NewAppointment() with { PetId = "p7" });

        Assert.Equal(AppointmentFailure.SpeciesNotAccepted, failure);
    }

    [Fact]
    public async Task Refuses_a_consult_mode_the_vet_does_not_offer()
    {
        // v1 offers in_clinic and video, not home visits.
        var (_, failure) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { Mode = ConsultModes.HomeVisit });

        Assert.Equal(AppointmentFailure.ModeNotOffered, failure);
    }

    [Fact]
    public async Task Refuses_an_appointment_that_ends_before_it_starts()
    {
        var (_, failure) = await _appointments.CreateAsync(
            Owner,
            NewAppointment() with
            {
                StartDateTime = DateTimeOffset.UtcNow.AddDays(3).AddHours(1),
                EndDateTime = DateTimeOffset.UtcNow.AddDays(3),
            });

        Assert.Equal(AppointmentFailure.BadDates, failure);
    }

    [Fact]
    public async Task Refuses_an_appointment_that_does_not_clear_the_lead_time()
    {
        // REQUIREMENTS.md C13, shared with bookings: same-day slots are a Leash
        // Plus benefit, so a standard customer books a day ahead.
        var (_, failure) = await _appointments.CreateAsync(
            Owner,
            NewAppointment() with
            {
                StartDateTime = DateTimeOffset.UtcNow.AddHours(2),
                EndDateTime = DateTimeOffset.UtcNow.AddHours(3),
            });

        Assert.Equal(AppointmentFailure.LeadTime, failure);
    }

    [Fact]
    public async Task A_refused_appointment_writes_nothing()
    {
        var before = (await _appointments.ListMineAsync(Owner, null, 100)).Items.Length;

        await _appointments.CreateAsync(Owner, NewAppointment() with { PetId = "p3" });

        Assert.Equal(
            before, (await _appointments.ListMineAsync(Owner, null, 100)).Items.Length);
    }

    // ── The published calendar (STATUS §3-G) ─────────────────────────────

    [Fact]
    public async Task Refuses_an_appointment_when_the_vet_has_published_nothing()
    {
        await Calendars.CloseVetAsync(db.ConnectionString, Vet);
        var before = (await _appointments.ListMineAsync(Owner, null, 100)).Items.Length;

        var (appointment, failure) = await _appointments.CreateAsync(Owner, NewAppointment());

        Assert.Null(appointment);
        Assert.Equal(AppointmentFailure.NotAvailable, failure);
        Assert.Equal(
            before, (await _appointments.ListMineAsync(Owner, null, 100)).Items.Length);
    }

    [Fact]
    public async Task Refuses_a_visit_that_is_not_inside_one_published_set()
    {
        var day = DateOnly.FromDateTime(Calendars.DaysAhead(3, 0).UtcDateTime);
        await Calendars.CloseVetAsync(db.ConnectionString, Vet);
        await Calendars.SetVetDayAsync(db.ConnectionString, Vet, day, ("09:00", "12:00"), ("13:00", "17:00"));

        var (_, overLunch) = await _appointments.CreateAsync(Owner, NewAppointment() with
        {
            StartDateTime = Calendars.DaysAhead(3, 11, 45),
            EndDateTime = Calendars.DaysAhead(3, 13, 15),
        });
        Assert.Equal(AppointmentFailure.NotAvailable, overLunch);

        var (inside, failure) = await _appointments.CreateAsync(Owner, NewAppointment() with
        {
            StartDateTime = Calendars.DaysAhead(3, 13),
            EndDateTime = Calendars.DaysAhead(3, 13, 30),
        });
        Assert.Null(failure);
        Assert.NotNull(inside);
    }

    [Fact]
    public async Task Reads_the_clinics_hours_in_the_owners_zone()
    {
        // 09:00 at UTC+5 is 04:00 UTC — closed if read as UTC.
        var localNine = new DateTimeOffset(
            Calendars.DaysAhead(3, hour: 9).DateTime, TimeSpan.FromHours(5));
        await Calendars.CloseVetAsync(db.ConnectionString, Vet);
        await Calendars.SetVetDayAsync(
            db.ConnectionString, Vet, DateOnly.FromDateTime(localNine.DateTime), ("09:00", "12:00"));

        var request = NewAppointment() with
        {
            StartDateTime = localNine.ToUniversalTime(),
            EndDateTime = localNine.ToUniversalTime().AddMinutes(30),
        };

        var (_, refused) = await _appointments.CreateAsync(Owner, request);
        Assert.Equal(AppointmentFailure.NotAvailable, refused);

        var (appointment, failure) = await _appointments.CreateAsync(
            Owner, request with { UtcOffsetMinutes = 300 });
        Assert.Null(failure);
        Assert.NotNull(appointment);
    }

    // ── Who may move an appointment ──────────────────────────────────────

    [Fact]
    public async Task Lets_the_vet_confirm_a_requested_appointment()
    {
        // a4 is seeded `requested`, owned by u1 with vet v1.
        var (appointment, failure) = await _appointments.UpdateStatusAsync(
            VetUser, "a4", AppointmentStatuses.Confirmed);

        Assert.Null(failure);
        Assert.Equal(AppointmentStatuses.Confirmed, appointment!.Status);
    }

    [Fact]
    public async Task Stops_the_owner_confirming_their_own_appointment()
    {
        // REQUIREMENTS.md V6, and the vet analogue of C8.
        var (_, failure) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Confirmed);

        Assert.Equal(AppointmentFailure.WrongActor, failure);

        var (unchanged, _) = await _appointments.GetAsync(Owner, "a4");
        Assert.Equal(AppointmentStatuses.Requested, unchanged!.Status);
    }

    [Fact]
    public async Task Stops_the_owner_declining_or_completing()
    {
        var (_, declining) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Declined);
        Assert.Equal(AppointmentFailure.WrongActor, declining);

        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.Confirmed);
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.InProgress);

        var (_, completing) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Completed);
        Assert.Equal(AppointmentFailure.WrongActor, completing);
    }

    [Fact]
    public async Task Lets_either_party_cancel()
    {
        var (byOwner, ownerFailure) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Cancelled);
        Assert.Null(ownerFailure);
        Assert.Equal(AppointmentStatuses.Cancelled, byOwner!.Status);

        await db.ResetAsync();

        var (_, vetFailure) = await _appointments.UpdateStatusAsync(
            VetUser, "a3", AppointmentStatuses.Cancelled);
        Assert.Null(vetFailure);
    }

    [Fact]
    public async Task Refuses_a_status_change_from_a_stranger()
    {
        var (_, failure) = await _appointments.UpdateStatusAsync(
            Stranger, "a4", AppointmentStatuses.Confirmed);

        Assert.Equal(AppointmentFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task Checks_legality_before_authority()
    {
        // An illegal move reports as illegal even when the actor would have been
        // entitled to a legal one — more useful to say, and it does not leak the
        // current status to someone probing with the wrong verb.
        await _appointments.UpdateStatusAsync(Owner, "a4", AppointmentStatuses.Cancelled);

        var (_, failure) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Confirmed);

        Assert.Equal(AppointmentFailure.InvalidTransition, failure);
    }

    // ── The lifecycle ────────────────────────────────────────────────────

    [Fact]
    public async Task Walks_the_full_happy_path()
    {
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.Confirmed);
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.InProgress);

        var (appointment, failure) = await _appointments.UpdateStatusAsync(
            VetUser, "a4", AppointmentStatuses.Completed);

        Assert.Null(failure);
        Assert.Equal(AppointmentStatuses.Completed, appointment!.Status);
    }

    [Fact]
    public async Task Rejects_skipping_requested_straight_to_completed()
    {
        var (_, failure) = await _appointments.UpdateStatusAsync(
            VetUser, "a4", AppointmentStatuses.Completed);

        Assert.Equal(AppointmentFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_changing_a_completed_appointment()
    {
        // a1 is seeded completed. Terminal means terminal.
        //
        // The caller is resolved from the fixture rather than hardcoded: a test
        // naming the wrong user would pass for the wrong reason, because
        // NotParticipant looks like a refusal too.
        var row = await AppointmentRowAsync("a1");
        var vetUser = await VetUserAsync(row.VetId);

        var (_, failure) = await _appointments.UpdateStatusAsync(
            vetUser, "a1", AppointmentStatuses.InProgress);

        Assert.Equal(AppointmentFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Rejects_reviving_a_cancelled_appointment()
    {
        // a6 is seeded cancelled.
        var row = await AppointmentRowAsync("a6");
        var vetUser = await VetUserAsync(row.VetId);

        var (_, failure) = await _appointments.UpdateStatusAsync(
            vetUser, "a6", AppointmentStatuses.Confirmed);

        Assert.Equal(AppointmentFailure.InvalidTransition, failure);
    }

    [Fact]
    public async Task Treats_a_no_op_same_status_update_as_valid()
    {
        // A double-tapped Confirm button is not an error — and note the status
        // is `requested`, not `accepted`: this machine is §11.2.
        var (appointment, failure) = await _appointments.UpdateStatusAsync(
            Owner, "a4", AppointmentStatuses.Requested);

        Assert.Null(failure);
        Assert.Equal(AppointmentStatuses.Requested, appointment!.Status);
    }

    [Fact]
    public void The_vocabulary_is_11_2_and_not_11_1()
    {
        // The one word that differs between the two machines, pinned so a
        // copy-paste from BookingStatuses fails here rather than in production.
        Assert.Contains(AppointmentStatuses.Confirmed, AppointmentStatuses.All);
        Assert.DoesNotContain(BookingStatuses.Accepted, AppointmentStatuses.All);
        Assert.False(AppointmentStatuses.IsValid(BookingStatuses.Accepted));
    }

    // ── The visit summary — REQUIREMENTS.md V7, V8, V9 ───────────────────

    /// <summary>A prescription and a note, as a real visit summary carries.</summary>
    private static VisitSummaryRequest Summary() => new(
    [
        new MedicalRecordRequest(
            Type: MedicalRecordTypes.VisitNote,
            Title: "Soft-tissue strain, front right",
            Details: "Short lead walks for ten days.",
            OccurredAt: default,
            AppointmentId: null,
            NextDueAt: null,
            MedicationName: null,
            Dosage: null,
            RefillsLeft: null,
            ExpiresAt: null,
            ProductSlugs: null),
        new MedicalRecordRequest(
            Type: MedicalRecordTypes.Prescription,
            Title: "Anti-inflammatory",
            Details: "Ten days, with food.",
            OccurredAt: default,
            AppointmentId: null,
            NextDueAt: null,
            MedicationName: "Carprofen 75 mg",
            Dosage: "1 tablet twice daily",
            RefillsLeft: 2,
            ExpiresAt: DateTimeOffset.UtcNow.AddMonths(6),
            ProductSlugs: ["vetline-hypoallergenic-cat-dry"]),
    ]);

    /// <summary>a4 taken to in_progress, which is where a summary is written from.</summary>
    private async Task StartVisitAsync()
    {
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.Confirmed);
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.InProgress);
    }

    [Fact]
    public async Task A_visit_summary_completes_the_appointment_and_writes_the_records()
    {
        await StartVisitAsync();

        var (result, failure) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        Assert.Null(failure);
        Assert.Equal(AppointmentStatuses.Completed, result!.Appointment.Status);
        Assert.Equal(2, result.Records.Length);
    }

    [Fact]
    public async Task Every_record_is_stamped_with_the_vet_the_access_check_returned()
    {
        // The rule BUILD_PLAN.md calls the thing that justifies the whole
        // architecture. The id is the one CanAccessPetRecordsAsync handed back
        // when it granted access — not one looked up separately, and not one
        // the request could name.
        await StartVisitAsync();

        var (result, _) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        Assert.All(result!.Records, r =>
        {
            Assert.Equal(Vet, r.VetId);
            Assert.Equal(VetUser, r.AuthorUserId);
        });
    }

    [Fact]
    public async Task Every_record_is_stamped_with_this_appointment_and_this_pet()
    {
        // REQUIREMENTS.md V8, made structural rather than checked: the pet comes
        // from the appointment row and the appointment id is the route's, so
        // there is no combination of inputs that produces a mismatch.
        await StartVisitAsync();

        var (result, _) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        Assert.All(result!.Records, r =>
        {
            Assert.Equal("a4", r.AppointmentId);
            Assert.Equal("p2", r.PetId);   // a4 is Miso's video consult
        });
    }

    [Fact]
    public async Task An_appointment_id_in_the_body_is_overwritten_not_honoured()
    {
        await StartVisitAsync();

        var tampered = new VisitSummaryRequest(
        [
            Summary().Records[0] with { AppointmentId = "a1" },   // somebody else's visit
        ]);

        var (result, _) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", tampered);

        Assert.Equal("a4", result!.Records[0].AppointmentId);
    }

    [Fact]
    public async Task The_prescription_reaches_the_pets_permanent_record()
    {
        // REQUIREMENTS.md §7.4 and journey 3 of §13, at the service level.
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var (timeline, failure) = await _records.ListForPetAsync(Owner, "p2");

        Assert.Null(failure);
        var prescription = Assert.Single(
            timeline!,
            r => r.Type == MedicalRecordTypes.Prescription && r.AppointmentId == "a4");

        Assert.Equal("Carprofen 75 mg", prescription.MedicationName);
        Assert.Equal(2, prescription.RefillsLeft);
    }

    [Fact]
    public async Task The_prescription_authorises_a_product_for_the_store()
    {
        // The other half of the seam: M6 reads exactly this list. Written as a
        // test here so that a change to the summary path that quietly stopped
        // producing it fails in M5 rather than in M6.
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var slugs = await conn.QueryAsync<string>(
            """
            SELECT DISTINCT unnest("productSlugs") FROM medical_records
            WHERE "petId" = 'p2' AND type = 'prescription'
              AND ("expiresAt" IS NULL OR "expiresAt" > now())
              AND ("refillsLeft" IS NULL OR "refillsLeft" > 0)
            """);

        Assert.Contains("vetline-hypoallergenic-cat-dry", slugs);
    }

    [Fact]
    public async Task An_owner_cannot_write_their_own_visit_summary()
    {
        // The whole Rx gate rests on this. An owner who could complete a visit
        // could write themselves a prescription.
        await StartVisitAsync();

        var (result, failure) = await _appointments.CompleteWithSummaryAsync(
            Owner, "a4", Summary());

        Assert.Null(result);
        Assert.Equal(AppointmentFailure.NotTheVet, failure);
    }

    [Fact]
    public async Task Another_clinic_cannot_write_this_visits_summary()
    {
        await StartVisitAsync();

        // u18 holds v2 and has no appointment for p2.
        var (_, failure) = await _appointments.CompleteWithSummaryAsync(
            "u18", "a4", Summary());

        Assert.Equal(AppointmentFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task A_visit_summary_needs_a_visit_that_has_started()
    {
        // a4 is `requested`. Legality before authority, as everywhere else.
        var (_, failure) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        Assert.Equal(AppointmentFailure.NotInProgress, failure);
    }

    [Fact]
    public async Task A_completed_visit_cannot_be_summarised_twice()
    {
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var (_, failure) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        Assert.Equal(AppointmentFailure.NotInProgress, failure);
    }

    [Fact]
    public async Task An_empty_summary_is_refused()
    {
        await StartVisitAsync();

        var (_, failure) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", new VisitSummaryRequest([]));

        Assert.Equal(AppointmentFailure.BadSummary, failure);
    }

    [Fact]
    public async Task A_refused_summary_leaves_the_appointment_and_the_record_alone()
    {
        // One transaction: a visit that ended up completed with half its notes
        // written would be a clinical record that lies by omission.
        await StartVisitAsync();

        var bad = new VisitSummaryRequest(
            [Summary().Records[0] with { Type = "astrology" }]);

        var (_, failure) = await _appointments.CompleteWithSummaryAsync(VetUser, "a4", bad);
        Assert.Equal(AppointmentFailure.BadSummary, failure);

        var (appointment, _) = await _appointments.GetAsync(Owner, "a4");
        Assert.Equal(AppointmentStatuses.InProgress, appointment!.Status);

        var (timeline, _) = await _records.ListForPetAsync(Owner, "p2");
        Assert.DoesNotContain(timeline!, r => r.AppointmentId == "a4");
    }

    [Fact]
    public async Task Every_record_type_the_server_accepts_may_appear_in_a_summary()
    {
        // REQUIREMENTS.md V9. The reference implementation's form offered five
        // of the six and omitted `allergy`, so a vet who found a food allergy
        // during a consultation had nowhere to record it — and the allergy list
        // is what the store's recommendations read.
        await StartVisitAsync();

        var everything = new VisitSummaryRequest(
            [.. MedicalRecordTypes.All.Select(type => new MedicalRecordRequest(
                Type: type, Title: $"Entry: {type}", Details: null,
                OccurredAt: default, AppointmentId: null, NextDueAt: null,
                MedicationName: type == MedicalRecordTypes.Prescription ? "Something" : null,
                Dosage: null, RefillsLeft: null, ExpiresAt: null, ProductSlugs: null))]);

        var (result, failure) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", everything);

        Assert.Null(failure);
        Assert.Equal(
            MedicalRecordTypes.All.Order(),
            result!.Records.Select(r => r.Type).Order());
    }

    [Fact]
    public async Task An_omitted_date_files_the_entry_under_when_the_visit_ended()
    {
        await StartVisitAsync();

        var (result, _) = await _appointments.CompleteWithSummaryAsync(
            VetUser, "a4", Summary());

        var row = await AppointmentRowAsync("a4");
        Assert.All(result!.Records, r => Assert.Equal(row.EndDateTime, r.OccurredAt));
    }

    // ── V8 on the ordinary record route ──────────────────────────────────

    [Fact]
    public async Task A_record_cannot_cite_another_pets_appointment()
    {
        // REQUIREMENTS.md V8 on POST /pets/{id}/medical-records, which is the
        // route the reference implementation got wrong. a1 is Luna's (p4).
        var (record, failure) = await _records.CreateAsync(
            Owner, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.Weight, Title: "Weight recorded", Details: null,
                OccurredAt: DateTimeOffset.UtcNow, AppointmentId: "a1", NextDueAt: null,
                MedicationName: null, Dosage: null, RefillsLeft: null,
                ExpiresAt: null, ProductSlugs: null));

        Assert.Null(record);
        Assert.Equal(RecordFailure.AppointmentMismatch, failure);
    }

    [Fact]
    public async Task A_vet_cannot_cite_another_clinics_appointment_for_the_same_pet()
    {
        // The harder half of V8: the appointment really is this pet's, and the
        // author really does have clinical access — it is simply somebody
        // else's consultation. u17 holds v1 and treats p1 (a3, a8); the
        // appointment below is p1's, at v2.
        var (elsewhere, booked) = await _appointments.CreateAsync(
            Owner, NewAppointment() with { VetId = "v2" });
        Assert.Null(booked);

        var (record, failure) = await _records.CreateAsync(
            VetUser, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.VisitNote, Title: "Note", Details: null,
                OccurredAt: DateTimeOffset.UtcNow, AppointmentId: elsewhere!.Id,
                NextDueAt: null, MedicationName: null, Dosage: null, RefillsLeft: null,
                ExpiresAt: null, ProductSlugs: null));

        Assert.Null(record);
        Assert.Equal(RecordFailure.AppointmentMismatch, failure);
    }

    [Fact]
    public async Task A_vet_may_cite_their_own_appointment_for_this_pet()
    {
        // The control for the two refusals above: a3 is p1's visit at v1, and
        // u17 is v1.
        var (record, failure) = await _records.CreateAsync(
            VetUser, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.VisitNote, Title: "Wellness exam", Details: null,
                OccurredAt: DateTimeOffset.UtcNow, AppointmentId: "a3", NextDueAt: null,
                MedicationName: null, Dosage: null, RefillsLeft: null,
                ExpiresAt: null, ProductSlugs: null));

        Assert.Null(failure);
        Assert.Equal("a3", record!.AppointmentId);
        Assert.Equal(Vet, record.VetId);
    }

    [Fact]
    public async Task A_record_citing_no_appointment_is_always_fine()
    {
        // Most records are not attached to a visit at all.
        var (record, failure) = await _records.CreateAsync(
            Owner, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.Allergy, Title: "Beef intolerance", Details: null,
                OccurredAt: DateTimeOffset.UtcNow, AppointmentId: null, NextDueAt: null,
                MedicationName: null, Dosage: null, RefillsLeft: null,
                ExpiresAt: null, ProductSlugs: null));

        Assert.Null(failure);
        Assert.Null(record!.AppointmentId);
    }

    // ── Reviews: one direction only — REQUIREMENTS.md V10 ────────────────

    [Fact]
    public async Task An_owner_reviews_the_vet_after_a_completed_visit()
    {
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var (review, failure) = await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest(VetUser, 5, "Clear and unhurried."));

        Assert.Null(failure);
        Assert.Equal(ReviewKinds.VetAppointment, review!.Kind);
        Assert.Equal("a4", review.SubjectId);
        Assert.Equal(VetUser, review.ToUserId);
    }

    [Fact]
    public async Task A_vet_cannot_review_the_client()
    {
        // Not a missing feature. A clinician rating the client is a different
        // and much worse product, and it is why ReviewKinds exists at all.
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var (review, failure) = await _reviews.CreateForAppointmentAsync(
            VetUser, "a4", new CreateReviewRequest(Owner, 5, "Lovely cat, clear history."));

        Assert.Null(review);
        Assert.Equal(ReviewFailure.OneDirectionOnly, failure);
    }

    [Fact]
    public async Task A_visit_that_has_not_completed_cannot_be_reviewed()
    {
        var (_, failure) = await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest(VetUser, 5, null));

        Assert.Equal(ReviewFailure.NotCompleted, failure);
    }

    [Fact]
    public async Task A_stranger_cannot_review_somebody_elses_visit()
    {
        // a1 is seeded completed, and belongs to u3.
        var (_, failure) = await _reviews.CreateForAppointmentAsync(
            Stranger, "a1", new CreateReviewRequest(VetUser, 1, "Never been."));

        Assert.Equal(ReviewFailure.NotParticipant, failure);
    }

    [Fact]
    public async Task A_review_aimed_at_anyone_but_the_treating_vet_is_refused()
    {
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var (_, failure) = await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest("u18", 5, "Wrong clinic."));

        Assert.Equal(ReviewFailure.WrongRecipient, failure);
    }

    [Fact]
    public async Task One_review_per_visit()
    {
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());
        await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest(VetUser, 5, "Good."));

        var (_, failure) = await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest(VetUser, 1, "Changed my mind."));

        Assert.Equal(ReviewFailure.AlreadyReviewed, failure);
    }

    [Fact]
    public async Task A_vet_review_moves_the_vets_rating_and_not_a_caretakers()
    {
        await StartVisitAsync();
        await _appointments.CompleteWithSummaryAsync(VetUser, "a4", Summary());

        var before = await VetRatingAsync(Vet);

        await _reviews.CreateForAppointmentAsync(
            Owner, "a4", new CreateReviewRequest(VetUser, 1, "Disappointing."));

        Assert.True(await VetRatingAsync(Vet) < before);
    }

    [Fact]
    public async Task A_vets_reviews_and_a_caretakers_never_mix()
    {
        // One table, two kinds. `kind` is part of every lookup so that a person
        // who is both never has the two confused — REQUIREMENTS.md §12 lists the
        // reference's kind-less lookup as a defect.
        var onA1 = await _reviews.ListForSubjectAsync("a1", ReviewKinds.VetAppointment);
        Assert.NotEmpty(onA1);
        Assert.All(onA1, r => Assert.Equal(ReviewKinds.VetAppointment, r.Kind));

        Assert.Empty(await _reviews.ListForSubjectAsync("a1", ReviewKinds.Booking));
    }

    // ── Response rate, the vet arm ───────────────────────────────────────

    [Fact]
    public async Task The_seeded_vet_response_rates_match_what_the_rows_imply()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var profiles = await conn.QueryAsync<(string Id, int Stored)>(
            """SELECT id, "responseRatePct" FROM vet_profiles""");

        foreach (var (id, stored) in profiles)
        {
            var answered = await conn.ExecuteScalarAsync<int>(
                """
                SELECT count(*)::int FROM vet_appointments
                WHERE "vetId" = @id
                  AND status = ANY(ARRAY['confirmed','declined','in_progress','completed'])
                """, new { id });

            var waiting = await conn.ExecuteScalarAsync<int>(
                """
                SELECT count(*)::int FROM vet_appointments
                WHERE "vetId" = @id AND status = 'requested'
                """, new { id });

            Assert.Equal(ReputationService.ResponseRateFrom(answered, waiting), stored);
        }
    }

    [Fact]
    public async Task The_vet_response_rate_rises_when_a_request_is_answered()
    {
        var before = await VetResponseRateAsync(Vet);
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.Confirmed);

        Assert.True(await VetResponseRateAsync(Vet) > before);
    }

    [Fact]
    public async Task The_vet_response_rate_rises_just_the_same_on_a_decline()
    {
        var before = await VetResponseRateAsync(Vet);
        await _appointments.UpdateStatusAsync(VetUser, "a4", AppointmentStatuses.Declined);

        Assert.True(await VetResponseRateAsync(Vet) > before);
    }

    [Fact]
    public async Task The_vet_response_rate_falls_when_a_new_request_arrives_unanswered()
    {
        var before = await VetResponseRateAsync(Vet);
        await _appointments.CreateAsync(Owner, NewAppointment());

        Assert.True(await VetResponseRateAsync(Vet) < before);
    }

    [Fact]
    public async Task A_cancellation_says_nothing_about_a_clinics_responsiveness()
    {
        var before = await VetResponseRateAsync(Vet);
        await _appointments.UpdateStatusAsync(Owner, "a4", AppointmentStatuses.Cancelled);

        Assert.True(await VetResponseRateAsync(Vet) >= before);
    }

    // ── Consultation pricing ─────────────────────────────────────────────

    [Theory]
    // No discount: the quoted fee is the list fee, to the cent.
    [InlineData(8500, 0, 8500)]
    [InlineData(14000, 0, 14000)]
    // A member discount, in whole percentages.
    [InlineData(8500, 10, 7650)]
    [InlineData(14000, 15, 11900)]
    // A price that does not divide cleanly rounds once, away from zero.
    [InlineData(9999, 33, 6699)]
    // Clamped: a negative discount is not a surcharge and 200% is not a refund.
    [InlineData(8500, -10, 8500)]
    [InlineData(8500, 200, 0)]
    public void Prices_a_consultation_from_the_list_fee_and_the_discount(
        int listFeeCents, int discountPct, int expectedFeeCents)
    {
        var (baseFee, pct, fee) = AppointmentService.ConsultFee(listFeeCents, discountPct);

        Assert.Equal(listFeeCents, baseFee);
        Assert.Equal(Math.Clamp(discountPct, 0, 100), pct);
        Assert.Equal(expectedFeeCents, fee);
    }

    [Fact]
    public void Consultation_pricing_is_integer_arithmetic_end_to_end()
    {
        // The reference worked in float USD — Math.round(baseFee * (100 - pct))
        // / 100 — which is the arithmetic that puts $89.60000000000001 on a
        // receipt. Cents divided once and rounded once is exact from then on.
        var (_, _, fee) = AppointmentService.ConsultFee(8960, 0);

        Assert.Equal(8960, fee);
        Assert.Equal(89.60m, fee / 100m);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private async Task<int> VetResponseRateAsync(string vetId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<int>(
            """SELECT "responseRatePct" FROM vet_profiles WHERE id = @vetId""", new { vetId });
    }

    private async Task<double> VetRatingAsync(string vetId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<double>(
            """SELECT rating FROM vet_profiles WHERE id = @vetId""", new { vetId });
    }

    private async Task<(string VetId, string OwnerId, DateTimeOffset EndDateTime)>
        AppointmentRowAsync(string id)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.QuerySingleAsync<(string, string, DateTimeOffset)>(
            """SELECT "vetId", "ownerId", "endDateTime" FROM vet_appointments WHERE id = @id""",
            new { id });
    }

    private async Task<(int BaseFeeCents, int DiscountPct, int FeeCents, bool Priority)>
        MoneyRowAsync(string id)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.QuerySingleAsync<(int, int, int, bool)>(
            """
            SELECT "baseFeeCents", "discountPct", "feeCents", priority
            FROM vet_appointments WHERE id = @id
            """, new { id });
    }

    private async Task<string> VetUserAsync(string vetId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<string>(
            """SELECT "userId" FROM vet_profiles WHERE id = @vetId""", new { vetId }) ?? "";
    }
}
