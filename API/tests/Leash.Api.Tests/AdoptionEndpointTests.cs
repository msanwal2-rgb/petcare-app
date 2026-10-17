using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Adoption over HTTP: what is public and what is guarded, the status codes
/// each refusal maps to, the wire shapes the SPA reads, and one adoption walked
/// end to end — apply, review, approve, pay, complete, reverse.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AdoptionEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Maya = "maya.chen@example.com";                 // u1
    private const string Tom = "tom.whitfield@example.com";             // u4, approved for Juniper
    private const string Apa = "hello@austinpetsalive.example.com";     // u24, sh1
    private const string HillCountry = "adopt@hillcountryrescue.example.com"; // u25, sh2
    private const string Support = "tom.okafor@example.com";            // u23, support

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();

        // Staff accounts are seeded with a password this suite does not know;
        // the support member gets the demo password's hash, as in AdminEndpointTests.
        await Exec("""
            UPDATE users SET "passwordHash" = (SELECT "passwordHash" FROM users WHERE id = 'u1')
            WHERE id = 'u23'
            """);
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = DemoPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private async Task Exec(string sql)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql);
    }

    private static object Application(string listingId) => new
    {
        listingId, householdAdults = 2, householdChildren = 1, hasOtherPets = false,
        homeType = "apartment", fencedYard = false, ownsHome = false, hoursAlonePerDay = 3,
        experience = "Grew up with dogs", message = "Hello",
    };

    // ── Public and guarded ───────────────────────────────────────────────

    [Theory]
    [InlineData("/api/v1/adoptions/listings")]
    [InlineData("/api/v1/adoptions/listings/al1")]
    [InlineData("/api/v1/shelters/search")]
    [InlineData("/api/v1/shelters/sh1")]
    [InlineData("/api/v1/users/u24/shelter-profile")]
    public async Task The_directory_is_public(string path)
        => Assert.Equal(HttpStatusCode.OK, (await _app.CreateSessionClient().GetAsync(path)).StatusCode);

    [Theory]
    [InlineData("GET", "/api/v1/adoptions/applications")]
    [InlineData("POST", "/api/v1/adoptions/applications")]
    [InlineData("GET", "/api/v1/adoptions/applications/aa3")]
    [InlineData("PATCH", "/api/v1/adoptions/applications/aa3/status")]
    [InlineData("POST", "/api/v1/adoptions/applications/aa3/payment")]
    [InlineData("POST", "/api/v1/adoptions/applications/aa3/complete")]
    [InlineData("POST", "/api/v1/adoptions/listings")]
    [InlineData("PATCH", "/api/v1/adoptions/listings/al1")]
    [InlineData("PATCH", "/api/v1/adoptions/listings/al1/status")]
    [InlineData("PATCH", "/api/v1/users/u24/shelter-profile")]
    [InlineData("POST", "/api/v1/admin/adoptions/aa3/reverse")]
    public async Task Every_private_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Shapes ───────────────────────────────────────────────────────────

    [Fact]
    public async Task A_directory_page_nests_the_listing_and_its_animal()
    {
        var page = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/adoptions/listings?limit=1"));

        Assert.Equal(2, page.GetProperty("total").GetInt32());
        Assert.False(string.IsNullOrEmpty(page.GetProperty("nextCursor").GetString()));

        var item = page.GetProperty("items")[0];
        Assert.Equal("al1", item.GetProperty("listing").GetProperty("id").GetString());
        Assert.Equal(5000, item.GetProperty("listing").GetProperty("feeCents").GetInt32());
        Assert.Equal("Austin", item.GetProperty("listing").GetProperty("location").GetProperty("city").GetString());
        Assert.Equal("Marlow", item.GetProperty("pet").GetProperty("name").GetString());
        Assert.Equal("Austin Pets Alive", item.GetProperty("shelterName").GetString());

        // The animal is public; who owned it since when is not.
        Assert.False(item.GetProperty("pet").TryGetProperty("ownedSince", out _));
    }

    [Fact]
    public async Task A_shelter_carries_its_public_account_only()
    {
        var shelter = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/shelters/sh1"));

        Assert.Equal("Austin Pets Alive", shelter.GetProperty("profile").GetProperty("name").GetString());
        Assert.Equal(2, shelter.GetProperty("availableCount").GetInt32());
        Assert.False(shelter.GetProperty("user").TryGetProperty("email", out _));
        Assert.False(shelter.GetProperty("profile").TryGetProperty("rating", out _));
    }

    [Fact]
    public async Task A_user_without_a_shelter_profile_is_a_404()
        => Assert.Equal(HttpStatusCode.NotFound,
            (await _app.CreateSessionClient().GetAsync("/api/v1/users/u1/shelter-profile")).StatusCode);

    // ── Refusals ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Validates_an_application()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PostAsJsonAsync("/api/v1/adoptions/applications", new
        {
            listingId = "al1", householdAdults = 0, householdChildren = 0, hasOtherPets = false,
            homeType = "castle", fencedYard = false, ownsHome = false, hoursAlonePerDay = 30,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(3, (await JsonOf(response)).GetProperty("issues").GetArrayLength());
    }

    [Fact]
    public async Task A_status_write_cannot_complete_an_adoption()
    {
        var hill = await SignedInAsync(HillCountry);
        var response = await hill.PatchAsJsonAsync("/api/v1/adoptions/applications/aa3/status", new { status = "completed" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Somebody_elses_application_is_a_404()
    {
        var maya = await SignedInAsync(Maya);
        Assert.Equal(HttpStatusCode.NotFound, (await maya.GetAsync("/api/v1/adoptions/applications/aa3")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await maya.PatchAsJsonAsync("/api/v1/adoptions/applications/aa3/status", new { status = "withdrawn" })).StatusCode);
    }

    [Fact]
    public async Task The_wrong_party_is_a_403_and_an_illegal_move_a_409()
    {
        var tom = await SignedInAsync(Tom);
        var hill = await SignedInAsync(HillCountry);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await tom.PatchAsJsonAsync("/api/v1/adoptions/applications/aa3/status", new { status = "rejected" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await tom.PostAsJsonAsync("/api/v1/adoptions/applications/aa3/complete", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await hill.PostAsync("/api/v1/adoptions/applications/aa3/payment", null)).StatusCode);

        var illegal = await hill.PatchAsJsonAsync("/api/v1/adoptions/applications/aa3/status", new { status = "under_review" });
        Assert.Equal(HttpStatusCode.Conflict, illegal.StatusCode);
        Assert.Equal("approved", (await JsonOf(illegal)).GetProperty("from").GetString());
    }

    [Fact]
    public async Task An_unpaid_fee_is_a_409_naming_the_payment_status()
    {
        var hill = await SignedInAsync(HillCountry);
        var response = await hill.PostAsJsonAsync("/api/v1/adoptions/applications/aa3/complete", new { });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(JsonValueKind.Null, (await JsonOf(response)).GetProperty("paymentStatus").ValueKind);
    }

    [Fact]
    public async Task A_live_booking_is_a_409_naming_it_and_force_clears_it()
    {
        var tom = await SignedInAsync(Tom);
        Assert.Equal(HttpStatusCode.OK, (await tom.PostAsync("/api/v1/adoptions/applications/aa3/payment", null)).StatusCode);

        await Exec("""
            INSERT INTO bookings (id, "ownerId", "caretakerId", "petIds", "serviceType", "startDateTime",
                                  "endDateTime", notes, status, "createdAt", "priceTotalCents")
            VALUES ('b_foster', 'u25', 'c1', ARRAY['p15'], 'boarding', now() - interval '1 day',
                    now() + interval '6 days', '', 'in_progress', now(), 40000)
            """);

        var hill = await SignedInAsync(HillCountry);
        var refused = await hill.PostAsJsonAsync("/api/v1/adoptions/applications/aa3/complete", new { });

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var body = await JsonOf(refused);
        Assert.Equal("live_engagements", body.GetProperty("code").GetString());
        Assert.Equal("b_foster", body.GetProperty("bookingIds")[0].GetString());
        Assert.Equal(0, body.GetProperty("appointmentIds").GetArrayLength());

        var forced = await hill.PostAsJsonAsync("/api/v1/adoptions/applications/aa3/complete", new { force = true });
        Assert.Equal(HttpStatusCode.OK, forced.StatusCode);
        Assert.Equal("u4", (await JsonOf(forced)).GetProperty("pet").GetProperty("ownerId").GetString());
    }

    [Fact]
    public async Task Listing_needs_a_shelter_and_its_own_animal()
    {
        var maya = await SignedInAsync(Maya);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await maya.PostAsJsonAsync("/api/v1/adoptions/listings", new { petId = "p1" })).StatusCode);

        var apa = await SignedInAsync(Apa);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await apa.PostAsJsonAsync("/api/v1/adoptions/listings", new { petId = "p1" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await apa.PostAsJsonAsync("/api/v1/adoptions/listings", new { petId = "p13" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await apa.PostAsJsonAsync("/api/v1/adoptions/listings", new { petId = "ghost" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await apa.PostAsJsonAsync("/api/v1/adoptions/listings", new { petId = "p13", goodWithKids = "maybe" })).StatusCode);
    }

    [Fact]
    public async Task Only_the_owner_edits_a_shelter_profile()
    {
        var maya = await SignedInAsync(Maya);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await maya.PatchAsJsonAsync("/api/v1/users/u24/shelter-profile", new { name = "Mine" })).StatusCode);

        var apa = await SignedInAsync(Apa);
        var edited = await apa.PatchAsJsonAsync("/api/v1/users/u24/shelter-profile",
            new { bio = "Updated", verificationStatus = "verified", responseRatePct = 1 });
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);

        // The derived and staff-set fields have nowhere to land.
        var body = await JsonOf(edited);
        Assert.Equal("Updated", body.GetProperty("bio").GetString());
        Assert.Equal(50, body.GetProperty("responseRatePct").GetInt32());
    }

    [Fact]
    public async Task Reversing_needs_support_staff()
    {
        var hill = await SignedInAsync(HillCountry);
        var response = await hill.PostAsJsonAsync("/api/v1/admin/adoptions/aa3/reverse", new { reason = "Mine again" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var support = await SignedInAsync(Support);
        Assert.Equal(HttpStatusCode.Conflict,
            (await support.PostAsJsonAsync("/api/v1/admin/adoptions/aa3/reverse", new { reason = "Never completed" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await support.PostAsJsonAsync("/api/v1/admin/adoptions/aa3/reverse", new { reason = "x" })).StatusCode);
    }

    // ── One adoption, end to end ─────────────────────────────────────────

    [Fact]
    public async Task Walks_an_adoption_from_application_to_reversal()
    {
        var maya = await SignedInAsync(Maya);
        var apa = await SignedInAsync(Apa);

        // Maya applies for Pepper (al2), who has a rival application (aa2).
        var applied = await maya.PostAsJsonAsync("/api/v1/adoptions/applications", Application("al2"));
        Assert.Equal(HttpStatusCode.Created, applied.StatusCode);
        var id = (await JsonOf(applied)).GetProperty("id").GetString()!;

        var queue = await JsonOf(await apa.GetAsync("/api/v1/adoptions/applications?as=shelter&status=submitted"));
        Assert.Contains(queue.GetProperty("items").EnumerateArray(),
            i => i.GetProperty("application").GetProperty("id").GetString() == id
                 && i.GetProperty("applicant").GetProperty("name").GetString() == "Maya Chen");

        Assert.Equal(HttpStatusCode.OK,
            (await apa.PatchAsJsonAsync($"/api/v1/adoptions/applications/{id}/status", new { status = "under_review" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await apa.PatchAsJsonAsync($"/api/v1/adoptions/applications/{id}/status", new { status = "approved" })).StatusCode);

        // Off the market while she settles.
        var listing = await JsonOf(await maya.GetAsync("/api/v1/adoptions/listings/al2"));
        Assert.Equal("pending", listing.GetProperty("listing").GetProperty("status").GetString());

        var paid = await maya.PostAsync($"/api/v1/adoptions/applications/{id}/payment", null);
        Assert.Equal(HttpStatusCode.OK, paid.StatusCode);
        var payment = await JsonOf(paid);
        Assert.Equal("paid", payment.GetProperty("status").GetString());
        Assert.Equal("demo", payment.GetProperty("payment").GetProperty("provider").GetString());

        var completed = await apa.PostAsJsonAsync($"/api/v1/adoptions/applications/{id}/complete", new { });
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
        var result = await JsonOf(completed);
        Assert.Equal("completed", result.GetProperty("application").GetProperty("status").GetString());
        Assert.Equal("u1", result.GetProperty("pet").GetProperty("ownerId").GetString());

        // Pepper is Maya's: her pet page answers for her, and the rival was told.
        Assert.Equal(HttpStatusCode.OK, (await maya.GetAsync("/api/v1/pets/p14")).StatusCode);
        var sofia = await SignedInAsync("sofia.marino@example.com");
        var rival = await JsonOf(await sofia.GetAsync("/api/v1/adoptions/applications/aa2"));
        Assert.Equal("rejected", rival.GetProperty("status").GetString());

        // And back again, by support staff.
        var support = await SignedInAsync(Support);
        var reversed = await support.PostAsJsonAsync($"/api/v1/admin/adoptions/{id}/reverse", new { reason = "Allergic to cats after all" });
        Assert.Equal(HttpStatusCode.OK, reversed.StatusCode);
        Assert.Equal("u24", (await JsonOf(reversed)).GetProperty("pet").GetProperty("ownerId").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await maya.GetAsync("/api/v1/pets/p14")).StatusCode);
    }
}
