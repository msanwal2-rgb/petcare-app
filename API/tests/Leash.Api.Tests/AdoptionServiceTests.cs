using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Shelters, listings, applications and the adoption fee — the rules the
/// reference keeps in <c>lib/server/adoptions/{listings,applications,payment}.ts</c>
/// and <c>lib/server/shelters.ts</c>, which it had no suite for. The transfer
/// itself is <see cref="AdoptionTransferTests"/>.
///
/// Fixtures: sh1 (u24) lists Marlow (p13, al1, $50, aa1 submitted by u3) and
/// Pepper (p14, al2, $25, aa2 under review for u5); sh2 (u25) has Juniper
/// (p15, al3 pending, aa3 approved for u4, $150).
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AdoptionServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Apa = "u24";       // sh1
    private const string HillCountry = "u25"; // sh2
    private const string Maya = "u1";

    private CoreHost _core = null!;
    private IAdoptionListingService _listings = null!;
    private IAdoptionApplicationService _applications = null!;
    private IShelterService _shelters = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _listings = _core.Get<IAdoptionListingService>();
        _applications = _core.Get<IAdoptionApplicationService>();
        _shelters = _core.Get<IShelterService>();
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

    private static ListingSearchQuery Query(
        string? species = null, string? shelterId = null, string? kids = null, string? cats = null,
        double? lat = null, double? lng = null, double? radius = null, string? q = null,
        string? cursor = null, int limit = 24)
        => new(lat, lng, radius, species, shelterId, kids, null, cats, null, null, q, cursor, limit);

    private static CreateApplicationRequest Apply(string listingId) => new(
        listingId, 2, 0, false, null, "house", true, true, 4, "Lots", "Hello");

    /// <summary>A shelter animal of u24's that is not yet listed.</summary>
    private Task NewShelterPetAsync(string id = "p_new", string owner = Apa) => Exec("""
        INSERT INTO pets (id, "ownerId", "ownedSince", name, species, breed, sex, dob, "weightLbs",
                          "photoUrl", vaccinated, allergies, medications, "behaviorNotes",
                          "feedingInstructions", "vetName", "vetPhone")
        VALUES (@id, @owner, now(), 'Biscotti', 'cat', 'Tabby', 'male', '2022-01-01', 10, '', true,
                '{}', '{}', '', '', '', '')
        """, new { id, owner });

    // ── The directory ────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_only_available_animals_longest_waiting_first()
    {
        var page = await _listings.SearchAsync(Query());

        // al3 is pending (somebody is approved), so it is not on offer.
        Assert.Equal(["al1", "al2"], page.Items.Select(i => i.Listing.Id));
        Assert.Equal(2, page.Total);
        Assert.Equal("Austin Pets Alive", page.Items[0].ShelterName);
        Assert.Equal("Marlow", page.Items[0].Pet.Name);
    }

    [Fact]
    public async Task Filters_on_a_definite_yes_only()
    {
        // al1 is "unknown" with cats; asking for cat-friendly must not include it.
        var page = await _listings.SearchAsync(Query(cats: "yes"));
        Assert.Equal(["al2"], page.Items.Select(i => i.Listing.Id));
    }

    [Fact]
    public async Task Filters_by_species_text_and_shelter()
    {
        Assert.Equal(["al2"], (await _listings.SearchAsync(Query(species: "cat"))).Items.Select(i => i.Listing.Id));
        Assert.Equal(["al1"], (await _listings.SearchAsync(Query(q: "beagle"))).Items.Select(i => i.Listing.Id));
        Assert.Empty((await _listings.SearchAsync(Query(shelterId: "sh2"))).Items);
    }

    [Fact]
    public async Task Counts_the_radius_into_the_total_and_reports_distance()
    {
        // Austin is ~0 miles from al1/al2; nowhere near Portland.
        var near = await _listings.SearchAsync(Query(lat: 30.2672, lng: -97.7431, radius: 60));
        Assert.Equal(2, near.Total);
        Assert.All(near.Items, i => Assert.True(i.DistanceMiles < 5));

        var far = await _listings.SearchAsync(Query(lat: 45.5231, lng: -122.6765, radius: 60));
        Assert.Equal(0, far.Total);
        Assert.Empty(far.Items);
    }

    [Fact]
    public async Task Pages_with_a_cursor_without_repeating_a_row()
    {
        var first = await _listings.SearchAsync(Query(limit: 1));
        Assert.Single(first.Items);
        Assert.NotNull(first.NextCursor);

        var second = await _listings.SearchAsync(Query(limit: 1, cursor: first.NextCursor));
        Assert.Single(second.Items);
        Assert.NotEqual(first.Items[0].Listing.Id, second.Items[0].Listing.Id);
        Assert.Null(second.NextCursor);
    }

    [Fact]
    public async Task Shows_a_draft_only_to_its_own_shelter()
    {
        await Exec("UPDATE adoption_listings SET status = 'draft' WHERE id = 'al1'");

        Assert.Null(await _listings.GetAsync(null, "al1"));
        Assert.Null(await _listings.GetAsync(Maya, "al1"));
        Assert.NotNull(await _listings.GetAsync(Apa, "al1"));

        // An adopted animal's page still answers, so it can say so.
        Assert.NotNull(await _listings.GetAsync(null, "al3"));
    }

    // ── Listing an animal ────────────────────────────────────────────────

    [Fact]
    public async Task Lists_an_animal_the_shelter_owns_as_a_draft_at_the_shelters_address()
    {
        await NewShelterPetAsync();

        var (listing, refusal) = await _listings.CreateAsync(Apa, new CreateListingRequest(
            "p_new", 3000, "A lap cat", null, null, null, "yes", null, null,
            null, null, null, null, null, null, null, null, null));

        Assert.Null(refusal);
        Assert.Equal(ListingStatuses.Draft, listing!.Listing.Status);
        Assert.Equal("Austin", listing.Listing.Location.City);
        Assert.Equal(TriStates.Unknown, listing.Listing.GoodWithKids);
        Assert.Equal(TriStates.Yes, listing.Listing.GoodWithCats);
        Assert.Equal(3000, listing.Listing.FeeCents);
    }

    [Fact]
    public async Task Refuses_to_list_somebody_elses_animal_or_one_already_listed()
    {
        var empty = new CreateListingRequest("p1", null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null);

        // Biscuit is Maya's dog.
        Assert.Equal(AdoptionFailure.PetNotYours, (await _listings.CreateAsync(Apa, empty)).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.NoShelterProfile, (await _listings.CreateAsync(Maya, empty)).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.AlreadyListed,
            (await _listings.CreateAsync(Apa, empty with { PetId = "p13" })).Refusal!.Kind);
    }

    [Fact]
    public async Task Moves_a_listing_only_along_its_machine_and_only_for_its_shelter()
    {
        var (_, wrong) = await _listings.SetStatusAsync(HillCountry, "al1", ListingStatuses.Withdrawn);
        Assert.Equal(AdoptionFailure.NotYours, wrong!.Kind);

        var (withdrawn, _) = await _listings.SetStatusAsync(Apa, "al1", ListingStatuses.Withdrawn);
        Assert.Equal(ListingStatuses.Withdrawn, withdrawn!.Listing.Status);
        Assert.NotNull(withdrawn.Listing.ClosedAt);

        var (_, illegal) = await _listings.SetStatusAsync(Apa, "al1", ListingStatuses.Adopted);
        Assert.Equal(AdoptionFailure.InvalidTransition, illegal!.Kind);

        var (relisted, _) = await _listings.SetStatusAsync(Apa, "al1", ListingStatuses.Available);
        Assert.Equal(ListingStatuses.Available, relisted!.Listing.Status);
        Assert.Null(relisted.Listing.ClosedAt);
    }

    [Fact]
    public async Task Refuses_to_republish_an_animal_the_shelter_no_longer_owns()
    {
        await Exec("""UPDATE adoption_listings SET status = 'withdrawn' WHERE id = 'al1'""");
        await Exec("""UPDATE pets SET "ownerId" = 'u1' WHERE id = 'p13'""");

        var (_, refusal) = await _listings.SetStatusAsync(Apa, "al1", ListingStatuses.Available);
        Assert.Equal(AdoptionFailure.NotShelterOwned, refusal!.Kind);
    }

    [Fact]
    public async Task Edits_a_listing_without_touching_its_status()
    {
        var (edited, refusal) = await _listings.UpdateAsync(Apa, "al1", new UpdateListingRequest(
            7500, "New headline", null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null));

        Assert.Null(refusal);
        Assert.Equal(7500, edited!.Listing.FeeCents);
        Assert.Equal("New headline", edited.Listing.Headline);
        Assert.Equal(ListingStatuses.Available, edited.Listing.Status);

        Assert.Equal(AdoptionFailure.NotYours, (await _listings.UpdateAsync(Maya, "al1",
            new UpdateListingRequest(1, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null))).Refusal!.Kind);
    }

    // ── Applying ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Applies_snapshotting_the_animal_and_telling_the_shelter()
    {
        var (application, refusal) = await _applications.CreateAsync(Maya, Apply("al1"));

        Assert.Null(refusal);
        Assert.Equal(ApplicationStatuses.Submitted, application!.Status);
        Assert.Equal("Marlow", application.PetName);
        Assert.Equal(5000, application.FeeCents);
        Assert.Equal("sh1", application.ShelterId);

        Assert.Equal("/dashboard", await One<string>(
            """SELECT href FROM notifications WHERE "userId" = 'u24' AND kind = 'adoption_application_received'"""));
    }

    [Fact]
    public async Task Refuses_a_second_open_application_an_unavailable_animal_and_its_own_shelter()
    {
        await _applications.CreateAsync(Maya, Apply("al1"));

        Assert.Equal(AdoptionFailure.Duplicate, (await _applications.CreateAsync(Maya, Apply("al1"))).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.ListingUnavailable, (await _applications.CreateAsync(Maya, Apply("al3"))).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.OwnListing, (await _applications.CreateAsync(Apa, Apply("al1"))).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.ListingNotFound, (await _applications.CreateAsync(Maya, Apply("ghost"))).Refusal!.Kind);
    }

    [Fact]
    public async Task Allows_reapplying_after_a_rejection()
    {
        await _applications.UpdateStatusAsync(Apa, "aa1", ApplicationStatuses.Rejected, "Not this time");

        var (again, refusal) = await _applications.CreateAsync("u3", Apply("al1"));
        Assert.Null(refusal);
        Assert.NotEqual("aa1", again!.Id);
    }

    [Fact]
    public async Task Shows_an_application_to_either_side_and_nobody_else()
    {
        Assert.NotNull((await _applications.GetAsync("u3", "aa1")).Application);
        Assert.NotNull((await _applications.GetAsync(Apa, "aa1")).Application);
        Assert.Equal(AdoptionFailure.NotFound, (await _applications.GetAsync(Maya, "aa1")).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.NotFound, (await _applications.GetAsync(HillCountry, "aa1")).Refusal!.Kind);
    }

    [Fact]
    public async Task Gives_the_shelter_its_queue_oldest_first_with_who_is_asking()
    {
        var (page, refusal) = await _applications.ListForShelterAsync(Apa, null, null, 50);

        Assert.Null(refusal);
        Assert.Equal(["aa2", "aa1"], page!.Items.Select(i => i.Application.Id));
        Assert.Equal("Sofia Marino", page.Items[0].Applicant.Name);
        Assert.Null(page.Items[0].PaymentStatus);

        Assert.Equal(AdoptionFailure.NoShelterProfile,
            (await _applications.ListForShelterAsync(Maya, null, null, 50)).Refusal!.Kind);
    }

    [Fact]
    public async Task Lists_the_applicants_own_newest_first()
    {
        await _applications.CreateAsync("u4", Apply("al1"));
        var page = await _applications.ListMineAsync("u4", null, 50);

        Assert.Equal(2, page.Items.Length);
        Assert.Equal("aa3", page.Items[1].Id);
    }

    // ── Deciding ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Lets_the_shelter_decide_and_the_applicant_only_withdraw()
    {
        Assert.Equal(AdoptionFailure.WrongActor,
            (await _applications.UpdateStatusAsync("u3", "aa1", ApplicationStatuses.UnderReview, null)).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.WrongActor,
            (await _applications.UpdateStatusAsync(Apa, "aa1", ApplicationStatuses.Withdrawn, null)).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.NotFound,
            (await _applications.UpdateStatusAsync(Maya, "aa1", ApplicationStatuses.Withdrawn, null)).Refusal!.Kind);

        var (reviewing, _) = await _applications.UpdateStatusAsync(Apa, "aa1", ApplicationStatuses.UnderReview, null);
        Assert.Equal(ApplicationStatuses.UnderReview, reviewing!.Status);

        var (withdrawn, _) = await _applications.UpdateStatusAsync("u3", "aa1", ApplicationStatuses.Withdrawn, null);
        Assert.Equal(ApplicationStatuses.Withdrawn, withdrawn!.Status);
    }

    [Fact]
    public async Task Refuses_an_illegal_move_and_cannot_complete_by_status()
    {
        var (_, skip) = await _applications.UpdateStatusAsync(Apa, "aa1", ApplicationStatuses.Approved, null);
        Assert.Equal(AdoptionFailure.InvalidTransition, skip!.Kind);

        var (_, complete) = await _applications.UpdateStatusAsync(HillCountry, "aa3", ApplicationStatuses.Completed, null);
        Assert.Equal(AdoptionFailure.InvalidTransition, complete!.Kind);
    }

    [Fact]
    public async Task Approving_takes_the_animal_off_the_market_and_tells_the_applicant()
    {
        var (approved, refusal) = await _applications.UpdateStatusAsync(Apa, "aa2", ApplicationStatuses.Approved, "Come and meet her");

        Assert.Null(refusal);
        Assert.Equal("Come and meet her", approved!.DecisionNote);
        Assert.Equal(ListingStatuses.Pending, await One<string>("SELECT status FROM adoption_listings WHERE id = 'al2'"));
        Assert.Equal("/adoptions/aa2", await One<string>(
            """SELECT href FROM notifications WHERE "userId" = 'u5' AND kind = 'adoption_approved'"""));
    }

    [Fact]
    public async Task Approves_at_most_one_application_per_animal()
    {
        await Exec("""
            INSERT INTO adoption_applications (id, "listingId", "shelterId", "petId", "petName",
                "petPhotoUrl", "applicantId", status, "feeCents", "homeType", "createdAt", "updatedAt")
            VALUES ('aa_second', 'al3', 'sh2', 'p15', 'Juniper', '', 'u6', 'under_review', 15000,
                    'house', now(), now())
            """);

        var (_, refusal) = await _applications.UpdateStatusAsync(HillCountry, "aa_second", ApplicationStatuses.Approved, null);
        Assert.Equal(AdoptionFailure.AlreadyApproved, refusal!.Kind);
        Assert.Equal("aa3", refusal.ApplicationId);
    }

    [Fact]
    public async Task Withdrawing_after_approval_relists_and_refunds()
    {
        var (payment, _) = await _applications.StartPaymentAsync("u4", "aa3");
        Assert.Equal(PaymentStatuses.Paid, payment!.Status);

        var (withdrawn, refusal) = await _applications.UpdateStatusAsync("u4", "aa3", ApplicationStatuses.Withdrawn, null);

        Assert.Null(refusal);
        Assert.Equal(ApplicationStatuses.Withdrawn, withdrawn!.Status);
        Assert.Equal(ListingStatuses.Available, await One<string>("SELECT status FROM adoption_listings WHERE id = 'al3'"));
        Assert.Equal(PaymentStatuses.Refunded, await One<string>(
            """SELECT status FROM payments WHERE "adoptionApplicationId" = 'aa3'"""));
    }

    [Fact]
    public async Task Moves_the_shelters_response_rate_as_it_answers()
    {
        // sh1 starts with aa1 waiting and aa2 answered: 50%.
        await _applications.UpdateStatusAsync(Apa, "aa1", ApplicationStatuses.UnderReview, null);
        Assert.Equal(100, await One<int>("""SELECT "responseRatePct" FROM shelter_profiles WHERE id = 'sh1'"""));

        await _applications.CreateAsync(Maya, Apply("al1"));
        Assert.Equal(67, await One<int>("""SELECT "responseRatePct" FROM shelter_profiles WHERE id = 'sh1'"""));
    }

    // ── The fee ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Takes_the_fee_through_the_ledger_once()
    {
        var (first, refusal) = await _applications.StartPaymentAsync("u4", "aa3");

        Assert.Null(refusal);
        Assert.Equal(PaymentStatuses.Paid, first!.Status);
        Assert.Equal("demo", first.Payment.Provider);

        var row = await One<(string Kind, int AmountCents, string UserId)>(
            """SELECT kind, "amountCents", "userId" FROM payments WHERE "adoptionApplicationId" = 'aa3'""");
        Assert.Equal((PaymentKinds.AdoptionFee, 15000, "u4"), row);

        Assert.Equal(AdoptionFailure.AlreadyPaid, (await _applications.StartPaymentAsync("u4", "aa3")).Refusal!.Kind);
    }

    [Fact]
    public async Task Refuses_the_fee_to_anyone_but_an_approved_applicant_and_for_a_waived_fee()
    {
        Assert.Equal(AdoptionFailure.NotApplicant, (await _applications.StartPaymentAsync(HillCountry, "aa3")).Refusal!.Kind);
        Assert.Equal(AdoptionFailure.NotApproved, (await _applications.StartPaymentAsync("u3", "aa1")).Refusal!.Kind);

        await Exec("""UPDATE adoption_applications SET "feeCents" = 0 WHERE id = 'aa3'""");
        Assert.Equal(AdoptionFailure.NoFee, (await _applications.StartPaymentAsync("u4", "aa3")).Refusal!.Kind);
    }

    [Fact]
    public async Task Shows_the_shelter_that_the_fee_is_paid()
    {
        await _applications.StartPaymentAsync("u4", "aa3");

        var (page, _) = await _applications.ListForShelterAsync(HillCountry, null, null, 50);
        Assert.Equal(PaymentStatuses.Paid, page!.Items.Single(i => i.Application.Id == "aa3").PaymentStatus);
    }

    // ── Shelter profiles ─────────────────────────────────────────────────

    [Fact]
    public async Task Creates_a_shelter_profile_unverified_and_edits_only_ones_own()
    {
        var (_, refusal) = await _shelters.UpsertAsync(Maya, Apa, new ShelterPatchRequest(
            "Mine", null, null, null, null, null, null, null, null, null, null));
        Assert.Equal(AdoptionFailure.NotYours, refusal!.Kind);

        var (created, _) = await _shelters.UpsertAsync(Maya, Maya, new ShelterPatchRequest(
            "Maya's Rescue", null, ShelterKinds.FosterNetwork, null, null, ["cat"], null, null, null,
            new ShelterAddressDto("1 Main St", "Austin", "TX", 30.27, -97.74), null));

        Assert.Equal("Maya's Rescue", created!.Name);
        Assert.Equal(BackgroundCheckStatuses.None, created.VerificationStatus);
        Assert.Equal(100, created.ResponseRatePct);
        Assert.Equal("Austin", created.Address.City);

        var (edited, _) = await _shelters.UpsertAsync(Maya, Maya, new ShelterPatchRequest(
            null, "We foster cats.", null, null, null, null, null, null, null, null, null));
        Assert.Equal("Maya's Rescue", edited!.Name);
        Assert.Equal("We foster cats.", edited.Bio);
        Assert.Equal(created.Id, edited.Id);
    }

    [Fact]
    public async Task Searches_shelters_with_their_available_counts()
    {
        var page = await _shelters.SearchAsync(new ShelterSearchQuery(
            null, null, null, null, null, false, false, null, 24));

        // sh1 has two animals available and leads; sh2's one is pending.
        Assert.Equal(["sh1", "sh2"], page.Items.Select(s => s.Profile.Id));
        Assert.Equal(2, page.Items[0].AvailableCount);
        Assert.Equal(0, page.Items[1].AvailableCount);

        var withAnimals = await _shelters.SearchAsync(new ShelterSearchQuery(
            null, null, null, null, null, true, false, null, 24));
        Assert.Equal(["sh1"], withAnimals.Items.Select(s => s.Profile.Id));
    }
}
