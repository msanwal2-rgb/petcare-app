using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/medical-records.test.ts</c>.
///
/// The block that matters most is "active prescriptions". REQUIREMENTS.md P8
/// exists because the system this replaces had <b>four</b> implementations of
/// "is this prescription active?" and only the SQL one gated money — so the
/// badge on the product page and the rule at checkout were answering different
/// questions. There is one here, in
/// <c>MedicalRecordRepository.ActivePrescription</c>, and these are the tests
/// that keep it the only one.
///
/// Seeded fixtures: p4 (Luna) carries mr1 (visit_note), mr2 (prescription,
/// expires 2026-12-20, 3 refills, authorising vetline-hypoallergenic-cat-dry)
/// and mr3 (weight). p1 carries vaccinations and a visit note, no prescription.
/// p3 carries nothing.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class MedicalRecordServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string BiscuitOwner = "u1";   // owns p1
    private const string LunaOwner = "u3";      // owns p4
    private const string CaretakerUser = "u7";  // sits p1, no clinical access
    private const string VetUser = "u17";       // vet v1 — treats p1 and p4
    private const string Stranger = "u2";

    /// <summary>
    /// A fixed instant inside mr2's validity window (it expires 2026-12-20), so
    /// these assertions do not change answer as the wall clock moves. The
    /// reference suite passed the same timestamp in for the same reason.
    /// </summary>
    private static readonly DateTimeOffset InsideWindow =
        new(2026, 7, 8, 0, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset AfterExpiry =
        new(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private CoreHost _core = null!;
    private IMedicalRecordService _records = null!;
    private IMedicalRecordRepository _repo = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _records = _core.Get<IMedicalRecordService>();
        _repo = _core.Get<IMedicalRecordRepository>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Lists_a_pets_records_newest_first()
    {
        var (records, failure) = await _records.ListForPetAsync(LunaOwner, "p4");

        Assert.Null(failure);
        Assert.Equal(3, records!.Count);

        for (var i = 1; i < records.Count; i++)
            Assert.True(records[i - 1].OccurredAt >= records[i].OccurredAt);
    }

    [Fact]
    public async Task Returns_an_empty_timeline_for_a_pet_with_no_records()
    {
        var (records, failure) = await _records.ListForPetAsync(Stranger, "p3");

        Assert.Null(failure);
        Assert.Empty(records!);
    }

    [Fact]
    public async Task Gets_a_record_by_id_preserving_the_prescription_fields()
    {
        var record = await _repo.GetByIdAsync("mr2");

        Assert.Equal(MedicalRecordTypes.Prescription, record!.Type);
        Assert.Equal(3, record.RefillsLeft);
        Assert.Equal(["vetline-hypoallergenic-cat-dry"], record.ProductSlugs);
    }

    [Fact]
    public async Task Returns_null_for_an_unknown_record()
    {
        Assert.Null(await _repo.GetByIdAsync("nope"));
    }

    // ── Who may read a timeline ──────────────────────────────────────────

    [Fact]
    public async Task A_treating_vet_may_read_the_timeline()
    {
        var (records, failure) = await _records.ListForPetAsync(VetUser, "p1");

        Assert.Null(failure);
        Assert.NotEmpty(records!);
    }

    [Fact]
    public async Task A_caretaker_may_not_read_the_timeline()
    {
        // A booking is not clinical access. The sitter can read the feeding
        // instructions; the medical history is a different question.
        var (records, failure) = await _records.ListForPetAsync(CaretakerUser, "p1");

        Assert.Null(records);
        Assert.Equal(RecordFailure.NoAccess, failure);
    }

    [Fact]
    public async Task A_stranger_may_not_read_the_timeline()
    {
        var (_, failure) = await _records.ListForPetAsync(Stranger, "p1");
        Assert.Equal(RecordFailure.NoAccess, failure);
    }

    // ── Who may author what ──────────────────────────────────────────────

    [Fact]
    public void Lets_an_owner_record_allergies_and_weights()
    {
        Assert.True(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.Allergy));
        Assert.True(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.Weight));
    }

    [Fact]
    public void Reserves_clinical_entry_types_for_vets()
    {
        Assert.False(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.Prescription));
        Assert.False(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.VisitNote));
        Assert.False(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.Vaccination));
        Assert.False(MedicalRecordTypes.OwnerMayAuthor(MedicalRecordTypes.LabResult));
    }

    // ── Active prescriptions — the money seam ────────────────────────────

    [Fact]
    public async Task Returns_a_prescription_that_has_not_expired()
    {
        var active = await _repo.ListActivePrescriptionsAsync("p4", InsideWindow);
        Assert.Equal(["mr2"], active.Select(r => r.Id));
    }

    [Fact]
    public async Task Excludes_a_prescription_once_its_expiry_has_passed()
    {
        Assert.Empty(await _repo.ListActivePrescriptionsAsync("p4", AfterExpiry));
    }

    [Fact]
    public async Task Ignores_non_prescription_records()
    {
        // p1 has vaccinations and a visit note only.
        Assert.Empty(await _repo.ListActivePrescriptionsAsync("p1", InsideWindow));
    }

    [Fact]
    public async Task Maps_prescriptions_to_the_product_slugs_they_authorise()
    {
        var slugs = await _repo.ListAuthorizedProductSlugsAsync("p4", InsideWindow);

        Assert.Contains("vetline-hypoallergenic-cat-dry", slugs);
        Assert.DoesNotContain("vetline-urinary-so-cat-wet", slugs);
    }

    [Fact]
    public async Task Authorises_nothing_for_a_pet_with_no_prescriptions()
    {
        Assert.Empty(await _repo.ListAuthorizedProductSlugsAsync("p1", InsideWindow));
    }

    [Fact]
    public async Task Stops_authorising_a_product_once_the_refills_run_out()
    {
        await SetRefillsAsync("mr2", 0);

        Assert.Empty(await _repo.ListAuthorizedProductSlugsAsync("p4", InsideWindow));
    }

    [Fact]
    public async Task Keeps_authorising_when_the_vet_set_no_refill_limit()
    {
        // NULL refillsLeft means "no limit", not "none left". `<> 0` would make
        // NULL answer NULL and silently drop every open-ended prescription —
        // which is why the predicate uses IS DISTINCT FROM.
        await SetRefillsAsync("mr2", null);

        Assert.Contains(
            "vetline-hypoallergenic-cat-dry",
            await _repo.ListAuthorizedProductSlugsAsync("p4", InsideWindow));
    }

    [Fact]
    public async Task Keeps_authorising_when_the_vet_set_no_expiry()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """UPDATE medical_records SET "expiresAt" = NULL WHERE id = 'mr2'""");

        // No end date means it never expires, so even a far-future instant is
        // inside the window.
        Assert.Contains(
            "vetline-hypoallergenic-cat-dry",
            await _repo.ListAuthorizedProductSlugsAsync("p4", AfterExpiry));
    }

    // ── Writes ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Creates_a_vet_authored_record_stamped_with_the_vet_profile()
    {
        var (created, failure) = await _records.CreateAsync(
            VetUser, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.Vaccination,
                Title: "Rabies booster",
                Details: "Given early at the wellness visit.",
                OccurredAt: new DateTimeOffset(2026, 7, 12, 16, 15, 0, TimeSpan.Zero),
                AppointmentId: "a3",
                NextDueAt: new DateTimeOffset(2029, 7, 12, 0, 0, 0, TimeSpan.Zero),
                MedicationName: null, Dosage: null, RefillsLeft: null,
                ExpiresAt: null, ProductSlugs: []));

        Assert.Null(failure);
        Assert.StartsWith("mr_", created!.Id);

        // Stamped from the access check that granted the write, not from the
        // body — a client that could name its own author could write a
        // prescription as somebody else's vet.
        Assert.Equal("v1", created.VetId);
        Assert.Equal(VetUser, created.AuthorUserId);
        Assert.NotEqual(default, created.CreatedAt);
    }

    [Fact]
    public async Task Creates_an_owner_authored_record_with_no_vet_attached()
    {
        var (created, failure) = await _records.CreateAsync(
            BiscuitOwner, "p1", WeightEntry());

        Assert.Null(failure);
        Assert.Null(created!.VetId);
        Assert.Equal(BiscuitOwner, created.AuthorUserId);
    }

    [Fact]
    public async Task An_owner_may_not_write_themselves_a_prescription()
    {
        // The whole reason authorship is constrained server-side. An owner
        // clears CanAccessPetRecords trivially — it is their pet — so without
        // the type check they could write the prescription that unlocks an
        // Rx-only product to themselves.
        var (created, failure) = await _records.CreateAsync(
            BiscuitOwner, "p1",
            WeightEntry() with
            {
                Type = MedicalRecordTypes.Prescription,
                Title = "Self-issued",
                ProductSlugs = ["vetline-hydrolyzed-protein-dog-dry"],
            });

        Assert.Null(created);
        Assert.Equal(RecordFailure.TypeNotAuthorable, failure);

        // And nothing was written on the way to being refused.
        Assert.Empty(await _repo.ListAuthorizedProductSlugsAsync("p1", InsideWindow));
    }

    [Fact]
    public async Task A_caretaker_may_not_write_a_record_at_all()
    {
        var (_, failure) = await _records.CreateAsync(CaretakerUser, "p1", WeightEntry());
        Assert.Equal(RecordFailure.NoAccess, failure);
    }

    [Fact]
    public async Task A_vet_with_no_appointment_for_this_pet_may_not_write_one()
    {
        // u18 is vet v2 and treats p6, not p1. This is the 403 REQUIREMENTS
        // section 5.4 names in so many words.
        var (_, failure) = await _records.CreateAsync("u18", "p1", WeightEntry());
        Assert.Equal(RecordFailure.NoAccess, failure);
    }

    [Fact]
    public async Task A_prescription_written_today_authorises_its_products_immediately()
    {
        // REQUIREMENTS section 5.4, end to end: the vet writes it, and the
        // store's gate sees it on the next read.
        var (created, failure) = await _records.CreateAsync(
            VetUser, "p1",
            new MedicalRecordRequest(
                Type: MedicalRecordTypes.Prescription,
                Title: "Hydrolysed protein trial",
                Details: "Eight weeks, sole diet.",
                OccurredAt: DateTimeOffset.UtcNow,
                AppointmentId: "a3",
                NextDueAt: null,
                MedicationName: "VetLine Hydrolysed Protein (dog)",
                Dosage: "2 cups twice daily",
                RefillsLeft: 3,
                ExpiresAt: DateTimeOffset.UtcNow.AddMonths(6),
                ProductSlugs: ["vetline-hydrolyzed-protein-dog-dry"]));

        Assert.Null(failure);
        Assert.Equal("v1", created!.VetId);

        Assert.Contains(
            "vetline-hydrolyzed-protein-dog-dry",
            await _repo.ListAuthorizedProductSlugsAsync("p1", DateTimeOffset.UtcNow));
    }

    // ── Delete ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Deletes_a_record_the_caller_wrote()
    {
        Assert.Null(await _records.DeleteAsync(VetUser, "mr3"));
        Assert.Null(await _repo.GetByIdAsync("mr3"));
    }

    [Fact]
    public async Task An_owner_may_not_delete_what_a_vet_wrote_about_their_pet()
    {
        // A health record its subject can rewrite is not a record. Luna's owner
        // reads mr2 and cannot remove it.
        Assert.Equal(RecordFailure.NotAuthor, await _records.DeleteAsync(LunaOwner, "mr2"));
        Assert.NotNull(await _repo.GetByIdAsync("mr2"));
    }

    [Fact]
    public async Task Deleting_an_unknown_record_is_a_not_found()
    {
        Assert.Equal(RecordFailure.NotFound, await _records.DeleteAsync(VetUser, "ghost"));
    }

    [Fact]
    public async Task Cascades_records_away_when_the_pet_is_deleted()
    {
        // The FK is ON DELETE CASCADE, which is exactly why PetService refuses
        // to delete a pet that still has any. This pins the cascade itself.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync("DELETE FROM pets WHERE id = 'p4'");

        Assert.Empty(await _repo.ListForPetAsync("p4"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private static MedicalRecordRequest WeightEntry() => new(
        Type: MedicalRecordTypes.Weight,
        Title: "Weight recorded: 70 lb",
        Details: "",
        OccurredAt: new DateTimeOffset(2026, 7, 8, 8, 0, 0, TimeSpan.Zero),
        AppointmentId: null, NextDueAt: null, MedicationName: null,
        Dosage: null, RefillsLeft: null, ExpiresAt: null, ProductSlugs: []);

    private async Task SetRefillsAsync(string recordId, int? refills)
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """UPDATE medical_records SET "refillsLeft" = @refills WHERE id = @recordId""",
            new { refills, recordId });
    }
}
