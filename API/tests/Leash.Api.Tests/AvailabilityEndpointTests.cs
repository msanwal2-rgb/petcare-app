using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// Publishing availability over HTTP — what the new editor on the vet and
/// caretaker profile pages sends. The calendar is replace-whole: the days sent
/// become the whole published calendar. Each day is validated as a real clock
/// day (times exist, slots end after they start and do not overlap, a bounded
/// number of them) and the calendar as a whole is bounded.
///
/// Fixtures: Dr Ruiz (u17, vet v1) and Elena (u10, caretaker c4), both with
/// published days only in July 2026.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class AvailabilityEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Naomi = "naomi.ruiz@example.com";
    private const string Elena = "elena.petrova@example.com";
    private const string Maya = "maya.chen@example.com";

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

    private static string Day(int fromToday) => DateTime.UtcNow.Date.AddDays(fromToday).ToString("yyyy-MM-dd");

    private static object Slot(string start, string end) => new { start, end };

    private static object OneDay(params object[] slots) => new
    {
        availability = new[] { new { date = Day(3), slots } },
    };

    private static async Task AssertIssueAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues").EnumerateArray().ToList();
        Assert.Contains(issues, i => i.GetProperty("path").GetString()!.StartsWith("availability"));
    }

    [Fact]
    public async Task A_vet_publishes_days_and_they_replace_the_old_calendar()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", new
        {
            availability = new[]
            {
                new { date = Day(2), slots = new[] { Slot("09:00", "12:00"), Slot("13:00", "17:00") } },
                new { date = Day(9), slots = new[] { Slot("10:00", "14:00") } },
            },
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // What owners read — the July days are gone, the new ones are there.
        var vet = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/vets/v1"));
        var days = vet.GetProperty("profile").GetProperty("availability").EnumerateArray().ToList();
        Assert.Equal([Day(2), Day(9)], days.Select(d => d.GetProperty("date").GetString()).ToArray());
        Assert.Equal(2, days[0].GetProperty("slots").GetArrayLength());
    }

    [Fact]
    public async Task Saving_the_rest_of_the_profile_leaves_the_calendar_alone()
    {
        var naomi = await SignedInAsync(Naomi);
        var before = (await JsonOf(await naomi.GetAsync("/api/v1/users/u17/vet-profile")))
            .GetProperty("availability").GetArrayLength();

        var response = await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", new { bio = "Still here." });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Equal(before, (await JsonOf(response)).GetProperty("availability").GetArrayLength());
    }

    [Fact]
    public async Task An_empty_calendar_closes_every_day()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile",
            new { availability = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(0, (await JsonOf(response)).GetProperty("availability").GetArrayLength());
    }

    [Fact]
    public async Task A_caretaker_publishes_days_the_same_way()
    {
        var elena = await SignedInAsync(Elena);
        var response = await elena.PatchAsJsonAsync("/api/v1/users/u10/caretaker-profile", new
        {
            availability = new[] { new { date = Day(4), slots = new[] { Slot("08:00", "18:00") } } },
        });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var carer = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/caretakers/c4"));
        var day = Assert.Single(carer.GetProperty("profile").GetProperty("availability").EnumerateArray().ToList());
        Assert.Equal(Day(4), day.GetProperty("date").GetString());
    }

    [Fact]
    public async Task Nobody_publishes_somebody_elses_calendar()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", OneDay(Slot("09:00", "10:00")));

        Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
        var vet = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/vets/v1"));
        Assert.DoesNotContain(vet.GetProperty("profile").GetProperty("availability").EnumerateArray(),
            d => d.GetProperty("date").GetString() == Day(3));
    }

    [Theory]
    [InlineData("24:00", "25:00")]
    [InlineData("09:75", "10:00")]
    [InlineData("9:00", "10:00")]
    [InlineData("12:00", "09:00")]
    public async Task A_time_that_is_not_a_clock_time_or_runs_backwards_is_refused(string start, string end)
    {
        var naomi = await SignedInAsync(Naomi);
        await AssertIssueAsync(await naomi.PatchAsJsonAsync(
            "/api/v1/users/u17/vet-profile", OneDay(Slot(start, end))));
    }

    [Fact]
    public async Task Overlapping_hours_on_one_day_are_refused()
    {
        var naomi = await SignedInAsync(Naomi);
        await AssertIssueAsync(await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile",
            OneDay(Slot("13:00", "17:00"), Slot("09:00", "13:30"))));
    }

    [Fact]
    public async Task Hours_that_meet_end_to_start_are_fine()
    {
        var naomi = await SignedInAsync(Naomi);
        var response = await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile",
            OneDay(Slot("09:00", "12:00"), Slot("12:00", "15:00")));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_day_is_bounded()
    {
        var naomi = await SignedInAsync(Naomi);
        var slots = Enumerable.Range(0, 13).Select(h => Slot($"{h:00}:00", $"{h:00}:30")).ToArray();

        await AssertIssueAsync(await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", OneDay(slots)));
    }

    [Fact]
    public async Task The_calendar_is_bounded()
    {
        var elena = await SignedInAsync(Elena);
        var days = Enumerable.Range(0, 401)
            .Select(i => new { date = Day(i), slots = new[] { Slot("09:00", "10:00") } })
            .ToArray();

        await AssertIssueAsync(await elena.PatchAsJsonAsync(
            "/api/v1/users/u10/caretaker-profile", new { availability = days }));
    }

    [Fact]
    public async Task The_same_date_twice_is_refused()
    {
        var naomi = await SignedInAsync(Naomi);
        await AssertIssueAsync(await naomi.PatchAsJsonAsync("/api/v1/users/u17/vet-profile", new
        {
            availability = new[]
            {
                new { date = Day(3), slots = new[] { Slot("09:00", "10:00") } },
                new { date = Day(3), slots = new[] { Slot("11:00", "12:00") } },
            },
        }));
    }
}
