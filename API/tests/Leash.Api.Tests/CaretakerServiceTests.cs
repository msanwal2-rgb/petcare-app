using Dapper;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/caretakers.test.ts</c>, rewritten around the thing that
/// changed: <b>search runs in PostgreSQL now</b> (REQUIREMENTS.md C4).
///
/// The reference read every caretaker row with its pricing and availability,
/// then filtered and sorted the array in Node. That is a table scan plus a full
/// materialisation, and it cannot paginate at all — the page boundary is decided
/// after the work is done. So the cases below assert the same <i>semantics</i>
/// and add the ones a paginated query has to get right on its own: that a page
/// boundary neither repeats nor skips a row.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class CaretakerServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string CaretakerUser = "u7";   // caretaker profile c1
    private const string Caretaker = "c1";
    private const string Owner = "u1";

    private CoreHost _core = null!;
    private ICaretakerService _caretakers = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _caretakers = _core.Get<ICaretakerService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Gets_a_caretaker_with_the_person_behind_it()
    {
        var caretaker = await _caretakers.GetAsync(Caretaker);

        Assert.NotNull(caretaker);
        Assert.Equal(CaretakerUser, caretaker.Profile.UserId);
        Assert.Equal(CaretakerUser, caretaker.User.Id);
        Assert.NotEmpty(caretaker.Profile.Pricing);
    }

    [Fact]
    public async Task A_search_result_carries_only_the_public_projection_of_the_person()
    {
        // PublicUserDto has no email, phone or coordinates by construction. A
        // search result leaking a home address is the mistake M1 fixed on
        // GET /users/{id}; this is where it would come straight back.
        var caretaker = await _caretakers.GetAsync(Caretaker);

        Assert.NotNull(caretaker!.User.Name);
        Assert.Equal("Austin", caretaker.User.Address.City);

        // The type simply has nowhere to put them — this asserts the shape the
        // endpoint test then confirms over the wire.
        Assert.Equal(
            typeof(PublicUserDto),
            caretaker.User.GetType());
    }

    [Fact]
    public async Task Returns_null_for_an_unknown_caretaker()
    {
        Assert.Null(await _caretakers.GetAsync("ghost"));
        Assert.Null(await _caretakers.GetByUserAsync("ghost"));
    }

    [Fact]
    public async Task Finds_a_profile_by_the_user_behind_it()
    {
        var profile = await _caretakers.GetByUserAsync(CaretakerUser);

        Assert.Equal(Caretaker, profile!.Id);
        Assert.Equal(3, profile.HomeEnvironment is null ? 0 : profile.Pricing.Length);
    }

    [Fact]
    public async Task An_owner_has_no_caretaker_profile()
    {
        Assert.Null(await _caretakers.GetByUserAsync(Owner));
    }

    [Fact]
    public async Task Reports_a_price_range_from_the_rate_card()
    {
        // c1: walking $28/hr, sitting $24/hr, daycare $55/day.
        var caretaker = await _caretakers.GetAsync(Caretaker);

        Assert.Equal(24m, caretaker!.PriceRange.Min);
        Assert.Equal(55m, caretaker.PriceRange.Max);
    }

    // ── Search ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Searches_everyone_by_default_best_rated_first()
    {
        var page = await _caretakers.SearchAsync(new CaretakerSearchQuery(Limit: 100));

        Assert.NotEmpty(page.Items);
        for (var i = 1; i < page.Items.Length; i++)
        {
            Assert.True(
                page.Items[i - 1].Profile.Rating >= page.Items[i].Profile.Rating,
                "results must come back best-rated first");
        }
    }

    [Fact]
    public async Task Filters_by_service_type()
    {
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(ServiceType: ServiceTypes.Boarding, Limit: 100));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, c =>
            Assert.Contains(ServiceTypes.Boarding, c.Profile.ServicesOffered));
    }

    [Fact]
    public async Task Filters_by_accepted_species()
    {
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(Species: Species.Cat, Limit: 100));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, c => Assert.Contains(Species.Cat, c.Profile.AcceptedSpecies));
    }

    [Fact]
    public async Task Filters_by_price_ceiling()
    {
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(MaxPrice: 30m, Limit: 100));

        // "Has something at or below this" — the cheapest line is what a budget
        // filter is asking about, not the dearest.
        Assert.All(page.Items, c => Assert.True(
            c.PriceRange.Min <= 30m,
            $"{c.Profile.Id} starts at {c.PriceRange.Min}, above the 30 ceiling"));
    }

    [Fact]
    public async Task Filters_by_price_floor()
    {
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(MinPrice: 50m, Limit: 100));

        Assert.All(page.Items, c => Assert.True(c.PriceRange.Max >= 50m));
    }

    [Fact]
    public async Task Sorts_by_distance_and_reports_it_when_given_a_location()
    {
        // Austin, roughly.
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(Lat: 30.2672, Lng: -97.7431, Limit: 100));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, c => Assert.NotNull(c.DistanceMiles));

        for (var i = 1; i < page.Items.Length; i++)
            Assert.True(page.Items[i - 1].DistanceMiles <= page.Items[i].DistanceMiles);
    }

    [Fact]
    public async Task Reports_no_distance_when_no_location_was_given()
    {
        var page = await _caretakers.SearchAsync(new CaretakerSearchQuery(Limit: 5));

        Assert.All(page.Items, c => Assert.Null(c.DistanceMiles));
    }

    [Fact]
    public async Task Honours_a_radius()
    {
        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(Lat: 30.2672, Lng: -97.7431, RadiusMiles: 50, Limit: 100));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, c => Assert.True(c.DistanceMiles <= 50));
    }

    [Fact]
    public async Task Filters_by_availability_on_or_after_a_date()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        var earliest = await conn.ExecuteScalarAsync<DateOnly?>(
            """SELECT min(date) FROM availability_days WHERE jsonb_array_length(slots) > 0""");

        Assert.NotNull(earliest);

        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(StartDate: earliest, Limit: 100));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, c => Assert.Contains(
            c.Profile.Availability,
            d => d.Date >= earliest && d.Slots.Length > 0));
    }

    [Fact]
    public async Task A_day_with_no_slots_is_not_availability()
    {
        // An empty slot array is a day the caretaker marked as not working, and
        // jsonb_array_length(slots) > 0 is what keeps it out of the results.
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await conn.ExecuteAsync(
            """UPDATE availability_days SET slots = '[]'::jsonb WHERE "caretakerId" = @id""",
            new { id = Caretaker });

        var page = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(StartDate: new DateOnly(2020, 1, 1), Limit: 100));

        Assert.DoesNotContain(Caretaker, page.Items.Select(c => c.Profile.Id));
    }

    // ── Cursor pagination ────────────────────────────────────────────────

    [Fact]
    public async Task Pages_through_every_caretaker_without_repeating_or_skipping()
    {
        var all = (await _caretakers.SearchAsync(new CaretakerSearchQuery(Limit: 100))).Items;
        Assert.True(all.Length >= 3, "fixture needs at least three caretakers");

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _caretakers.SearchAsync(
                new CaretakerSearchQuery(Cursor: cursor, Limit: 2));

            seen.AddRange(page.Items.Select(c => c.Profile.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all.Select(c => c.Profile.Id), seen);
        Assert.Equal(seen.Distinct(), seen);
    }

    [Fact]
    public async Task Pages_by_distance_without_repeating_or_skipping()
    {
        // The other sort order, which has its own cursor comparison — ascending
        // rather than descending, and on a computed value rather than a column.
        var query = new CaretakerSearchQuery(Lat: 30.2672, Lng: -97.7431, Limit: 100);
        var all = (await _caretakers.SearchAsync(query)).Items;

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _caretakers.SearchAsync(query with { Cursor = cursor, Limit = 2 });
            seen.AddRange(page.Items.Select(c => c.Profile.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        Assert.Equal(all.Select(c => c.Profile.Id), seen);
    }

    [Fact]
    public async Task The_last_page_reports_no_cursor()
    {
        var page = await _caretakers.SearchAsync(new CaretakerSearchQuery(Limit: 100));
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task A_garbled_cursor_starts_from_the_beginning()
    {
        // A cursor names a position in a public result set, not a credential.
        // Refusing a stale bookmark with a 400 gives an honest client a dead end
        // and a prober a signal.
        var first = await _caretakers.SearchAsync(new CaretakerSearchQuery(Limit: 2));
        var garbled = await _caretakers.SearchAsync(
            new CaretakerSearchQuery(Cursor: "not-a-cursor", Limit: 2));

        Assert.Equal(
            first.Items.Select(c => c.Profile.Id),
            garbled.Items.Select(c => c.Profile.Id));
    }

    // ── Editing your own profile ─────────────────────────────────────────

    [Fact]
    public async Task Edits_your_own_profile()
    {
        var (profile, failure) = await _caretakers.UpsertAsync(
            CaretakerUser, CaretakerUser,
            new CaretakerPatchRequest(
                Bio: "Rewritten.", null, null, ServiceRadiusMiles: 25,
                null, null, null, null, null));

        Assert.Null(failure);
        Assert.Equal("Rewritten.", profile!.Bio);
        Assert.Equal(25, profile.ServiceRadiusMiles);
    }

    [Fact]
    public async Task A_patch_leaves_what_it_omits_alone()
    {
        var before = await _caretakers.GetByUserAsync(CaretakerUser);

        var (after, _) = await _caretakers.UpsertAsync(
            CaretakerUser, CaretakerUser,
            new CaretakerPatchRequest(Bio: "Just the bio.", null, null, null,
                null, null, null, null, null));

        Assert.Equal("Just the bio.", after!.Bio);
        Assert.Equal(before!.ServicesOffered, after.ServicesOffered);
        Assert.Equal(before.Pricing.Length, after.Pricing.Length);
        Assert.Equal(before.Availability.Length, after.Availability.Length);
        Assert.Equal(before.AcceptedSpecies, after.AcceptedSpecies);
    }

    [Fact]
    public async Task Refuses_to_edit_somebody_elses_profile()
    {
        var (profile, failure) = await _caretakers.UpsertAsync(
            Owner, CaretakerUser,
            new CaretakerPatchRequest("Hijacked.", null, null, null, null, null, null, null, null));

        Assert.Null(profile);
        Assert.Equal(CaretakerFailure.NotYours, failure);
    }

    [Fact]
    public async Task Creates_a_profile_for_a_user_who_has_none()
    {
        // One verb for create and edit: there is exactly one profile per user,
        // so a client should not have to know which it is doing.
        var (profile, failure) = await _caretakers.UpsertAsync(
            Owner, Owner,
            new CaretakerPatchRequest(
                Bio: "New to this.", ServicesOffered: [ServiceTypes.Walking],
                null, null, null, null, null, null, null));

        Assert.Null(failure);
        Assert.StartsWith("c_", profile!.Id);
        Assert.Equal(Owner, profile.UserId);

        // A brand-new caretaker has answered nothing and ignored nothing.
        Assert.Equal(100, profile.ResponseRatePct);
        Assert.Equal(0, profile.ReviewCount);
    }

    [Fact]
    public async Task Replaces_the_whole_rate_card_when_pricing_is_sent()
    {
        var (profile, _) = await _caretakers.UpsertAsync(
            CaretakerUser, CaretakerUser,
            new CaretakerPatchRequest(
                null, null,
                Pricing: [new PricingEntryDto(ServiceTypes.Walking, PricingUnits.Hour, 31m)],
                null, null, null, null, null, null));

        // Replace-whole, not merge: c1's three lines become this one.
        Assert.Single(profile!.Pricing);
        Assert.Equal(31m, profile.Pricing[0].Rate);
    }

    [Fact]
    public async Task A_new_rate_card_prices_the_next_booking()
    {
        // The seam that makes the rate card load-bearing rather than displayed.
        await _caretakers.UpsertAsync(
            CaretakerUser, CaretakerUser,
            new CaretakerPatchRequest(
                null, null,
                Pricing: [new PricingEntryDto(ServiceTypes.Walking, PricingUnits.Hour, 31m)],
                null, null, null, null, null, null));

        var bookings = _core.Get<IBookingService>();
        var (booking, failure) = await bookings.CreateAsync(Owner, new CreateBookingRequest(
            Caretaker, ["p1"], ServiceTypes.Walking,
            DateTimeOffset.UtcNow.AddDays(3),
            DateTimeOffset.UtcNow.AddDays(3).AddHours(2),
            null));

        Assert.Null(failure);
        Assert.Equal(62m, booking!.PriceTotal);
    }

    [Fact]
    public async Task A_caretaker_cannot_award_themselves_a_reputation()
    {
        // Not a check — the patch type has no rating, reviewCount or
        // responseRatePct property to send. This pins that the values survive a
        // patch untouched.
        var before = await _caretakers.GetByUserAsync(CaretakerUser);

        var (after, _) = await _caretakers.UpsertAsync(
            CaretakerUser, CaretakerUser,
            new CaretakerPatchRequest("New bio.", null, null, null, null, null, null, null, null));

        Assert.Equal(before!.Rating, after!.Rating);
        Assert.Equal(before.ReviewCount, after.ReviewCount);
        Assert.Equal(before.ResponseRatePct, after.ResponseRatePct);
    }
}
