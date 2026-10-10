using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/vets.test.ts</c>, rewritten around SQL search the same
/// way <see cref="CaretakerServiceTests"/> was.
///
/// ── The departure that matters ──
///
/// The reference implementation read every vet row with its availability and
/// its user, then filtered and sorted the array in Node. That is a table scan
/// plus a full materialisation, and it cannot paginate — the page boundary is
/// decided after the work is done. REQUIREMENTS.md V3 says the search is
/// executed in SQL, so the assertions about ordering and filtering are made
/// against a paginated result, and two tests walk a whole result set one page at
/// a time and assert it equals the unpaginated list.
///
/// The reference's <c>upsertVetProfile</c> tests carry over almost unchanged,
/// with one addition it has no counterpart for: a vet cannot set their own
/// <c>verificationStatus</c> (REQUIREMENTS.md V11).
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class VetServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string VetUser = "u17";   // vet profile v1, South Austin
    private const string Owner = "u1";      // has no vet profile

    /// <summary>Austin, which is where v1 and v2 are.</summary>
    private const double AustinLat = 30.2672;
    private const double AustinLng = -97.7431;

    private CoreHost _core = null!;
    private IVetService _vets = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _vets = _core.Get<IVetService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private Task<VetSearchPage> SearchAsync(VetSearchQuery query)
        => _vets.SearchAsync(query with { Limit = 100 });

    private static string[] IdsOf(VetSearchPage page)
        => [.. page.Items.Select(v => v.Profile.Id)];

    // ── Search ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Returns_every_seeded_vet_when_unfiltered()
    {
        var page = await SearchAsync(new VetSearchQuery());

        Assert.Equal(4, page.Items.Length);
        Assert.All(page.Items, v => Assert.NotNull(v.User));
    }

    [Fact]
    public async Task Sorts_by_rating_when_no_origin_is_given()
    {
        var page = await SearchAsync(new VetSearchQuery());

        for (var i = 1; i < page.Items.Length; i++)
        {
            Assert.True(
                page.Items[i - 1].Profile.Rating >= page.Items[i].Profile.Rating,
                "unfiltered search is best-rated first");
        }
    }

    [Fact]
    public async Task Sorts_by_distance_to_the_clinic_when_a_location_is_given()
    {
        // To the *clinic*, not the vet's home address — that is the address an
        // owner actually has to drive to.
        var page = await SearchAsync(new VetSearchQuery(Lat: AustinLat, Lng: AustinLng));

        Assert.Equal("Austin", page.Items[0].Profile.Clinic.City);

        for (var i = 1; i < page.Items.Length; i++)
        {
            Assert.True(
                page.Items[i - 1].DistanceMiles <= page.Items[i].DistanceMiles,
                "a located search is nearest first");
        }
    }

    [Fact]
    public async Task Reports_no_distance_when_no_location_was_given()
    {
        var page = await SearchAsync(new VetSearchQuery());
        Assert.All(page.Items, v => Assert.Null(v.DistanceMiles));
    }

    [Fact]
    public async Task Filters_by_specialty()
    {
        var page = await SearchAsync(new VetSearchQuery(Specialty: VetSpecialties.Dermatology));

        Assert.Equal(["v2"], IdsOf(page));
    }

    [Fact]
    public async Task Filters_by_consult_mode()
    {
        var page = await SearchAsync(new VetSearchQuery(Mode: ConsultModes.HomeVisit));

        Assert.Equal(["v4"], IdsOf(page));
    }

    [Fact]
    public async Task Filters_by_accepted_species()
    {
        var page = await SearchAsync(new VetSearchQuery(Species: Species.Other));

        Assert.Equal(["v4"], IdsOf(page));
    }

    [Fact]
    public async Task Filters_to_emergency_capable_clinics_only()
    {
        var page = await SearchAsync(new VetSearchQuery(EmergencyOnly: true));

        Assert.Equal(2, page.Items.Length);
        Assert.All(page.Items, v => Assert.True(v.Profile.EmergencyAvailable));
    }

    [Fact]
    public async Task Not_asking_for_emergency_cover_excludes_nobody()
    {
        // One-way filter: asking narrows the list, not asking does not exclude
        // the clinics that offer it.
        var page = await SearchAsync(new VetSearchQuery());

        Assert.Contains(page.Items, v => v.Profile.EmergencyAvailable);
        Assert.Contains(page.Items, v => !v.Profile.EmergencyAvailable);
    }

    [Fact]
    public async Task Applies_a_radius_around_the_origin()
    {
        var page = await SearchAsync(new VetSearchQuery(
            Lat: AustinLat, Lng: AustinLng, RadiusMiles: 25));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, v => Assert.Equal("TX", v.Profile.Clinic.State));
    }

    [Fact]
    public async Task Combines_filters()
    {
        var page = await SearchAsync(new VetSearchQuery(
            Specialty: VetSpecialties.General, Species: Species.Cat));

        Assert.Equal(["v1", "v2", "v4"], IdsOf(page).Order());
    }

    [Fact]
    public async Task A_search_result_carries_only_the_public_projection_of_the_person()
    {
        // A search result carrying an email address and home coordinates is the
        // mistake M1 fixed on GET /users/{id}. It would come straight back here.
        var page = await SearchAsync(new VetSearchQuery());

        Assert.All(page.Items, v =>
        {
            Assert.NotEmpty(v.User.Name);
            Assert.NotNull(v.User.Address);
        });
    }

    // ── Pagination ───────────────────────────────────────────────────────

    [Fact]
    public async Task Pages_by_rating_without_repeating_or_skipping()
    {
        var all = IdsOf(await SearchAsync(new VetSearchQuery()));

        Assert.Equal(all, await WalkAsync(new VetSearchQuery()));
    }

    [Fact]
    public async Task Pages_by_distance_without_repeating_or_skipping()
    {
        var located = new VetSearchQuery(Lat: AustinLat, Lng: AustinLng);
        var all = IdsOf(await SearchAsync(located));

        Assert.Equal(all, await WalkAsync(located));
    }

    /// <summary>
    /// The whole result set, one row per page. The <c>(sortKey, id)</c>
    /// tie-break is what makes this hold — two clinics with identical ratings
    /// still have a strict order, so no row can be skipped or repeated across a
    /// boundary.
    /// </summary>
    private async Task<List<string>> WalkAsync(VetSearchQuery query)
    {
        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _vets.SearchAsync(query with { Cursor = cursor, Limit = 1 });
            seen.AddRange(IdsOf(page));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(seen.Distinct(), seen);
        return seen;
    }

    [Fact]
    public async Task A_garbled_cursor_starts_from_the_beginning()
    {
        // A cursor names a position in a public result set, not a credential.
        // Rejecting a garbled one gives a caller a way to probe and an honest
        // client a dead end when a bookmark ages out.
        var fresh = IdsOf(await SearchAsync(new VetSearchQuery()));
        var garbled = IdsOf(await SearchAsync(new VetSearchQuery(Cursor: "not-a-cursor")));

        Assert.Equal(fresh, garbled);
    }

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Gets_a_vet_by_profile_id_joined_with_its_user()
    {
        var vet = await _vets.GetAsync("v1");

        Assert.Equal("South Austin Animal Hospital", vet!.Profile.ClinicName);
        Assert.Equal("Dr. Naomi Ruiz", vet.User.Name);
        Assert.NotEmpty(vet.Profile.Availability);
    }

    [Fact]
    public async Task Returns_null_for_an_unknown_vet()
    {
        Assert.Null(await _vets.GetAsync("nope"));
    }

    [Fact]
    public async Task Gets_a_vet_by_user_id()
    {
        var profile = await _vets.GetByUserAsync("u18");
        Assert.Equal("v2", profile!.Id);
    }

    [Fact]
    public async Task Returns_null_when_the_user_has_no_vet_profile()
    {
        Assert.Null(await _vets.GetByUserAsync(Owner));
    }

    [Fact]
    public async Task Sorts_availability_days_chronologically()
    {
        var vet = await _vets.GetAsync("v1");
        var dates = vet!.Profile.Availability.Select(d => d.Date).ToArray();

        Assert.Equal(dates.Order(), dates);
    }

    [Fact]
    public async Task The_consult_fee_crosses_to_usd_exactly_once()
    {
        // The column is 8500 integer cents; the contract says USD.
        var vet = await _vets.GetAsync("v1");
        Assert.Equal(85m, vet!.Profile.ConsultFee);
    }

    [Fact]
    public async Task The_clinic_reads_both_flat_and_nested()
    {
        // `clinicName` and `clinic.name` are the same column. The columns are
        // flat because Prisma emitted them that way; the nested object is what
        // web/src/types/index.ts declares, so the DTO carries both.
        var vet = await _vets.GetAsync("v1");

        Assert.Equal(vet!.Profile.ClinicName, vet.Profile.Clinic.Name);
        Assert.Equal("Austin", vet.Profile.Clinic.City);
    }

    // ── Upsert ───────────────────────────────────────────────────────────

    private static VetPatchRequest Patch() => new(
        Bio: null, Specialties: null, LicenseNumber: null, LicenseState: null,
        YearsExperience: null, AcceptedSpecies: null, ConsultModes: null,
        ConsultFee: null, EmergencyAvailable: null, Clinic: null, Availability: null);

    [Fact]
    public async Task Patches_scalar_fields_on_an_existing_profile()
    {
        var (profile, failure) = await _vets.UpsertAsync(
            VetUser, VetUser, Patch() with { Bio = "New bio", ConsultFee = 95m });

        Assert.Null(failure);
        Assert.Equal("New bio", profile!.Bio);
        Assert.Equal(95m, profile.ConsultFee);

        // Untouched fields survive.
        Assert.Contains(VetSpecialties.General, profile.Specialties);
    }

    [Fact]
    public async Task Flattens_the_nested_clinic_object_into_columns()
    {
        var (profile, _) = await _vets.UpsertAsync(
            VetUser, VetUser,
            Patch() with { Clinic = new ClinicDto("New Clinic", "Round Rock", "TX", 30.5, -97.7) });

        Assert.Equal("New Clinic", profile!.ClinicName);
        Assert.Equal("Round Rock", profile.Clinic.City);
        Assert.Equal(30.5, profile.Clinic.Lat);
    }

    [Fact]
    public async Task Replaces_the_whole_availability_set_rather_than_merging()
    {
        var (profile, _) = await _vets.UpsertAsync(
            VetUser, VetUser,
            Patch() with
            {
                Availability =
                [
                    new AvailabilityDayDto(
                        new DateOnly(2026, 9, 1), [new SlotDto("09:00", "12:00")]),
                ],
            });

        var day = Assert.Single(profile!.Availability);
        Assert.Equal(new DateOnly(2026, 9, 1), day.Date);
        Assert.Equal("09:00", Assert.Single(day.Slots).Start);
    }

    [Fact]
    public async Task Creates_a_profile_for_a_user_who_has_none_yet()
    {
        var (profile, failure) = await _vets.UpsertAsync(
            Owner, Owner, Patch() with { Bio = "Newly qualified" });

        Assert.Null(failure);
        Assert.StartsWith("v_", profile!.Id);
        Assert.Equal(Owner, profile.UserId);
        Assert.Equal("Newly qualified", profile.Bio);
        Assert.Equal(0m, profile.ConsultFee);
    }

    [Fact]
    public async Task A_new_profile_starts_unverified()
    {
        // The honest default. A profile is a claim until somebody checks it,
        // and nothing about signing up should make it look otherwise.
        var (profile, _) = await _vets.UpsertAsync(Owner, Owner, Patch());

        Assert.Equal(BackgroundCheckStatuses.None, profile!.VerificationStatus);
        Assert.Empty(profile.LicenseNumber);
        Assert.Equal(100, profile.ResponseRatePct);
    }

    [Fact]
    public async Task Leaves_the_profile_untouched_for_an_empty_patch()
    {
        var before = await _vets.GetByUserAsync(VetUser);
        var (after, _) = await _vets.UpsertAsync(VetUser, VetUser, Patch());

        // Compared as JSON rather than with Assert.Equal. A positional record's
        // generated equality is memberwise, and three of these members are
        // arrays — which compare by reference, so two structurally identical
        // profiles read from the database twice are never `Equal`. The
        // reference suite's `toEqual` is a deep comparison; this is the same
        // question asked in a way C# will answer.
        Assert.Equal(Json(before), Json(after));
    }

    private static string Json(object? value)
        => System.Text.Json.JsonSerializer.Serialize(value);

    [Fact]
    public async Task Refuses_an_edit_to_somebody_elses_profile()
    {
        var (profile, failure) = await _vets.UpsertAsync(
            Owner, VetUser, Patch() with { Bio = "Taking this over." });

        Assert.Null(profile);
        Assert.Equal(VetFailure.NotYours, failure);
    }

    [Fact]
    public async Task A_vet_cannot_verify_their_own_licence()
    {
        // REQUIREMENTS.md V11, enforced by absence rather than by a check:
        // VetPatchRequest has no verificationStatus, the UPDATE does not name
        // the column, and staff set it in M9. A licence badge its holder can
        // grant themselves is not a badge.
        Assert.DoesNotContain(
            typeof(VetPatchRequest).GetProperties(),
            p => p.Name.Contains("Verification", StringComparison.OrdinalIgnoreCase));

        var before = (await _vets.GetByUserAsync(VetUser))!.VerificationStatus;
        var (after, _) = await _vets.UpsertAsync(
            VetUser, VetUser, Patch() with { LicenseNumber = "TX-VM-00000" });

        Assert.Equal(before, after!.VerificationStatus);
    }

    [Fact]
    public async Task A_vet_cannot_award_themselves_a_reputation()
    {
        // The same rule as a caretaker's, for the same reason: the three
        // derived columns are absent from the patch type, so there is nowhere
        // to put one.
        var properties = typeof(VetPatchRequest).GetProperties().Select(p => p.Name).ToArray();

        Assert.DoesNotContain("Rating", properties);
        Assert.DoesNotContain("ReviewCount", properties);
        Assert.DoesNotContain("ResponseRatePct", properties);
    }
}
