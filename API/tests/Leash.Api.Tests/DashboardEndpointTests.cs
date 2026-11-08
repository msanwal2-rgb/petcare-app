using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The dashboards over HTTP: the three stats routes, the window form of the
/// four schedule lists, and the reschedule route — what is guarded, what each
/// refusal looks like on the wire, and that the query string is validated into
/// the envelope rather than silently ignored.
///
/// Fixtures as <see cref="DashboardServiceTests"/>: Dr Ruiz (u17, v1) has a3
/// confirmed and a4 requested in July 2026; Elena (u10) is caretaker c4.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class DashboardEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Maya = "maya.chen@example.com";      // u1
    private const string Naomi = "naomi.ruiz@example.com";    // u17, vet v1
    private const string Elena = "elena.petrova@example.com"; // u10, caretaker c4
    private const string Daniel = "daniel.reyes@example.com"; // u2, unrelated

    private const string July = "from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static string[] Ids(JsonElement page)
        => [.. page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!)];

    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = DemoPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static object InDays(int days)
    {
        var start = DateTimeOffset.UtcNow.AddDays(days);
        return new { startDateTime = start, endDateTime = start.AddMinutes(30) };
    }

    // ── Guards ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData("GET", "/api/v1/vets/v1/stats")]
    [InlineData("GET", "/api/v1/caretakers/c4/stats")]
    [InlineData("GET", "/api/v1/me/stats")]
    [InlineData("POST", "/api/v1/appointments/a3/reschedule")]
    [InlineData("GET", "/api/v1/vets/v1/appointments?" + July)]
    [InlineData("GET", "/api/v1/bookings?" + July)]
    public async Task Every_new_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    [Theory]
    [InlineData("/api/v1/vets/v1/stats")]
    [InlineData("/api/v1/caretakers/c4/stats")]
    [InlineData("/api/v1/vets/v1/appointments?" + July)]
    [InlineData("/api/v1/caretakers/c4/bookings?" + July)]
    public async Task Somebody_elses_figures_and_calendar_are_a_404(string path)
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    // ── The cards ────────────────────────────────────────────────────────

    [Fact]
    public async Task A_vet_reads_its_cards()
    {
        var naomi = await SignedInAsync(Naomi);
        var body = await JsonOf(await naomi.GetAsync("/api/v1/vets/v1/stats"));

        Assert.Equal(4, body.GetProperty("total").GetInt32());
        Assert.Equal(0, body.GetProperty("upcoming").GetInt32());
        Assert.Equal(2, body.GetProperty("completed").GetInt32());
        Assert.Equal(17000, body.GetProperty("earnedCents").GetInt32());
    }

    [Fact]
    public async Task A_caretaker_reads_its_cards_with_the_viewers_today()
    {
        var elena = await SignedInAsync(Elena);
        var from = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddHours(-5).ToString("O"));
        var response = await elena.GetAsync($"/api/v1/caretakers/c4/stats?from={from}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonOf(response);
        Assert.Equal(3, body.GetProperty("total").GetInt32());
        Assert.Equal(7000, body.GetProperty("earnedCents").GetInt32());
    }

    [Fact]
    public async Task An_owner_reads_their_own_cards()
    {
        var maya = await SignedInAsync(Maya);
        var body = await JsonOf(await maya.GetAsync("/api/v1/me/stats"));

        Assert.Equal(6, body.GetProperty("requests").GetInt32());
        Assert.Equal(2, body.GetProperty("completed").GetInt32());
        Assert.Equal(23058, body.GetProperty("spentCents").GetInt32());
        Assert.False(body.TryGetProperty("earnedCents", out _));
    }

    // ── The window ───────────────────────────────────────────────────────

    [Fact]
    public async Task A_window_reads_the_calendar_soonest_first()
    {
        var naomi = await SignedInAsync(Naomi);
        var page = await JsonOf(await naomi.GetAsync("/api/v1/vets/v1/appointments?" + July));

        Assert.Equal(["a3", "a4"], Ids(page));
        Assert.Equal(JsonValueKind.Null, page.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public async Task Without_a_window_the_list_is_what_it_always_was()
    {
        // Newest first by visit date — a4 (July 15) before a3 (July 12).
        var naomi = await SignedInAsync(Naomi);
        var page = await JsonOf(await naomi.GetAsync("/api/v1/vets/v1/appointments?limit=2"));

        Assert.Equal(["a4", "a3"], Ids(page));
    }

    [Fact]
    public async Task An_owners_window_takes_a_status_filter()
    {
        var maya = await SignedInAsync(Maya);
        var page = await JsonOf(await maya.GetAsync(
            "/api/v1/bookings?from=2026-06-01T00:00:00.000Z&status=completed,in_progress"));

        Assert.Equal(["b17", "b7"], Ids(page));
    }

    [Fact]
    public async Task A_caretakers_window_reads_its_bookings()
    {
        var elena = await SignedInAsync(Elena);
        var page = await JsonOf(await elena.GetAsync("/api/v1/caretakers/c4/bookings?" + July));

        Assert.Equal(["b2", "b5"], Ids(page));
    }

    [Theory]
    [InlineData("/api/v1/appointments?to=2026-08-01T00:00:00.000Z", "to")]
    [InlineData("/api/v1/appointments?status=confirmed", "status")]
    [InlineData("/api/v1/appointments?from=2026-08-01T00:00:00.000Z&to=2026-07-01T00:00:00.000Z", "to")]
    [InlineData("/api/v1/appointments?from=2026-07-01T00:00:00.000Z&status=accepted", "status")]
    [InlineData("/api/v1/bookings?from=2026-07-01T00:00:00.000Z&status=confirmed", "status")]
    [InlineData("/api/v1/bookings?limit=0", "limit")]
    public async Task A_bad_window_is_a_validation_failure(string path, string field)
    {
        // `accepted` is a booking word and `confirmed` an appointment word:
        // each list knows its own vocabulary.
        var maya = await SignedInAsync(Maya);
        var response = await maya.GetAsync(path);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues").EnumerateArray().ToList();
        Assert.Contains(issues, i => i.GetProperty("path").GetString() == field);
    }

    // ── Rescheduling ─────────────────────────────────────────────────────

    [Fact]
    public async Task The_vet_reschedules_and_the_owner_hears_about_it()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a3/reschedule", InDays(4));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var moved = await JsonOf(response);
        Assert.Equal("confirmed", moved.GetProperty("status").GetString());
        // The wire format the frontend compares as strings.
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$",
            moved.GetProperty("startDateTime").GetString()!);

        var maya = await SignedInAsync(Maya);
        var feed = await JsonOf(await maya.GetAsync("/api/v1/notifications"));
        var notice = Assert.Single(feed.GetProperty("items").EnumerateArray().ToList());
        Assert.Equal("appointment_rescheduled", notice.GetProperty("kind").GetString());
        Assert.Equal("/appointments/a3", notice.GetProperty("href").GetString());

        // And the owner's view of the appointment shows the new time.
        var seen = await JsonOf(await maya.GetAsync("/api/v1/appointments/a3"));
        Assert.Equal(moved.GetProperty("startDateTime").GetString(), seen.GetProperty("startDateTime").GetString());
    }

    [Fact]
    public async Task An_owner_cannot_reschedule_and_is_told_why()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PostAsJsonAsync("/api/v1/appointments/a3/reschedule", InDays(4));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("Only the vet", (await JsonOf(response)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_stranger_gets_a_404()
    {
        var daniel = await SignedInAsync(Daniel);
        var response = await daniel.PostAsJsonAsync("/api/v1/appointments/a3/reschedule", InDays(4));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_completed_visit_cannot_be_moved()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a1/reschedule", InDays(4));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("a1", (await JsonOf(response)).GetProperty("appointmentId").GetString());
    }

    [Fact]
    public async Task A_time_in_the_past_is_a_400()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a3/reschedule", InDays(-1));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    [Fact]
    public async Task A_window_that_ends_before_it_starts_is_a_validation_failure()
    {
        var naomi = await SignedInAsync(Naomi);
        var start = DateTimeOffset.UtcNow.AddDays(3);
        var response = await naomi.PostAsJsonAsync("/api/v1/appointments/a3/reschedule",
            new { startDateTime = start, endDateTime = start.AddMinutes(-30) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues").EnumerateArray().ToList();
        Assert.Contains(issues, i => i.GetProperty("path").GetString() == "endDateTime");
    }
}
