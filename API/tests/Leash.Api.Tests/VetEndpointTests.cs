using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// Vets and appointments over HTTP — M5's endpoint suite, which it shipped
/// without. These pin what HANDOFF.md §7 recorded as hand-run curl walks: what
/// is guarded and what is deliberately public, 409 (the rule is about the
/// appointment) versus 403 (about the person), and the visit-summary seam —
/// records stamped with the vet the access check returned, under this
/// appointment whatever the body says.
///
/// Fixtures: a4 is Maya's (u1) requested video consult for Miso (p2) with
/// Dr Ruiz (u17, vet profile v1).
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class VetEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Maya = "maya.chen@example.com";      // u1, owns p1 and p2
    private const string Naomi = "naomi.ruiz@example.com";    // u17, vet v1
    private const string Daniel = "daniel.reyes@example.com"; // u2, unrelated

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
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = DemoPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static object Summary(string? bodyAppointmentId = null) => new
    {
        records = new object[]
        {
            new { type = "visit_note", title = "Mild gastritis", details = "Bland diet for five days." },
            new
            {
                type = "prescription", title = "Hypoallergenic diet", details = "Feed exclusively.",
                appointmentId = bodyAppointmentId, medicationName = "VetLine Hypoallergenic", dosage = "As directed",
                refillsLeft = 3, expiresAt = DateTimeOffset.UtcNow.AddMonths(6),
                productSlugs = new[] { "vetline-hypoallergenic-cat-dry" },
            },
        },
    };

    private async Task<HttpClient> StartVisitAsync()
    {
        var naomi = await SignedInAsync(Naomi);
        Assert.Equal(HttpStatusCode.OK,
            (await naomi.PatchAsJsonAsync("/api/v1/appointments/a4/status", new { status = "confirmed" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await naomi.PatchAsJsonAsync("/api/v1/appointments/a4/status", new { status = "in_progress" })).StatusCode);
        return naomi;
    }

    // ── What is guarded, and what deliberately is not ────────────────────

    [Theory]
    [InlineData("GET", "/api/v1/appointments")]
    [InlineData("GET", "/api/v1/appointments/a4")]
    [InlineData("POST", "/api/v1/appointments")]
    [InlineData("PATCH", "/api/v1/appointments/a4/status")]
    [InlineData("POST", "/api/v1/appointments/a4/visit-summary")]
    [InlineData("GET", "/api/v1/appointments/a4/reviews")]
    [InlineData("POST", "/api/v1/appointments/a4/reviews")]
    [InlineData("GET", "/api/v1/vets/v1/appointments")]
    [InlineData("PATCH", "/api/v1/users/u17/vet-profile")]
    public async Task Every_private_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    [Theory]
    [InlineData("/api/v1/vets/search")]
    [InlineData("/api/v1/vets/v1")]
    [InlineData("/api/v1/users/u17/vet-profile")]
    public async Task Finding_a_vet_needs_no_account(string path)
        => Assert.Equal(HttpStatusCode.OK, (await _app.CreateSessionClient().GetAsync(path)).StatusCode);

    [Fact]
    public async Task A_vet_search_result_carries_no_personal_contact_details()
    {
        var body = await (await _app.CreateSessionClient().GetAsync("/api/v1/vets/search")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("naomi.ruiz@example.com", body);
        Assert.DoesNotContain("\"email\"", body);
    }

    // ── 409 versus 403 ───────────────────────────────────────────────────

    [Fact]
    public async Task An_owner_cannot_confirm_their_own_appointment()
    {
        // V6. A legal move, by the wrong party: a rule about the person.
        var maya = await SignedInAsync(Maya);
        var response = await maya.PatchAsJsonAsync("/api/v1/appointments/a4/status", new { status = "confirmed" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Skipping_a_step_is_a_409_naming_the_appointment()
    {
        // requested → in_progress is not on §11.2's table: a rule about the
        // appointment, whoever asks.
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PatchAsJsonAsync("/api/v1/appointments/a4/status", new { status = "in_progress" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("a4", (await JsonOf(response)).GetProperty("appointmentId").GetString());
    }

    [Fact]
    public async Task Somebody_elses_appointment_is_a_404_not_a_403()
    {
        // Ids are sequential; telling "not yours" from "no such" would let a
        // stranger count the clinic's bookings.
        var daniel = await SignedInAsync(Daniel);

        Assert.Equal(HttpStatusCode.NotFound, (await daniel.GetAsync("/api/v1/appointments/a4")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await daniel.PatchAsJsonAsync("/api/v1/appointments/a4/status", new { status = "cancelled" })).StatusCode);
    }

    [Fact]
    public async Task Booking_for_somebody_elses_pet_is_refused()
    {
        var daniel = await SignedInAsync(Daniel);
        var start = DateTimeOffset.UtcNow.AddDays(3);

        var response = await daniel.PostAsJsonAsync("/api/v1/appointments", new
        {
            vetId = "v1", petId = "p2", mode = "video", reason = "Check-up", symptoms = Array.Empty<string>(),
            startDateTime = start, endDateTime = start.AddMinutes(30), notes = "",
        });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── The visit summary ────────────────────────────────────────────────

    [Fact]
    public async Task An_owner_cannot_write_the_visit_summary()
    {
        await StartVisitAsync();
        var maya = await SignedInAsync(Maya);

        var response = await maya.PostAsJsonAsync("/api/v1/appointments/a4/visit-summary", Summary());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_summary_lands_in_the_pets_record_under_this_appointment_whatever_the_body_says()
    {
        // V8, made structural: a body naming another appointment is overwritten.
        var naomi = await StartVisitAsync();

        var written = await naomi.PostAsJsonAsync("/api/v1/appointments/a4/visit-summary", Summary(bodyAppointmentId: "a1"));
        Assert.Equal(HttpStatusCode.Created, written.StatusCode);
        Assert.Equal("completed", (await JsonOf(written)).GetProperty("appointment").GetProperty("status").GetString());

        var maya = await SignedInAsync(Maya);
        var records = await JsonOf(await maya.GetAsync("/api/v1/pets/p2/medical-records"));
        var rx = records.EnumerateArray().Single(r => r.GetProperty("type").GetString() == "prescription");

        Assert.Equal("a4", rx.GetProperty("appointmentId").GetString());
        Assert.Equal("v1", rx.GetProperty("vetId").GetString());
        Assert.Equal("u17", rx.GetProperty("authorUserId").GetString());
    }

    [Fact]
    public async Task A_summary_without_records_is_refused()
    {
        var naomi = await StartVisitAsync();
        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a4/visit-summary", new { records = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_vet_cannot_review_the_client()
    {
        // V10: one direction only.
        var naomi = await StartVisitAsync();
        await naomi.PostAsJsonAsync("/api/v1/appointments/a4/visit-summary", Summary());

        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a4/reviews", new { toUserId = "u1", rating = 1, comment = "Late." });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_owner_reviews_the_vet_once_the_visit_is_complete()
    {
        var naomi = await StartVisitAsync();
        await naomi.PostAsJsonAsync("/api/v1/appointments/a4/visit-summary", Summary());
        var maya = await SignedInAsync(Maya);

        var response = await maya.PostAsJsonAsync("/api/v1/appointments/a4/reviews", new { toUserId = "u17", rating = 5, comment = "Kind and thorough." });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task A_vet_cannot_verify_themselves()
    {
        // V11: the badge is staff's, and the profile patch has no such field.
        await using (var conn = new Npgsql.NpgsqlConnection(db.ConnectionString))
            await Dapper.SqlMapper.ExecuteAsync(conn, "UPDATE vet_profiles SET \"verificationStatus\" = 'pending' WHERE id = 'v1'");

        var naomi = await SignedInAsync(Naomi);
        var patched = await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", new { verificationStatus = "verified", bio = "Updated bio." });
        Assert.Equal(HttpStatusCode.OK, patched.StatusCode);

        var profile = (await JsonOf(await _app.CreateClient().GetAsync("/api/v1/vets/v1"))).GetProperty("profile");
        Assert.Equal("pending", profile.GetProperty("verificationStatus").GetString());
        Assert.Equal("Updated bio.", profile.GetProperty("bio").GetString());
    }

    [Fact]
    public async Task A_vet_cannot_edit_another_vets_profile()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PatchAsJsonAsync("/api/v1/users/u18/vet-profile", new { bio = "Hijacked" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
