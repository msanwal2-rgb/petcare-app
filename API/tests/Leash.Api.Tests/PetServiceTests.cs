using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/pets.test.ts</c>, plus the operations REQUIREMENTS.md
/// section 5 asks for that the reference project never built — delete, and the
/// per-pet recommendation shelf.
///
/// Its <c>ownership is not something a patch can change</c> block is ported as
/// written. That block exists because of a real transfer backdoor: the patch
/// schema accepted <c>ownerId</c>, the update wrote it, and the route checked
/// only that the caller was the <i>outgoing</i> owner — so any user could hand
/// an animal to any user id, and the edit form spread <c>ownerId</c> into every
/// payload so a stale prop could do it by accident.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class PetServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Owner = "u1";          // Maya — owns p1 (Biscuit) and p2 (Miso)
    private const string Stranger = "u2";       // owns p3, nothing to do with p1
    private const string CaretakerUser = "u7";  // caretaker c1, booking b1 covers p1
    private const string VetUser = "u17";       // vet v1, appointments a3 + a8 for p1
    private const string LunaOwner = "u3";      // owns p4 (Luna) and p5

    private CoreHost _core = null!;
    private IPetService _pets = null!;
    private ICatalogService _catalog = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _pets = _core.Get<IPetService>();
        _catalog = _core.Get<ICatalogService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private static PetInputRequest NewPet() => new(
        Name: "New Pet",
        Species: "dog",
        Breed: "Beagle",
        Sex: "female",
        Dob: new DateOnly(2024, 1, 1),
        WeightLbs: 20,
        PhotoUrl: "https://example.com/p.jpg",
        Vaccinated: true,
        Allergies: [],
        Medications: [],
        BehaviorNotes: "Curious",
        FeedingInstructions: "1 cup twice daily",
        VetContact: new VetContactDto("Vet", "(555) 000-0000"));

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_an_owners_pets()
    {
        var pets = await _pets.ListMineAsync(Owner);
        Assert.Equal(["p1", "p2"], pets.Select(p => p.Id).Order());
    }

    [Fact]
    public async Task Returns_an_empty_list_for_an_owner_with_no_pets()
    {
        Assert.Empty(await _pets.ListMineAsync(CaretakerUser));
    }

    [Fact]
    public async Task Returns_a_pet_with_nested_vet_contact_and_arrays()
    {
        var pet = await _pets.GetAsync(LunaOwner, "p4");

        Assert.Equal("Luna", pet!.Name);
        Assert.Contains("Chicken", pet.Allergies);
        Assert.NotEmpty(pet.Medications);
        Assert.Equal(
            new VetContactDto("Cherry Creek Veterinary", "(303) 555-0722"),
            pet.VetContact);
    }

    [Fact]
    public async Task Returns_null_for_an_unknown_pet()
    {
        Assert.Null(await _pets.GetAsync(Owner, "nope"));
    }

    [Fact]
    public async Task Batch_resolves_pets_by_id_filtered_to_what_the_caller_may_see()
    {
        // The reference resolved all three blindly. Here u1 owns p1 but has no
        // claim on p3 or p9, so the batch answers with what they may see — an
        // unknown id and a forbidden one look identical from outside.
        var pets = await _pets.GetManyAsync(Owner, ["p1", "p3", "p9"]);

        Assert.Equal(["p1"], pets.Select(p => p.Id));
    }

    [Fact]
    public async Task Batch_resolves_every_pet_a_caretaker_is_entitled_to()
    {
        // The case the batch endpoint exists for. Caretaker c1 (u7) holds two
        // bookings from two different clients — b1 covers p1 and b4 covers p3 —
        // so both are legitimately theirs to read, and they belong to owners
        // who have nothing to do with each other.
        //
        // p2 is Maya's other cat, covered by no booking of theirs, so it is
        // filtered out of the same call: the batch is scoped per id, not per
        // owner.
        var pets = await _pets.GetManyAsync(CaretakerUser, ["p1", "p2", "p3"]);

        Assert.Equal(["p1", "p3"], pets.Select(p => p.Id).Order());
    }

    [Fact]
    public async Task Returns_an_empty_list_for_an_empty_id_list()
    {
        Assert.Empty(await _pets.GetManyAsync(Owner, []));
    }

    // ── Who may see a pet ────────────────────────────────────────────────

    [Fact]
    public async Task A_caretaker_with_a_booking_may_read_the_pet()
    {
        Assert.NotNull(await _pets.GetAsync(CaretakerUser, "p1"));
    }

    [Fact]
    public async Task A_treating_vet_may_read_the_pet()
    {
        Assert.NotNull(await _pets.GetAsync(VetUser, "p1"));
    }

    [Fact]
    public async Task A_stranger_may_not_read_the_pet()
    {
        // Not merely a filtered field list — nothing at all. The row carries
        // medications, allergies, behaviour notes and the household vet's phone
        // number, against ids that count upward from p1.
        Assert.Null(await _pets.GetAsync(Stranger, "p1"));
    }

    // ── Writes ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Creates_a_pet_under_the_calling_owner()
    {
        var created = await _pets.CreateAsync(Owner, NewPet());

        Assert.StartsWith("p_", created.Id);
        Assert.Equal(Owner, created.OwnerId);
        Assert.Equal(3, (await _pets.ListMineAsync(Owner)).Count);
    }

    [Fact]
    public async Task Updates_fields_and_nested_vet_contact()
    {
        var (pet, failure) = await _pets.UpdateAsync(
            Owner, "p1",
            new PetPatchRequest(
                null, null, null, null, null, WeightLbs: 70, null, null,
                null, null, null, null,
                VetContact: new VetContactDto("New Vet", "(1)")));

        Assert.Null(failure);
        Assert.Equal(70, pet!.WeightLbs);
        Assert.Equal("New Vet", pet.VetContact.Name);
    }

    [Fact]
    public async Task A_patch_leaves_every_field_it_omits_alone()
    {
        var before = await _pets.GetAsync(Owner, "p1");

        var (after, _) = await _pets.UpdateAsync(
            Owner, "p1", PatchOf(name: "Biscuit II"));

        Assert.Equal("Biscuit II", after!.Name);
        Assert.Equal(before!.Breed, after.Breed);
        Assert.Equal(before.Allergies, after.Allergies);
        Assert.Equal(before.Medications, after.Medications);
        Assert.Equal(before.FeedingInstructions, after.FeedingInstructions);
        Assert.Equal(before.VetContact, after.VetContact);
        Assert.Equal(before.Dob, after.Dob);
    }

    [Fact]
    public async Task Refuses_to_update_an_unknown_pet()
    {
        var (pet, failure) = await _pets.UpdateAsync(Owner, "ghost", PatchOf(name: "Rex"));

        Assert.Null(pet);
        Assert.Equal(PetFailure.NotFound, failure);
    }

    [Fact]
    public async Task Leaves_the_owner_alone_when_the_rest_of_the_patch_applies()
    {
        var before = await _pets.GetAsync(Owner, "p1");
        await _pets.UpdateAsync(Owner, "p1", PatchOf(name: "Biscuit II"));
        var after = await _pets.GetAsync(Owner, "p1");

        Assert.Equal("Biscuit II", after!.Name);
        Assert.Equal(before!.OwnerId, after.OwnerId);
    }

    [Fact]
    public async Task Stamps_owned_since_when_a_pet_is_created()
    {
        var created = await _pets.CreateAsync(Owner, NewPet());

        await using var conn = await db.DataSource.OpenConnectionAsync();
        var ownedSince = await conn.ExecuteScalarAsync<DateTimeOffset>(
            """SELECT "ownedSince" FROM pets WHERE id = @id""", new { id = created.Id });

        // Not the epoch. This owner really has had the animal since now, so a
        // caretaker booked before it existed gets nothing from it.
        Assert.NotEqual(DateTimeOffset.UnixEpoch, ownedSince.ToUniversalTime());
        Assert.True(ownedSince > DateTimeOffset.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task A_new_pet_grants_nobody_else_anything()
    {
        // The other half of stamping ownedSince: u7's booking b1 predates this
        // animal, so it must not reach it.
        var created = await _pets.CreateAsync(Owner, NewPet());

        Assert.Null(await _pets.GetAsync(CaretakerUser, created.Id));
        Assert.Null(await _pets.GetAsync(VetUser, created.Id));
    }

    // ── A sitter or vet may read a pet, and may not rewrite it ───────────

    [Fact]
    public async Task A_caretaker_may_not_edit_the_pet_they_are_sitting()
    {
        var (pet, failure) = await _pets.UpdateAsync(
            CaretakerUser, "p1", PatchOf(name: "Renamed"));

        Assert.Null(pet);
        // NotOwner, not NotFound: they can already see the animal, so saying
        // "not yours" tells them nothing they did not know.
        Assert.Equal(PetFailure.NotOwner, failure);
    }

    [Fact]
    public async Task A_stranger_editing_a_pet_cannot_tell_it_exists()
    {
        var (pet, failure) = await _pets.UpdateAsync(
            Stranger, "p1", PatchOf(name: "Renamed"));

        Assert.Null(pet);
        // NotFound rather than NotOwner. Ids are sequential, so a caller who can
        // tell "no such pet" from "not your pet" can map the table.
        Assert.Equal(PetFailure.NotFound, failure);
    }

    // ── Delete ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Deletes_a_pet_that_has_no_history()
    {
        var created = await _pets.CreateAsync(Owner, NewPet());

        Assert.Null(await _pets.DeleteAsync(Owner, created.Id));
        Assert.Null(await _pets.GetAsync(Owner, created.Id));
    }

    [Fact]
    public async Task Refuses_to_delete_a_pet_carrying_clinical_history()
    {
        // p1 has vaccination records a vet wrote and appointments on the books.
        // All three foreign keys onto pets are ON DELETE CASCADE, so without
        // this guard an owner deletes forty records they did not author by
        // deleting the patient — the wholesale version of the thing
        // "only the author may delete a record" exists to prevent.
        Assert.Equal(PetFailure.HasHistory, await _pets.DeleteAsync(Owner, "p1"));
        Assert.NotNull(await _pets.GetAsync(Owner, "p1"));
    }

    [Fact]
    public async Task A_stranger_deleting_a_pet_cannot_tell_it_exists()
    {
        Assert.Equal(PetFailure.NotFound, await _pets.DeleteAsync(Stranger, "p1"));
        Assert.NotNull(await _pets.GetAsync(Owner, "p1"));
    }

    [Fact]
    public async Task A_caretaker_may_not_delete_the_pet_they_are_sitting()
    {
        Assert.Equal(PetFailure.NotOwner, await _pets.DeleteAsync(CaretakerUser, "p1"));
    }

    // ── The visit timeline ───────────────────────────────────────────────

    [Fact]
    public async Task Lists_a_pets_visits_newest_first_with_the_fee_for_the_booker()
    {
        var visits = await _pets.ListAppointmentsAsync(Owner, "p1");
        Assert.NotNull(visits);

        Assert.Equal(["a3", "a8"], visits.Select(v => v.Id).Order());
        Assert.All(visits, v => Assert.NotNull(v.Fee));
        Assert.True(visits[0].StartDateTime >= visits[^1].StartDateTime);
    }

    [Fact]
    public async Task A_treating_vet_sees_the_visits_without_what_they_cost()
    {
        // The fee belonged to whoever paid it. A shelter's discounted invoice is
        // not the adopter's business, and neither is the owner's the vet's.
        var visits = await _pets.ListAppointmentsAsync(VetUser, "p1");

        Assert.NotEmpty(visits!);
        Assert.All(visits!, v => Assert.Null(v.Fee));
    }

    [Fact]
    public async Task A_caretaker_sees_the_visit_history_of_a_pet_they_sit()
    {
        // Scoped by the pet, not by who booked each visit. The reference asked
        // for the caller's own appointments and filtered client-side, which is
        // self-only — a treating vet opening a patient's record got an empty
        // panel.
        var visits = await _pets.ListAppointmentsAsync(CaretakerUser, "p1");

        Assert.NotEmpty(visits!);
        Assert.All(visits!, v => Assert.Null(v.Fee));
    }

    [Fact]
    public async Task A_stranger_gets_nothing_from_the_visit_timeline()
    {
        Assert.Null(await _pets.ListAppointmentsAsync(Stranger, "p1"));
    }

    // ── Recommendations ──────────────────────────────────────────────────

    [Fact]
    public async Task Recommends_products_for_the_pets_species_and_life_stage()
    {
        var products = await _catalog.RecommendForPetAsync(LunaOwner, "p4");

        Assert.NotEmpty(products!);
        Assert.All(products!, p => Assert.Contains("cat", p.Species));
        Assert.All(products!, p => Assert.True(
            p.LifeStage.Contains("adult") || p.LifeStage.Contains("all"),
            $"{p.Slug} is for {string.Join("/", p.LifeStage)}, not an adult cat"));
    }

    [Fact]
    public async Task Recommendations_exclude_anything_the_pet_reacts_to()
    {
        // Luna's allergies are {Chicken, "Certain grains"}; prod8
        // (meadowlark-chicken-dry-cat) lists exactly those as allergens.
        var products = await _catalog.RecommendForPetAsync(LunaOwner, "p4");
        Assert.NotNull(products);

        Assert.DoesNotContain("meadowlark-chicken-dry-cat", products.Select(p => p.Slug));
        Assert.Contains("willowbrook-grain-free-cat-dry", products.Select(p => p.Slug));
    }

    [Fact]
    public async Task Recommendations_never_include_prescription_only_products()
    {
        // Luna has a live prescription for vetline-hypoallergenic-cat-dry, and
        // it still does not belong on a recommendation shelf — an Rx item is
        // bought against a prescription, not browsed into a basket.
        var products = await _catalog.RecommendForPetAsync(LunaOwner, "p4");

        Assert.All(products!, p => Assert.False(p.RequiresPrescription));
    }

    [Fact]
    public async Task Recommendations_are_owner_only()
    {
        // The shelf is a readout of the animal's allergy list, so it is not for
        // a sitter or a vet — it is for the person buying the food.
        Assert.Null(await _catalog.RecommendForPetAsync(CaretakerUser, "p1"));
        Assert.Null(await _catalog.RecommendForPetAsync(VetUser, "p1"));
        Assert.Null(await _catalog.RecommendForPetAsync(Stranger, "p1"));
        Assert.Null(await _catalog.RecommendForPetAsync(Owner, "ghost"));
    }

    // ── The pure helpers ─────────────────────────────────────────────────

    [Theory]
    [InlineData("dog", -200, "puppy")]
    [InlineData("cat", -200, "kitten")]
    [InlineData("dog", -800, "adult")]
    [InlineData("cat", -800, "adult")]
    [InlineData("dog", -4000, "senior")]
    // Anything that is not a cat takes the "puppy" bucket, because the
    // catalogue has no third young-animal stage to map "other" onto.
    [InlineData("other", -100, "puppy")]
    public void Maps_age_and_species_onto_a_life_stage(
        string species, int ageInDays, string expected)
    {
        var dob = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(ageInDays);

        Assert.Equal(expected, CatalogService.LifeStageFor(species, dob));
    }

    [Fact]
    public void Matches_an_allergen_loosely_in_both_directions()
    {
        // An owner writes "Chicken"; the product lists "chicken by-product
        // meal". Equality would miss it, and missing it is how an allergic
        // animal gets recommended the thing that makes it ill.
        Assert.True(CatalogService.HasAllergen(["chicken by-product meal"], ["chicken"]));
        Assert.True(CatalogService.HasAllergen(["Chicken"], ["chicken meal"]));
        Assert.True(CatalogService.HasAllergen(["Certain grains"], ["grains"]));

        Assert.False(CatalogService.HasAllergen(["Fish"], ["chicken"]));
        Assert.False(CatalogService.HasAllergen([], ["chicken"]));
        Assert.False(CatalogService.HasAllergen(["Fish"], []));
    }

    [Fact]
    public void An_empty_allergen_matches_nothing_rather_than_everything()
    {
        // "" is a substring of every string, so a blank entry that reached this
        // would empty the shelf. The service strips them; this pins that the
        // predicate itself does not treat one as a wildcard either.
        Assert.False(CatalogService.HasAllergen(["Fish", "Chicken"], [""]));
        Assert.False(CatalogService.HasAllergen([""], ["chicken"]));
    }

    private static PetPatchRequest PatchOf(string? name = null) =>
        new(name, null, null, null, null, null, null, null, null, null, null, null, null);
}
