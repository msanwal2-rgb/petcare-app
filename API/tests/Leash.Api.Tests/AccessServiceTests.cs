using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/access.test.ts</c>.
///
/// The reference project's <c>lib/server/access.ts</c> was split out of
/// <c>session.ts</c> specifically so these predicates could be exercised against
/// a real schema — its header says being able to test them was the point. This
/// is that suite, case for case, against PostgreSQL rather than Prisma.
///
/// It is the only test file in the build where a passing assertion is not the
/// bar. REQUIREMENTS.md section 4 asks for human review as well, because a
/// subtly wrong predicate is an authorization hole and an authorization hole
/// does not crash: it answers, promptly and confidently, "yes".
///
/// ── The seeded relationships these lean on ──
///
///   p1   Maya's (u1) dog
///   b1   booking for p1 with caretaker profile c1, whose user is u7
///   a3   appointment for p1 with vet profile v1, whose user is u17
///   p4   Luna (u3's cat), the pet carrying a live prescription
///
/// Neither u7 nor u17 owns p1, which is the whole point: their access is
/// derived from the engagement, and it is what must end when the animal
/// changes hands.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AccessServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Owner = "u1";
    private const string Pet = "p1";
    private const string CaretakerUser = "u7";
    private const string VetUser = "u17";
    private const string Stranger = "u2";

    private CoreHost _core = null!;
    private IAccessService _access = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _access = _core.Get<IAccessService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    // ── OwnsPet ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Owns_pet_is_true_for_the_owner_and_false_for_everyone_else()
    {
        Assert.True(await _access.OwnsPetAsync(Owner, Pet));
        Assert.False(await _access.OwnsPetAsync(Stranger, Pet));
    }

    [Fact]
    public async Task Owns_pet_is_false_for_a_pet_that_does_not_exist()
    {
        Assert.False(await _access.OwnsPetAsync(Owner, "ghost"));
    }

    // ── CanViewPet ───────────────────────────────────────────────────────

    [Fact]
    public async Task Can_view_pet_lets_the_owner_see_their_own_animal()
    {
        Assert.True(await _access.CanViewPetAsync(Owner, Pet));
    }

    [Fact]
    public async Task Can_view_pet_refuses_a_stranger()
    {
        Assert.False(await _access.CanViewPetAsync(Stranger, Pet));
    }

    [Fact]
    public async Task Can_view_pet_lets_a_caretaker_with_a_booking_see_it()
    {
        // This is the grant that exists so a sitter can read the feeding
        // instructions they are being asked to follow.
        Assert.True(await _access.CanViewPetAsync(CaretakerUser, Pet));
    }

    [Fact]
    public async Task Can_view_pet_lets_a_treating_vet_see_it()
    {
        Assert.True(await _access.CanViewPetAsync(VetUser, Pet));
    }

    [Fact]
    public async Task Can_view_pet_refuses_a_caretaker_whose_booking_was_declined()
    {
        await ExecuteAsync(
            """UPDATE bookings SET status = 'declined' WHERE @pet = ANY("petIds")""",
            new { pet = Pet });

        // The vet route still grants, so shut it off to check the caretaker
        // path in isolation.
        await ExecuteAsync(
            """UPDATE vet_appointments SET status = 'cancelled' WHERE "petId" = @pet""",
            new { pet = Pet });

        Assert.False(await _access.CanViewPetAsync(CaretakerUser, Pet));
    }

    [Fact]
    public async Task Can_view_pet_is_false_for_a_pet_that_does_not_exist()
    {
        Assert.False(await _access.CanViewPetAsync(Owner, "ghost"));
    }

    // ── CanAccessPetRecords ──────────────────────────────────────────────

    [Fact]
    public async Task Record_access_gives_the_owner_access_as_themselves_rather_than_as_a_vet()
    {
        Assert.Equal(
            new RecordAccess(true, null),
            await _access.CanAccessPetRecordsAsync(Owner, Pet));
    }

    [Fact]
    public async Task Record_access_gives_a_treating_vet_access_and_tells_the_caller_which_vet()
    {
        // AsVetId is what write endpoints stamp records with, so it has to come
        // back from the check rather than being looked up a second time.
        Assert.Equal(
            new RecordAccess(true, "v1"),
            await _access.CanAccessPetRecordsAsync(VetUser, Pet));
    }

    [Fact]
    public async Task Record_access_refuses_a_caretaker_a_booking_is_not_clinical_access()
    {
        Assert.Equal(
            new RecordAccess(false, null),
            await _access.CanAccessPetRecordsAsync(CaretakerUser, Pet));
    }

    [Fact]
    public async Task Record_access_refuses_a_stranger()
    {
        Assert.Equal(
            new RecordAccess(false, null),
            await _access.CanAccessPetRecordsAsync(Stranger, Pet));
    }

    // ── Ownership changes hands ──────────────────────────────────────────
    //
    // The reason `ownedSince` exists.
    //
    // Every one of these passed *before* the column, which is what made
    // adopting an animal hand its previous owner's caretakers and vets a
    // permanent key to the new owner's household.

    [Fact]
    public async Task Transfer_ends_a_caretakers_access()
    {
        Assert.True(await _access.CanViewPetAsync(CaretakerUser, Pet));

        await TransferToAsync(Stranger);

        Assert.False(await _access.CanViewPetAsync(CaretakerUser, Pet));
    }

    [Fact]
    public async Task Transfer_ends_a_vets_record_access()
    {
        Assert.True((await _access.CanAccessPetRecordsAsync(VetUser, Pet)).Allowed);

        await TransferToAsync(Stranger);

        Assert.Equal(
            new RecordAccess(false, null),
            await _access.CanAccessPetRecordsAsync(VetUser, Pet));
    }

    [Fact]
    public async Task Transfer_ends_the_previous_owners_access()
    {
        await TransferToAsync(Stranger);

        Assert.False(await _access.CanViewPetAsync(Owner, Pet));
        Assert.False((await _access.CanAccessPetRecordsAsync(Owner, Pet)).Allowed);
    }

    [Fact]
    public async Task Transfer_gives_the_new_owner_access()
    {
        await TransferToAsync(Stranger);

        Assert.True(await _access.OwnsPetAsync(Stranger, Pet));
        Assert.True(await _access.CanViewPetAsync(Stranger, Pet));
        Assert.True((await _access.CanAccessPetRecordsAsync(Stranger, Pet)).Allowed);
    }

    [Fact]
    public async Task Transfer_keeps_the_health_record_with_the_animal()
    {
        var before = await CountRecordsAsync(Pet);
        await TransferToAsync(Stranger);
        var after = await CountRecordsAsync(Pet);

        // The records follow the pet — that is the whole point of adopting
        // through this app rather than a listings board. Only *access* is
        // severed.
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Transfer_restores_a_vets_access_when_the_new_owner_books_them_again()
    {
        await TransferToAsync(Stranger);
        Assert.False((await _access.CanAccessPetRecordsAsync(VetUser, Pet)).Allowed);

        // A fresh engagement under the current owner grants cleanly, with no
        // special case — the timestamp comparison does all of it.
        await CreateAppointmentAsync("a_after_transfer", Stranger, "v1", Pet);

        Assert.True((await _access.CanAccessPetRecordsAsync(VetUser, Pet)).Allowed);
    }

    [Fact]
    public async Task Transfer_runs_both_ways_which_is_what_makes_a_returned_adoption_safe()
    {
        await TransferToAsync(Stranger);

        // Give the new owner their own vet engagement...
        await CreateAppointmentAsync("a_new_owner", Stranger, "v2", Pet);
        var v2User = await ScalarAsync(
            """SELECT "userId" FROM vet_profiles WHERE id = 'v2'""");

        Assert.True((await _access.CanAccessPetRecordsAsync(v2User!, Pet)).Allowed);

        // ...then reverse it. The adopter's vet loses access exactly as the
        // shelter's did. One mechanism, no second code path.
        await TransferToAsync(Owner);

        Assert.False((await _access.CanAccessPetRecordsAsync(v2User!, Pet)).Allowed);
    }

    // ── The store seam survives a transfer ───────────────────────────────
    //
    // An unexpired `prescription` naming a product slug is what unlocks Rx
    // items in the store. It is keyed on the pet, so it transfers with the
    // animal — but the vet's ability to write *new* ones must not.

    [Fact]
    public async Task Transfer_carries_existing_prescriptions_to_the_new_owner()
    {
        // p4 (Luna) is the seeded pet with a live prescription.
        var before = await AuthorizedProductSlugsAsync("p4");
        Assert.NotEmpty(before);

        await TransferToAsync(Stranger, "p4");

        var after = await AuthorizedProductSlugsAsync("p4");
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Transfer_stops_the_old_owners_vet_writing_new_ones()
    {
        var ownerBefore = await ScalarAsync(
            """SELECT "ownerId" FROM pets WHERE id = 'p4'""");
        var vetProfile = await ScalarAsync(
            """SELECT "vetId" FROM vet_appointments WHERE "petId" = 'p4' LIMIT 1""");
        var vetUser = await ScalarAsync(
            """SELECT "userId" FROM vet_profiles WHERE id = @id""", new { id = vetProfile });

        Assert.True((await _access.CanAccessPetRecordsAsync(vetUser!, "p4")).Allowed);

        await TransferToAsync(Stranger, "p4");

        // Without this, adopting an animal would hand every vet who ever
        // treated it a standing line of credit against the adopter's store
        // account.
        Assert.False((await _access.CanAccessPetRecordsAsync(vetUser!, "p4")).Allowed);
        Assert.NotEqual(Stranger, ownerBefore); // sanity: we really did move it
    }

    // ── The seeded grants are grandfathered ──────────────────────────────

    [Fact]
    public async Task Seeded_grants_keep_a_treating_vets_access_to_a_pet_they_do_not_own()
    {
        // The canary for the migration's epoch backfill. Set `ownedSince` to
        // seed time instead and this fails first, along with the demo.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var ownedSince = await conn.ExecuteScalarAsync<DateTimeOffset>(
            """SELECT "ownedSince" FROM pets WHERE id = @pet""", new { pet = Pet });

        Assert.Equal(DateTimeOffset.UnixEpoch, ownedSince.ToUniversalTime());
        Assert.True((await _access.CanAccessPetRecordsAsync(VetUser, Pet)).Allowed);
    }

    // ── The other predicates still hold ──────────────────────────────────

    [Fact]
    public async Task Recognises_both_sides_of_a_booking()
    {
        Assert.True(await _access.IsBookingParticipantAsync(Owner, "b1"));
        Assert.True(await _access.IsBookingParticipantAsync(CaretakerUser, "b1"));
        Assert.False(await _access.IsBookingParticipantAsync(Stranger, "b1"));
    }

    [Fact]
    public async Task Recognises_both_sides_of_an_appointment()
    {
        Assert.True(await _access.IsAppointmentParticipantAsync(Owner, "a3"));
        Assert.True(await _access.IsAppointmentParticipantAsync(VetUser, "a3"));
        Assert.False(await _access.IsAppointmentParticipantAsync(Stranger, "a3"));
    }

    [Fact]
    public async Task Checks_profile_ownership()
    {
        Assert.True(await _access.OwnsCaretakerProfileAsync(CaretakerUser, "c1"));
        Assert.False(await _access.OwnsCaretakerProfileAsync(Stranger, "c1"));
        Assert.True(await _access.OwnsVetProfileAsync(VetUser, "v1"));
        Assert.False(await _access.OwnsVetProfileAsync(Stranger, "v1"));
    }

    [Fact]
    public async Task Says_no_for_rows_that_do_not_exist()
    {
        Assert.False(await _access.IsBookingParticipantAsync(Owner, "ghost"));
        Assert.False(await _access.IsAppointmentParticipantAsync(Owner, "ghost"));
        Assert.False(await _access.OwnsCaretakerProfileAsync(Owner, "ghost"));
    }

    // ── Beyond the reference suite ───────────────────────────────────────
    //
    // The cases below have no counterpart in `tests/access.test.ts`. They
    // cover predicates and branches that exist here and were not exercised
    // there — `ownsShelterProfile` is exported by the reference module but
    // never imported by its test, and the staff check lives on this interface
    // in the port where it lived on a separate one before.

    [Fact]
    public async Task Checks_shelter_profile_ownership()
    {
        // sh1 belongs to u24. See db/devseed/D001_demo_data.sql.
        Assert.True(await _access.OwnsShelterProfileAsync("u24", "sh1"));
        Assert.False(await _access.OwnsShelterProfileAsync("u25", "sh1"));
        Assert.False(await _access.OwnsShelterProfileAsync("u24", "ghost"));
    }

    [Fact]
    public async Task A_user_holding_both_profiles_still_reaches_the_vet_branch()
    {
        // The fall-through that a `return booked` instead of `if (booked)`
        // would silently break: one account may be both a caretaker and a vet,
        // and failing the caretaker branch must not end the question.
        //
        // u17 already holds vet profile v1 and a qualifying appointment for p1.
        // Give them a caretaker profile with no booking for p1 at all, so the
        // caretaker branch is entered and declines.
        await ExecuteAsync(
            """
            INSERT INTO caretaker_profiles VALUES
              ('c_dual', @user, 'Also a caretaker', '{walking}', 5, '{dog}',
               true, false, true, '{}', 'clear', 5.0, 0, 100)
            """,
            new { user = VetUser });

        Assert.True(await _access.CanViewPetAsync(VetUser, Pet));
    }

    [Fact]
    public async Task A_cancelled_appointment_does_not_grant_record_access()
    {
        await ExecuteAsync(
            """UPDATE vet_appointments SET status = 'cancelled' WHERE "petId" = @pet""",
            new { pet = Pet });

        Assert.False((await _access.CanAccessPetRecordsAsync(VetUser, Pet)).Allowed);
    }

    [Fact]
    public async Task A_requested_booking_already_grants_the_view()
    {
        // b1 is seeded as `requested`, not `accepted`. Only `declined` and
        // `cancelled` void an engagement — a sitter deciding whether to accept
        // needs to read what they are being asked to do.
        var status = await ScalarAsync("SELECT status FROM bookings WHERE id = 'b1'");

        Assert.Equal("requested", status);
        Assert.True(await _access.CanViewPetAsync(CaretakerUser, Pet));
    }

    [Fact]
    public async Task A_missing_profile_does_not_match_a_missing_caller()
    {
        // Both lookups answer null — the profile has no row, the caller has no
        // id — and a plain equality comparison would call that a match. The
        // reference implementation has the same shape (`undefined ===
        // undefined`) and is saved only by every call site passing a real id.
        Assert.False(await _access.OwnsCaretakerProfileAsync(null!, "ghost"));
        Assert.False(await _access.OwnsVetProfileAsync(null!, "ghost"));
        Assert.False(await _access.OwnsShelterProfileAsync(null!, "ghost"));
        Assert.False(await _access.OwnsCaretakerProfileAsync("", "ghost"));
        Assert.False(await _access.IsBookingParticipantAsync(null!, "b1"));
        Assert.False(await _access.IsAppointmentParticipantAsync(null!, "a3"));
        Assert.False(await _access.OwnsPetAsync(null!, Pet));
        Assert.False(await _access.CanViewPetAsync(null!, Pet));
        Assert.False((await _access.CanAccessPetRecordsAsync(null!, Pet)).Allowed);
    }

    [Fact]
    public async Task Admin_satisfies_every_staff_check()
    {
        await ExecuteAsync(
            """UPDATE users SET "staffRoles" = '{admin}' WHERE id = @id""",
            new { id = Stranger });

        Assert.True(await _access.HasStaffRoleAsync(Stranger, StaffRoles.Finance));
        Assert.True(await _access.HasStaffRoleAsync(Stranger, StaffRoles.Ops));
        Assert.True(await _access.HasStaffRoleAsync(Stranger, StaffRoles.Admin));
    }

    [Fact]
    public async Task A_suspended_administrator_is_not_an_administrator()
    {
        await ExecuteAsync(
            """UPDATE users SET "staffRoles" = '{admin}', status = 'suspended' WHERE id = @id""",
            new { id = Stranger });

        Assert.False(await _access.HasStaffRoleAsync(Stranger, StaffRoles.Admin));
    }

    [Fact]
    public async Task An_ordinary_customer_holds_no_staff_role()
    {
        Assert.False(await _access.HasStaffRoleAsync(Owner, StaffRoles.Support));
        Assert.False(await _access.HasStaffRoleAsync("ghost", StaffRoles.Support));
    }

    [Fact]
    public async Task A_predicate_enlists_in_the_callers_transaction()
    {
        // The scope parameter exists for the re-check on a write: a service
        // that transfers a pet and then verifies the result must see its own
        // uncommitted UPDATE. Run outside the transaction, this check would
        // still read the old owner and wave the write through.
        var unitOfWork = _core.Get<IUnitOfWork>();
        await using var scope = await unitOfWork.BeginAsync();

        await scope.Connection.ExecuteAsync(
            new CommandDefinition(
                """UPDATE pets SET "ownerId" = @to WHERE id = @pet""",
                new { to = Stranger, pet = Pet }, scope.Transaction));

        Assert.True(await _access.OwnsPetAsync(Stranger, Pet, scope));

        // ...and nothing outside it sees the change until it commits.
        Assert.True(await _access.OwnsPetAsync(Owner, Pet));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /// <summary>What an adoption does, reduced to the one write that matters.</summary>
    private Task TransferToAsync(string userId, string petId = Pet)
        => ExecuteAsync(
            """
            UPDATE pets SET "ownerId" = @userId, "ownedSince" = @now WHERE id = @petId
            """,
            new { userId, petId, now = Ids.Now() });

    private Task CreateAppointmentAsync(string id, string ownerId, string vetId, string petId)
        => ExecuteAsync(
            """
            INSERT INTO vet_appointments (
                id, "ownerId", "vetId", "petId", mode, reason, symptoms,
                "startDateTime", "endDateTime", status, notes,
                "createdAt", "baseFeeCents", "feeCents")
            VALUES (
                @id, @ownerId, @vetId, @petId, 'in_clinic', 'New visit', '{}',
                @start, @end, 'confirmed', '',
                @now, 9000, 9000)
            """,
            new
            {
                id, ownerId, vetId, petId,
                start = Ids.Now().AddDays(1),
                end = Ids.Now().AddDays(1).AddMinutes(30),
                now = Ids.Now(),
            });

    /// <summary>
    /// The slugs this pet is currently authorised for, by the rule in the
    /// reference project's <c>activePrescriptions</c>: a <c>prescription</c>
    /// record that has not expired and has not used up its refills.
    ///
    /// Inlined here rather than called, because the module that owns it —
    /// <c>lib/server/medical-records.ts</c> — is M3, and M2 is required to land
    /// before anything depends on it. When M3 ports that module this becomes a
    /// call to it, and the assertions above should not need to change.
    /// </summary>
    private async Task<string[]> AuthorizedProductSlugsAsync(string petId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var slugs = await conn.QueryAsync<string>(
            """
            SELECT DISTINCT unnest("productSlugs") AS slug
            FROM medical_records
            WHERE "petId" = @petId
              AND type = 'prescription'
              AND ("expiresAt" IS NULL OR "expiresAt" > @now)
              AND "refillsLeft" IS DISTINCT FROM 0
            """,
            new { petId, now = Ids.Now() });

        return [.. slugs.Order()];
    }

    private async Task<int> CountRecordsAsync(string petId)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<int>(
            """SELECT count(*) FROM medical_records WHERE "petId" = @petId""",
            new { petId });
    }

    private async Task ExecuteAsync(string sql, object? parameters = null)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(sql, parameters);
    }

    private async Task<string?> ScalarAsync(string sql, object? parameters = null)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        return await conn.ExecuteScalarAsync<string?>(sql, parameters);
    }
}
