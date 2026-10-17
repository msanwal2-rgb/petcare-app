using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Completing an adoption — the reference's <c>tests/adoption-transfer.test.ts</c>,
/// case for case. It is the specification for REQUIREMENTS.md R6.
///
/// The seeded state this leans on:
///   aa3 — approved application, u4 adopting Juniper (p15) from sh2 (user u25)
///   al3 — her listing, currently <c>pending</c> because she is approved
///   fee — $150, unpaid
///
/// ── One adaptation ──
///
/// The reference's "does not hand the adopter a prescription pipeline" case
/// compared <c>authorizedProductSlugs</c> before and after a vet tried to write
/// a prescription it was refused. Here the refusal is asserted directly and the
/// pet's prescription rows are counted, which is the same claim without a
/// helper the build does not have.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AdoptionTransferTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Application = "aa3";
    private const string Listing = "al3";
    private const string Pet = "p15";
    private const string ShelterUser = "u25";
    private const string Adopter = "u4";
    private const string Staff = "u23";

    private CoreHost _core = null!;
    private IAdoptionTransferService _transfer = null!;
    private IAccessService _access = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _transfer = _core.Get<IAdoptionTransferService>();
        _access = _core.Get<IAccessService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private async Task Exec(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    private Task PayTheFeeAsync() => Exec("""
        INSERT INTO payments (id, "userId", kind, "adoptionApplicationId", provider, "providerRef",
                              status, "amountCents", currency, "createdAt", "updatedAt", "succeededAt")
        SELECT 'pay_adoption_test', 'u4', 'adoption_fee', id, 'demo', 'demo_pi_adoption_test',
               'paid', "feeCents", 'usd', now(), now(), now()
        FROM adoption_applications WHERE id = 'aa3'
        """);

    private Task FosterBookingAsync() => Exec("""
        INSERT INTO bookings (id, "ownerId", "caretakerId", "petIds", "serviceType", "startDateTime",
                              "endDateTime", notes, status, "createdAt", "priceTotalCents")
        VALUES ('b_foster', 'u25', 'c1', ARRAY['p15'], 'boarding', now() - interval '1 day',
                now() + interval '6 days', 'In foster', 'in_progress', now(), 40000)
        """);

    private Task AppointmentAsync(
        string id, string ownerId, string vetId, string status, string startSql, string createdSql)
        => Exec($"""
            INSERT INTO vet_appointments (id, "ownerId", "vetId", "petId", mode, reason, symptoms,
                                          "startDateTime", "endDateTime", status, "createdAt",
                                          "baseFeeCents", "feeCents")
            VALUES (@id, @ownerId, @vetId, 'p15', 'in_clinic', 'Visit', ARRAY[]::text[],
                    {startSql}, {startSql} + interval '30 minutes', @status, {createdSql}, 9000, 9000)
            """, new { id, ownerId, vetId, status });

    private Task<string> VetUserAsync(string vetId)
        => One<string>("""SELECT "userId" FROM vet_profiles WHERE id = @vetId""", new { vetId });

    private Task<bool> OwnsAsync(string userId) => _access.OwnsPetAsync(userId, Pet);

    // ── Preconditions ────────────────────────────────────────────────────

    [Fact]
    public async Task Refuses_anyone_but_the_shelter()
    {
        await PayTheFeeAsync();

        // The applicant pays; the shelter hands over. Splitting them keeps each
        // action with the party who performs it in the world.
        var (_, refusal) = await _transfer.CompleteAsync(Adopter, Application, force: false);
        Assert.Equal(AdoptionFailure.NotShelter, refusal!.Kind);
    }

    [Fact]
    public async Task Refuses_an_application_that_is_not_approved()
    {
        var (_, refusal) = await _transfer.CompleteAsync("u24", "aa1", force: false);
        Assert.Equal(AdoptionFailure.InvalidTransition, refusal!.Kind);
        Assert.Equal(ApplicationStatuses.Submitted, refusal.From);
    }

    [Fact]
    public async Task Refuses_while_the_fee_is_unpaid()
    {
        var (_, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        Assert.Equal(AdoptionFailure.FeeUnpaid, refusal!.Kind);
        // And nothing moved.
        Assert.True(await OwnsAsync(ShelterUser));
    }

    [Fact]
    public async Task Completes_a_waived_fee_with_no_payment_at_all()
    {
        await Exec("""UPDATE adoption_applications SET "feeCents" = 0 WHERE id = 'aa3'""");

        var (result, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        Assert.Null(refusal);
        Assert.NotNull(result);
        // Plenty of shelters waive fees; a $0 intent would have been refused by
        // the provider anyway.
        Assert.Equal(0, await One<int>(
            """SELECT count(*)::int FROM payments WHERE "adoptionApplicationId" = 'aa3'"""));
    }

    [Fact]
    public async Task Reports_an_unknown_application_rather_than_throwing()
    {
        var (_, refusal) = await _transfer.CompleteAsync(ShelterUser, "ghost", force: false);
        Assert.Equal(AdoptionFailure.NotFound, refusal!.Kind);
    }

    // ── Live engagements ─────────────────────────────────────────────────

    [Fact]
    public async Task Refuses_while_a_booking_is_open_and_names_it()
    {
        await PayTheFeeAsync();
        await FosterBookingAsync();

        var (_, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        Assert.Equal(AdoptionFailure.LiveEngagements, refusal!.Kind);
        // The ids come back so the UI can say what is in the way rather than
        // refusing and leaving the shelter to guess.
        Assert.Contains("b_foster", refusal.BookingIds!);
        Assert.True(await OwnsAsync(ShelterUser));
    }

    [Fact]
    public async Task Goes_through_when_the_shelter_explicitly_forces_it_cancelling_as_it_goes()
    {
        await PayTheFeeAsync();
        await FosterBookingAsync();

        var (result, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: true);

        Assert.Null(refusal);
        Assert.NotNull(result);

        // Cancelled through the booking's own machine, so the caretaker gets
        // what a silent UPDATE would have skipped.
        Assert.Equal(BookingStatuses.Cancelled,
            await One<string>("SELECT status FROM bookings WHERE id = 'b_foster'"));
    }

    [Fact]
    public async Task Refuses_while_a_vet_appointment_is_open()
    {
        await PayTheFeeAsync();
        await AppointmentAsync("a_midtreatment", ShelterUser, "v1", "confirmed",
            "now() + interval '1 day'", "now()");

        var (_, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        Assert.Equal(AdoptionFailure.LiveEngagements, refusal!.Kind);
        Assert.Contains("a_midtreatment", refusal.AppointmentIds!);
    }

    // ── The transfer itself ──────────────────────────────────────────────

    [Fact]
    public async Task Moves_the_animal_and_closes_everything_around_it()
    {
        await PayTheFeeAsync();

        var (result, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);
        Assert.Null(refusal);
        Assert.Equal(Adopter, result!.Pet.OwnerId);

        Assert.True(await OwnsAsync(Adopter));
        Assert.False(await OwnsAsync(ShelterUser));

        var listing = await One<(string Status, DateTime? ClosedAt)>(
            """SELECT status, "closedAt" FROM adoption_listings WHERE id = 'al3'""");
        Assert.Equal(ListingStatuses.Adopted, listing.Status);
        Assert.NotNull(listing.ClosedAt);

        var application = await One<(string Status, DateTime? CompletedAt)>(
            """SELECT status, "completedAt" FROM adoption_applications WHERE id = 'aa3'""");
        Assert.Equal(ApplicationStatuses.Completed, application.Status);
        Assert.NotNull(application.CompletedAt);
    }

    [Fact]
    public async Task Moves_owner_and_owned_since_in_the_same_write()
    {
        await PayTheFeeAsync();
        var before = await One<DateTime>("""SELECT "ownedSince" FROM pets WHERE id = 'p15'""");

        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        // `ownedSince` is what severs the previous household's grants; an
        // owner change without it would leave them all standing.
        var after = await One<(string OwnerId, DateTime OwnedSince)>(
            """SELECT "ownerId", "ownedSince" FROM pets WHERE id = 'p15'""");
        Assert.Equal(Adopter, after.OwnerId);
        Assert.True(after.OwnedSince > before);
        Assert.True(after.OwnedSince > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task Takes_the_health_record_with_the_animal()
    {
        await PayTheFeeAsync();
        var before = await One<int>("""SELECT count(*)::int FROM medical_records WHERE "petId" = 'p15'""");

        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        // The records do not move — they are keyed on the pet, so they follow
        // it by standing still.
        Assert.Equal(before, await One<int>(
            """SELECT count(*)::int FROM medical_records WHERE "petId" = 'p15'"""));
        Assert.True((await _access.CanAccessPetRecordsAsync(Adopter, Pet)).Allowed);
    }

    [Fact]
    public async Task Severs_the_shelters_vets_and_caretakers()
    {
        await PayTheFeeAsync();

        // An engagement that would otherwise outlive the adoption. Its
        // createdAt falls after the shelter's own ownedSince, or it would never
        // have granted anything.
        await AppointmentAsync("a_shelter_history", ShelterUser, "v1", "completed",
            "now() - interval '5 days'", "now() - interval '6 days'");
        var vetUser = await VetUserAsync("v1");
        Assert.True((await _access.CanAccessPetRecordsAsync(vetUser, Pet)).Allowed);

        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        // Without this the shelter's vet would keep writing prescriptions
        // against the adopter's animal — and so against the adopter's store
        // account.
        Assert.False((await _access.CanAccessPetRecordsAsync(vetUser, Pet)).Allowed);
        Assert.False(await _access.CanViewPetAsync(ShelterUser, Pet));
    }

    [Fact]
    public async Task Grants_nothing_for_an_engagement_older_than_the_shelters_own_ownership()
    {
        // The same rule one step further back: an appointment dated before the
        // shelter took the animal in describes somebody else's household.
        await AppointmentAsync("a_previous_household", "u1", "v1", "completed",
            """(SELECT "ownedSince" FROM pets WHERE id = 'p15') - interval '1 day'""",
            """(SELECT "ownedSince" FROM pets WHERE id = 'p15') - interval '1 day'""");

        var vetUser = await VetUserAsync("v1");
        Assert.False((await _access.CanAccessPetRecordsAsync(vetUser, Pet)).Allowed);
    }

    [Fact]
    public async Task Does_not_hand_the_adopter_a_prescription_pipeline_they_did_not_earn()
    {
        await PayTheFeeAsync();
        await AppointmentAsync("a_shelter_history", ShelterUser, "v1", "completed",
            "now() - interval '5 days'", "now() - interval '6 days'");
        var before = await One<int>(
            """SELECT count(*)::int FROM medical_records WHERE "petId" = 'p15' AND type = 'prescription'""");

        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        // The shelter's vet tries to write a new prescription after the
        // handover, and is refused at the predicate that guards it.
        var vetUser = await VetUserAsync("v1");
        Assert.False((await _access.CanAccessPetRecordsAsync(vetUser, Pet)).Allowed);

        var write = await _core.Get<IMedicalRecordService>().CreateAsync(vetUser, Pet,
            new MedicalRecordRequest(
                MedicalRecordTypes.Prescription, "Rimadyl", null, DateTimeOffset.UtcNow, null, null,
                "Rimadyl", "75mg", 2, DateTimeOffset.UtcNow.AddMonths(6), ["rimadyl-75"]));
        Assert.NotNull(write.Failure);

        Assert.Equal(before, await One<int>(
            """SELECT count(*)::int FROM medical_records WHERE "petId" = 'p15' AND type = 'prescription'"""));
    }

    [Fact]
    public async Task Closes_the_other_applications_for_the_same_animal()
    {
        await PayTheFeeAsync();

        // A second person wanting the same dog.
        await Exec("""
            INSERT INTO adoption_applications (id, "listingId", "shelterId", "petId", "petName",
                "petPhotoUrl", "applicantId", status, "feeCents", "homeType", "createdAt", "updatedAt")
            VALUES ('aa_rival', 'al3', 'sh2', 'p15', 'Juniper', '', 'u6', 'submitted', 15000,
                    'house', now(), now())
            """);

        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        // Told, rather than left refreshing a listing that will never come back.
        var rival = await One<(string Status, string DecisionNote)>(
            """SELECT status, "decisionNote" FROM adoption_applications WHERE id = 'aa_rival'""");
        Assert.Equal(ApplicationStatuses.Rejected, rival.Status);
        Assert.Contains("Juniper", rival.DecisionNote);

        Assert.Equal(1, await One<int>(
            """SELECT count(*)::int FROM notifications WHERE "userId" = 'u6' AND kind = 'adoption_rejected'"""));
    }

    [Fact]
    public async Task Tells_the_adopter()
    {
        await PayTheFeeAsync();
        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        var href = await One<string>(
            """SELECT href FROM notifications WHERE "userId" = 'u4' AND kind = 'adoption_completed'""");
        Assert.Equal($"/dashboard/pets/{Pet}", href);
    }

    [Fact]
    public async Task Lets_exactly_one_of_two_concurrent_completions_win()
    {
        await PayTheFeeAsync();

        // Phase 0 runs outside the transaction, so both callers can pass it. The
        // conditional UPDATE is what makes only one of them commit.
        var results = await Task.WhenAll(
            _transfer.CompleteAsync(ShelterUser, Application, force: false),
            _transfer.CompleteAsync(ShelterUser, Application, force: false));

        Assert.Single(results, r => r.Refusal is null);
        Assert.Single(results, r => r.Refusal is not null);

        // And the loser left nothing behind: one adopter notice, not two.
        Assert.Equal(1, await One<int>(
            """SELECT count(*)::int FROM notifications WHERE "userId" = 'u4' AND kind = 'adoption_completed'"""));
    }

    [Fact]
    public async Task Refuses_a_second_completion_afterwards()
    {
        await PayTheFeeAsync();
        await _transfer.CompleteAsync(ShelterUser, Application, force: false);

        var (_, again) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);
        Assert.NotNull(again);
    }

    // ── Putting an animal back ───────────────────────────────────────────

    private async Task CompleteItAsync()
    {
        await PayTheFeeAsync();
        var (_, refusal) = await _transfer.CompleteAsync(ShelterUser, Application, force: false);
        Assert.Null(refusal);
    }

    [Fact]
    public async Task Reverse_returns_ownership_and_reopens_the_listing()
    {
        await CompleteItAsync();

        var (result, refusal) = await _transfer.ReverseAsync(new StaffActor(Staff), Application, "Allergic reaction");

        Assert.Null(refusal);
        Assert.Equal(ShelterUser, result!.Pet.OwnerId);
        Assert.True(await OwnsAsync(ShelterUser));

        var listing = await One<(string Status, DateTime? ClosedAt)>(
            """SELECT status, "closedAt" FROM adoption_listings WHERE id = 'al3'""");
        Assert.Equal(ListingStatuses.Available, listing.Status);
        Assert.Null(listing.ClosedAt);
    }

    [Fact]
    public async Task Reverse_severs_the_adopters_own_vets_on_the_way_back()
    {
        await CompleteItAsync();

        // The adopter books their own vet after adopting...
        await AppointmentAsync("a_adopter_vet", Adopter, "v2", "confirmed",
            "now() + interval '1 day'", "now()");
        var v2 = await VetUserAsync("v2");
        Assert.True((await _access.CanAccessPetRecordsAsync(v2, Pet)).Allowed);

        await _transfer.ReverseAsync(new StaffActor(Staff), Application, "Returned");

        // The mechanism has never cared which way an animal moves.
        Assert.False((await _access.CanAccessPetRecordsAsync(v2, Pet)).Allowed);
    }

    [Fact]
    public async Task Reverse_refuses_something_that_never_completed()
    {
        var (_, refusal) = await _transfer.ReverseAsync(new StaffActor(Staff), "aa1", "Nope");
        Assert.Equal(AdminFailure.Conflict, refusal!.Kind);
    }

    [Fact]
    public async Task Reverse_is_audited_does_not_refund_and_tells_the_adopter()
    {
        await CompleteItAsync();

        await _transfer.ReverseAsync(new StaffActor(Staff), Application, "Allergic reaction");

        Assert.Equal(1, await One<int>(
            """SELECT count(*)::int FROM admin_audit_log WHERE action = 'adoption.reverse' AND "targetId" = 'aa3'"""));
        Assert.Equal(PaymentStatuses.Paid, await One<string>(
            """SELECT status FROM payments WHERE "adoptionApplicationId" = 'aa3'"""));
        Assert.Equal(1, await One<int>(
            """SELECT count(*)::int FROM notifications WHERE "userId" = 'u4' AND kind = 'adoption_reversed'"""));
    }

    [Fact]
    public async Task Reverse_needs_support_staff()
    {
        await CompleteItAsync();

        var (_, refusal) = await _transfer.ReverseAsync(new StaffActor(ShelterUser), Application, "Mine now");

        Assert.Equal(AdminFailure.NotStaff, refusal!.Kind);
        Assert.True(await OwnsAsync(Adopter));
    }

    // ── Post-approval refunds ────────────────────────────────────────────

    [Fact]
    public async Task Gives_the_money_back_when_an_approved_applicant_is_rejected()
    {
        await PayTheFeeAsync();

        var (_, refusal) = await _core.Get<IAdoptionApplicationService>().UpdateStatusAsync(
            ShelterUser, Application, ApplicationStatuses.Rejected, "Home check raised concerns");
        Assert.Null(refusal);

        // Somebody approved to adopt and then told no must not also be out of
        // pocket.
        Assert.Equal(PaymentStatuses.Refunded, await One<string>(
            """SELECT status FROM payments WHERE "adoptionApplicationId" = 'aa3'"""));

        // And the animal goes back on the market.
        Assert.Equal(ListingStatuses.Available,
            await One<string>("SELECT status FROM adoption_listings WHERE id = 'al3'"));
    }
}
