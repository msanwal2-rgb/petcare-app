using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The pet endpoints over HTTP.
///
/// These cover what a service test structurally cannot (ARCHITECTURE.md section
/// 7): that <c>[Authorize]</c> is actually on each action, that a refusal
/// carries the error envelope rather than <c>ProblemDetails</c>, and that the
/// wire shape is the one <c>web/src/types/index.ts</c> declares. M2's predicates
/// being correct is worth nothing if an action forgets to call one — and that
/// gap is exactly where an authorization hole lives.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class PetEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string MayaEmail = "maya.chen@example.com";    // u1, owns p1 + p2
    private const string VetEmail = "naomi.ruiz@example.com";    // u17 = vet v1, treats p1

    /// <summary>
    /// u7 = caretaker profile c1, whose booking b1 covers p1. Not Elena Petrova
    /// — STATUS.md names her as the caretaker demo login, and she is one, but
    /// her profile is c4 and she sits Luna (p4). The caretaker who can see
    /// Biscuit is this one.
    /// </summary>
    private const string CaretakerEmail = "liam.novak@example.com";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email, password = DemoPassword });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    // ── Every action is actually guarded ─────────────────────────────────

    [Theory]
    [InlineData("GET", "/api/v1/pets")]
    [InlineData("GET", "/api/v1/pets/p1")]
    [InlineData("POST", "/api/v1/pets")]
    [InlineData("PATCH", "/api/v1/pets/p1")]
    [InlineData("DELETE", "/api/v1/pets/p1")]
    [InlineData("GET", "/api/v1/pets/p1/appointments")]
    [InlineData("GET", "/api/v1/pets/p1/recommendations")]
    [InlineData("GET", "/api/v1/pets/p1/medical-records")]
    [InlineData("POST", "/api/v1/pets/p1/medical-records")]
    [InlineData("DELETE", "/api/v1/medical-records/mr6")]
    public async Task Every_pet_route_refuses_an_anonymous_caller(string method, string path)
    {
        // There is no fallback authorization policy in this app, deliberately:
        // a new action is public until it says otherwise. This is the test that
        // notices when one forgets to.
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path)
            {
                Content = JsonContent.Create(new { }),
            });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── The wire contract ────────────────────────────────────────────────

    [Fact]
    public async Task A_pet_serialises_with_a_nested_vet_contact_and_no_owned_since()
    {
        var client = await SignedInAsync(MayaEmail);
        var pet = await JsonOf(await client.GetAsync("/api/v1/pets/p1"));

        Assert.Equal("Biscuit", pet.GetProperty("name").GetString());
        Assert.Equal(
            "South Austin Animal Hospital",
            pet.GetProperty("vetContact").GetProperty("name").GetString());

        // ownedSince is an authorization input, not a display field. Nothing
        // renders it, so nothing ships it — and a client that never receives it
        // cannot send it back.
        Assert.False(pet.TryGetProperty("ownedSince", out _));

        // A calendar date, not an instant: a pet born on the 12th was born on
        // the 12th in every timezone.
        Assert.Equal("2021-05-12", pet.GetProperty("dob").GetString());
    }

    [Fact]
    public async Task A_pet_the_caller_may_not_see_reads_as_404_in_the_error_envelope()
    {
        // p4 is Luna, owned by u3. Maya has no claim on her.
        var client = await SignedInAsync(MayaEmail);
        var response = await client.GetAsync("/api/v1/pets/p4");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        // The envelope, not ProblemDetails. A `title`/`status`/`traceId` body
        // here is a shape the frontend's fetch layer cannot parse.
        var body = await JsonOf(response);
        Assert.True(body.TryGetProperty("error", out _));
        Assert.False(body.TryGetProperty("traceId", out _));
    }

    // ── Creating ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Creating_a_pet_returns_201_and_a_location()
    {
        var client = await SignedInAsync(MayaEmail);
        var response = await client.PostAsJsonAsync("/api/v1/pets", NewPetBody());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(response.Headers.Location);

        var pet = await JsonOf(response);
        Assert.Equal("u1", pet.GetProperty("ownerId").GetString());
    }

    [Fact]
    public async Task A_pet_body_carrying_an_owner_id_cannot_move_the_animal()
    {
        // The reference project's transfer backdoor, closed by the request type
        // having no such property: any extra JSON is bound to nothing and the
        // owner comes from the principal. The write still succeeds — it is not
        // a malformed request — but it creates *this* caller's pet.
        var client = await SignedInAsync(MayaEmail);
        var body = NewPetBody();
        body["ownerId"] = "u3";

        var response = await client.PostAsJsonAsync("/api/v1/pets", body);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("u1", (await JsonOf(response)).GetProperty("ownerId").GetString());
    }

    [Fact]
    public async Task A_patch_carrying_an_owner_id_does_not_move_the_animal()
    {
        var client = await SignedInAsync(MayaEmail);

        var response = await client.PatchAsJsonAsync(
            "/api/v1/pets/p1", new { name = "Biscuit II", ownerId = "u3" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var pet = await JsonOf(response);
        Assert.Equal("Biscuit II", pet.GetProperty("name").GetString());
        Assert.Equal("u1", pet.GetProperty("ownerId").GetString());
    }

    [Fact]
    public async Task An_invalid_pet_is_refused_with_field_paths_the_form_can_use()
    {
        var client = await SignedInAsync(MayaEmail);
        var body = NewPetBody();
        body["species"] = "dragon";
        body["name"] = "";

        var response = await client.PostAsJsonAsync("/api/v1/pets", body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var issues = (await JsonOf(response)).GetProperty("issues");
        var paths = issues.EnumerateArray()
            .Select(i => i.GetProperty("path").GetString())
            .ToArray();

        // camelCase, matching the JSON the client sent — not the C# property.
        Assert.Contains("species", paths);
        Assert.Contains("name", paths);
    }

    // ── Authorization, end to end ────────────────────────────────────────

    [Fact]
    public async Task A_caretaker_may_read_a_pet_they_sit_but_not_edit_it()
    {
        var client = await SignedInAsync(CaretakerEmail);

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/pets/p1")).StatusCode);

        var patch = await client.PatchAsJsonAsync("/api/v1/pets/p1", new { name = "Nope" });
        Assert.Equal(HttpStatusCode.Forbidden, patch.StatusCode);
    }

    [Fact]
    public async Task A_caretaker_is_refused_the_health_timeline()
    {
        // A booking is not clinical access. This is the seam between
        // CanViewPet and CanAccessPetRecords, over HTTP.
        var client = await SignedInAsync(CaretakerEmail);
        var response = await client.GetAsync("/api/v1/pets/p1/medical-records");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_treating_vet_reads_and_writes_the_health_timeline()
    {
        var client = await SignedInAsync(VetEmail);

        var read = await client.GetAsync("/api/v1/pets/p1/medical-records");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var write = await client.PostAsJsonAsync(
            "/api/v1/pets/p1/medical-records",
            new
            {
                type = "vaccination",
                title = "Rabies booster",
                occurredAt = "2026-07-12T16:15:00.000Z",
                appointmentId = "a3",
            });

        Assert.Equal(HttpStatusCode.Created, write.StatusCode);

        // Stamped with the vet profile the access check returned, never from
        // the body — the body could not name one if it tried.
        Assert.Equal("v1", (await JsonOf(write)).GetProperty("vetId").GetString());
    }

    [Fact]
    public async Task An_owner_writing_a_prescription_is_refused_with_a_usable_message()
    {
        var client = await SignedInAsync(MayaEmail);

        var response = await client.PostAsJsonAsync(
            "/api/v1/pets/p1/medical-records",
            new
            {
                type = "prescription",
                title = "Self-issued",
                occurredAt = "2026-07-12T16:15:00.000Z",
                productSlugs = new[] { "vetline-hydrolyzed-protein-dog-dry" },
            });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var error = (await JsonOf(response)).GetProperty("error").GetString();
        Assert.Contains("allergies and weights", error);
    }

    [Fact]
    public async Task An_owner_may_add_a_weight_to_their_own_pet()
    {
        var client = await SignedInAsync(MayaEmail);

        var response = await client.PostAsJsonAsync(
            "/api/v1/pets/p1/medical-records",
            new
            {
                type = "weight",
                title = "Weight recorded: 70 lb",
                occurredAt = "2026-07-12T16:15:00.000Z",
            });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var record = await JsonOf(response);
        Assert.Equal(JsonValueKind.Null, record.GetProperty("vetId").ValueKind);
        Assert.Equal("u1", record.GetProperty("authorUserId").GetString());
    }

    [Fact]
    public async Task An_owner_may_not_delete_what_their_vet_wrote()
    {
        // mr6 is a vaccination on p1, authored by u17.
        var client = await SignedInAsync(MayaEmail);
        var response = await client.DeleteAsync("/api/v1/medical-records/mr6");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── Deleting a pet ───────────────────────────────────────────────────

    [Fact]
    public async Task Deleting_a_pet_with_clinical_history_is_a_409_that_says_why()
    {
        var client = await SignedInAsync(MayaEmail);
        var response = await client.DeleteAsync("/api/v1/pets/p1");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var body = await JsonOf(response);
        Assert.Contains("health records", body.GetProperty("error").GetString());

        // Conflict merges its extra beside `error` rather than nesting it,
        // because that is what the client reads.
        Assert.Equal("p1", body.GetProperty("petId").GetString());
    }

    [Fact]
    public async Task Deleting_a_fresh_pet_returns_204_and_it_is_gone()
    {
        var client = await SignedInAsync(MayaEmail);

        var created = await JsonOf(
            await client.PostAsJsonAsync("/api/v1/pets", NewPetBody()));
        var id = created.GetProperty("id").GetString();

        Assert.Equal(
            HttpStatusCode.NoContent,
            (await client.DeleteAsync($"/api/v1/pets/{id}")).StatusCode);

        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync($"/api/v1/pets/{id}")).StatusCode);
    }

    // ── The batch and the timeline ───────────────────────────────────────

    [Fact]
    public async Task The_batch_filters_to_what_the_caller_may_see()
    {
        var client = await SignedInAsync(MayaEmail);
        var pets = await JsonOf(await client.GetAsync("/api/v1/pets?ids=p1,p4,p9"));

        Assert.Equal(["p1"], pets.EnumerateArray()
            .Select(p => p.GetProperty("id").GetString()));
    }

    [Fact]
    public async Task A_vet_sees_the_visit_timeline_with_no_fee_property_at_all()
    {
        var client = await SignedInAsync(VetEmail);
        var visits = await JsonOf(await client.GetAsync("/api/v1/pets/p1/appointments"));

        Assert.NotEmpty(visits.EnumerateArray());

        // Absent, not null. The reference modelled this as a separate type with
        // the property omitted, and the client distinguishes the two.
        foreach (var visit in visits.EnumerateArray())
            Assert.False(visit.TryGetProperty("fee", out _));
    }

    [Fact]
    public async Task The_owner_sees_the_same_timeline_with_the_fee_in_usd()
    {
        var client = await SignedInAsync(MayaEmail);
        var visits = await JsonOf(await client.GetAsync("/api/v1/pets/p1/appointments"));

        foreach (var visit in visits.EnumerateArray())
        {
            Assert.True(visit.TryGetProperty("fee", out var fee));
            // 8500 cents in the column; USD decimals on this DTO, because the
            // existing contract does that for an appointment fee.
            Assert.Equal(85m, fee.GetDecimal());
        }
    }

    [Fact]
    public async Task Recommendations_are_owner_only_over_http()
    {
        var vet = await SignedInAsync(VetEmail);
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await vet.GetAsync("/api/v1/pets/p1/recommendations")).StatusCode);

        var owner = await SignedInAsync(MayaEmail);
        var response = await owner.GetAsync("/api/v1/pets/p1/recommendations");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotEmpty((await JsonOf(response)).EnumerateArray());
    }

    private static Dictionary<string, object?> NewPetBody() => new()
    {
        ["name"] = "New Pet",
        ["species"] = "dog",
        ["breed"] = "Beagle",
        ["sex"] = "female",
        ["dob"] = "2024-01-01",
        ["weightLbs"] = 20,
        ["photoUrl"] = "https://example.com/p.jpg",
        ["vaccinated"] = true,
        ["allergies"] = Array.Empty<string>(),
        ["medications"] = Array.Empty<string>(),
        ["behaviorNotes"] = "Curious",
        ["feedingInstructions"] = "1 cup twice daily",
        ["vetContact"] = new { name = "Vet", phone = "(555) 000-0000" },
    };
}
