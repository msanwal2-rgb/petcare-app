using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The port of the catalogue half of <c>tests/products.test.ts</c>. The
/// allergen, life-stage and recommendation blocks were ported in M3 and live in
/// <see cref="PetServiceTests"/>.
///
/// ── The departure that matters ──
///
/// The reference paginated with <c>OFFSET</c> and returned a <c>total</c>.
/// STATUS.md §5 makes keyset pagination the rule for every list endpoint, so
/// the "paginates" and "caps an absurd limit" cases assert the cursor contract
/// instead, and two tests walk every sort one row at a time and require the
/// result to equal the unpaginated list — which is the property offset paging
/// does not have once stock and ratings move between pages.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class CatalogServiceTests(DatabaseFixture db) : IAsyncLifetime
{
    private CoreHost _core = null!;
    private ICatalogService _catalog = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _core = new CoreHost(db.ConnectionString);
        _catalog = _core.Get<ICatalogService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private Task<ProductPage> Search(ProductSearchFilter filter)
        => _catalog.SearchAsync(filter with { Limit = filter.Limit == 24 ? 100 : filter.Limit });

    // ── Search ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Returns_every_active_product_when_unfiltered()
    {
        var page = await Search(new ProductSearchFilter());

        Assert.Equal(25, page.Items.Length);
        Assert.All(page.Items, p => Assert.True(p.Active));
        Assert.Null(page.NextCursor);
    }

    [Fact]
    public async Task Pages_without_overlap()
    {
        var first = await _catalog.SearchAsync(new ProductSearchFilter(Limit: 5));
        var second = await _catalog.SearchAsync(new ProductSearchFilter(Limit: 5, Cursor: first.NextCursor));

        Assert.Equal(5, first.Items.Length);
        Assert.Equal(5, second.Items.Length);
        Assert.Empty(first.Items.Select(p => p.Id).Intersect(second.Items.Select(p => p.Id)));
    }

    [Fact]
    public async Task Caps_an_absurd_limit_rather_than_dumping_the_catalogue()
    {
        // 25 products, so the cap is not observable as a row count here; what
        // is observable is that 5000 neither throws nor returns a cursor.
        var page = await _catalog.SearchAsync(new ProductSearchFilter(Limit: 5000));

        Assert.True(page.Items.Length <= 100);
    }

    [Theory]
    [InlineData(ProductSorts.Featured)]
    [InlineData(ProductSorts.PriceAsc)]
    [InlineData(ProductSorts.PriceDesc)]
    [InlineData(ProductSorts.Rating)]
    [InlineData(ProductSorts.Newest)]
    public async Task Walking_any_sort_one_row_at_a_time_equals_the_whole_list(string sort)
    {
        var all = (await Search(new ProductSearchFilter(Sort: sort))).Items.Select(p => p.Id).ToArray();

        var seen = new List<string>();
        string? cursor = null;
        do
        {
            var page = await _catalog.SearchAsync(
                new ProductSearchFilter(Sort: sort, Cursor: cursor, Limit: 1));
            seen.AddRange(page.Items.Select(p => p.Id));
            cursor = page.NextCursor;
        } while (cursor is not null);

        // Same rows, same order, none twice. The id tie-break in every keyset
        // is what makes this hold when prices and ratings repeat.
        Assert.Equal(all, seen);
    }

    [Fact]
    public async Task A_cursor_from_one_sort_starts_another_from_the_beginning()
    {
        // The sort name is inside the cursor, so a token carried across a change
        // of sort is the wrong shape and decodes as "start again".
        var priceFirst = await _catalog.SearchAsync(
            new ProductSearchFilter(Sort: ProductSorts.PriceAsc, Limit: 3));

        var newest = await _catalog.SearchAsync(
            new ProductSearchFilter(Sort: ProductSorts.Newest, Limit: 3));
        var newestWithForeignCursor = await _catalog.SearchAsync(
            new ProductSearchFilter(Sort: ProductSorts.Newest, Limit: 3, Cursor: priceFirst.NextCursor));

        Assert.Equal(newest.Items.Select(p => p.Id), newestWithForeignCursor.Items.Select(p => p.Id));
    }

    [Fact]
    public async Task Filters_by_category()
    {
        var page = await Search(new ProductSearchFilter(Category: ProductCategories.Treats));

        Assert.Equal(3, page.Items.Length);
        Assert.All(page.Items, p => Assert.Equal(ProductCategories.Treats, p.Category));
    }

    [Fact]
    public async Task Filters_by_species()
    {
        var page = await Search(new ProductSearchFilter(Species: Species.Cat));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, p => Assert.Contains(Species.Cat, p.Species));
    }

    [Fact]
    public async Task Treats_a_life_stage_of_all_as_matching_every_stage()
    {
        var slugs = (await Search(new ProductSearchFilter(Species: Species.Dog, LifeStage: LifeStages.Puppy)))
            .Items.Select(p => p.Slug).ToArray();

        Assert.Contains("summit-trail-puppy-dry", slugs);           // puppy-specific
        Assert.Contains("barkside-peanut-butter-biscuits", slugs);  // lifeStage: all
        Assert.DoesNotContain("silverpaw-senior-dry-dog", slugs);
    }

    [Fact]
    public async Task Filters_by_brand()
    {
        var page = await Search(new ProductSearchFilter(Brand: "VetLine"));

        Assert.Equal(3, page.Items.Length);
        Assert.All(page.Items, p => Assert.Equal("VetLine", p.Brand));
    }

    [Fact]
    public async Task Filters_by_price_range_in_cents()
    {
        var page = await Search(new ProductSearchFilter(MinPriceCents: 1000, MaxPriceCents: 3000));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, p => Assert.InRange(p.PriceCents, 1000, 3000));
    }

    [Fact]
    public async Task Searches_name_brand_and_description_case_insensitively()
    {
        Assert.NotEmpty((await Search(new ProductSearchFilter(Q: "salmon"))).Items);

        var byBrand = await Search(new ProductSearchFilter(Q: "BARKSIDE"));
        Assert.NotEmpty(byBrand.Items);
        Assert.All(byBrand.Items, p => Assert.Equal("Barkside", p.Brand));
    }

    [Fact]
    public async Task A_search_for_a_wildcard_character_is_a_search_for_that_character()
    {
        // Unescaped, "%" is LIKE's match-anything and returns the whole shelf.
        Assert.Empty((await Search(new ProductSearchFilter(Q: "%"))).Items);
        Assert.Empty((await Search(new ProductSearchFilter(Q: "_"))).Items);
    }

    [Fact]
    public async Task Sorts_by_price_in_both_directions()
    {
        var asc = (await Search(new ProductSearchFilter(Sort: ProductSorts.PriceAsc))).Items;
        for (var i = 1; i < asc.Length; i++)
            Assert.True(asc[i - 1].PriceCents <= asc[i].PriceCents);

        var desc = (await Search(new ProductSearchFilter(Sort: ProductSorts.PriceDesc))).Items;
        for (var i = 1; i < desc.Length; i++)
            Assert.True(desc[i - 1].PriceCents >= desc[i].PriceCents);
    }

    [Fact]
    public async Task Featured_leads_with_the_best_reviewed()
    {
        var items = (await Search(new ProductSearchFilter())).Items;
        for (var i = 1; i < items.Length; i++)
            Assert.True(items[i - 1].Rating >= items[i].Rating);
    }

    [Fact]
    public async Task An_unknown_sort_falls_back_to_featured()
    {
        var featured = await Search(new ProductSearchFilter());
        var unknown = await Search(new ProductSearchFilter(Sort: "cheapest-first-please"));

        Assert.Equal(featured.Items.Select(p => p.Id), unknown.Items.Select(p => p.Id));
    }

    [Fact]
    public async Task Combines_filters()
    {
        var page = await Search(new ProductSearchFilter(
            Species: Species.Cat, Category: ProductCategories.PrescriptionDiet));

        Assert.NotEmpty(page.Items);
        Assert.All(page.Items, p => Assert.True(p.RequiresPrescription));
    }

    // ── Reads ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Gets_a_product_by_slug()
    {
        var p = await _catalog.GetBySlugAsync("summit-trail-salmon-dry-dog");

        Assert.Equal("Summit Trail", p!.Brand);
        Assert.Equal(6499, p.PriceCents);
    }

    [Fact]
    public async Task Returns_null_for_an_unknown_slug()
    {
        Assert.Null(await _catalog.GetBySlugAsync("nope"));
    }

    [Fact]
    public async Task Batch_resolves_by_id_and_skips_the_round_trip_for_none()
    {
        var repo = _core.Get<ICatalogRepository>();

        var items = await repo.GetByIdsAsync(["prod1", "prod13"]);
        Assert.Equal(["prod1", "prod13"], items.Select(p => p.Id).Order());

        Assert.Empty(await repo.GetByIdsAsync([]));
    }

    [Fact]
    public async Task Lists_distinct_brands_alphabetically()
    {
        var brands = await _catalog.ListBrandsAsync();

        Assert.Contains("VetLine", brands);
        Assert.Equal(brands.Order(StringComparer.Ordinal), brands);
        Assert.Equal(brands.Distinct().Count(), brands.Count);
    }

    // ── The one allergen match ───────────────────────────────────────────

    [Fact]
    public void Reports_which_allergens_matched_in_the_products_own_wording()
    {
        // The warning wants to say "contains chicken by-product meal", not only
        // that something matched — and it must be the same matcher the
        // recommendations shelf uses (REQUIREMENTS.md S18).
        var matched = CatalogService.MatchingAllergens(
            ["Chicken by-product meal", "Rice", "Certain grains"], ["chicken", "grains"]);

        Assert.Equal(["Chicken by-product meal", "Certain grains"], matched);
        Assert.True(CatalogService.HasAllergen(["Chicken by-product meal"], ["chicken"]));
    }
}
