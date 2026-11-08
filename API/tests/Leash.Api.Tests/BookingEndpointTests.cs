using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The caretaker and booking endpoints over HTTP, ending with the acceptance
/// walk REQUIREMENTS.md §6.4 asks for.
///
/// These cover what a service test structurally cannot (ARCHITECTURE.md §7):
/// that <c>[Authorize]</c> is on the actions that need it and <i>off</i> the two
/// that are deliberately public, that an illegal transition is a 409 while the
/// wrong party is a 403, and that a search result does not carry the searched
/// person's contact details.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class BookingEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string OwnerEmail = "maya.chen@example.com";     // u1
    private const string CaretakerEmail = "liam.novak@example.com"; // u7 = caretaker c1

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await Calendars.OpenCaretakerAsync(db.ConnectionString, "c1");   // STATUS §3-G
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

    // ── What is guarded, and what deliberately is not ────────────────────

    [Theory]
    [InlineData("GET", "/api/v1/bookings")]
    [InlineData("GET", "/api/v1/bookings/b1")]
    [InlineData("POST", "/api/v1/bookings")]
    [InlineData("PATCH", "/api/v1/bookings/b1/status")]
    [InlineData("GET", "/api/v1/bookings/b1/messages")]
    [InlineData("POST", "/api/v1/bookings/b1/messages")]
    [InlineData("POST", "/api/v1/bookings/b1/messages/read")]
    [InlineData("GET", "/api/v1/bookings/b1/reviews")]
    [InlineData("POST", "/api/v1/bookings/b1/reviews")]
    [InlineData("GET", "/api/v1/caretakers/c1/bookings")]
    [InlineData("PATCH", "/api/v1/users/u7/caretaker-profile")]
    public async Task Every_private_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path)
            {
                Content = JsonContent.Create(new { }),
            });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/v1/caretakers/search")]
    [InlineData("/api/v1/caretakers/c1")]
    [InlineData("/api/v1/users/u7/caretaker-profile")]
    [InlineData("/api/v1/users/u7/reviews")]
    public async Task Browsing_the_marketplace_needs_no_account(string path)
    {
        // Deliberately public: search is what brings people in, and a reputation
        // nobody can read is not one. Both return only public projections.
        var response = await _app.CreateSessionClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_search_result_carries_no_contact_details()
    {
        var page = await JsonOf(
            await _app.CreateSessionClient().GetAsync("/api/v1/caretakers/search"));

        var user = page.GetProperty("items")[0].GetProperty("user");

        Assert.False(user.TryGetProperty("email", out _));
        Assert.False(user.TryGetProperty("phone", out _));
        Assert.False(user.GetProperty("address").TryGetProperty("lat", out _));
    }

    [Fact]
    public async Task Search_pages_with_an_opaque_cursor()
    {
        var client = _app.CreateSessionClient();

        var first = await JsonOf(await client.GetAsync("/api/v1/caretakers/search?limit=2"));
        Assert.Equal(2, first.GetProperty("items").GetArrayLength());

        var cursor = first.GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrEmpty(cursor));

        var second = await JsonOf(
            await client.GetAsync($"/api/v1/caretakers/search?limit=2&cursor={Uri.EscapeDataString(cursor!)}"));

        var firstIds = first.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("profile").GetProperty("id").GetString()).ToArray();
        var secondIds = second.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("profile").GetProperty("id").GetString()).ToArray();

        Assert.Empty(firstIds.Intersect(secondIds));
    }

    // ── The status machine over HTTP ─────────────────────────────────────

    [Fact]
    public async Task An_owner_accepting_their_own_booking_is_a_403()
    {
        // REQUIREMENTS.md C8, stated as an acceptance criterion in §6.4.
        var owner = await SignedInAsync(OwnerEmail);

        var response = await owner.PatchAsJsonAsync(
            "/api/v1/bookings/b1/status", new { status = "accepted" });

        // 403, not 409: the move is legal, the person is wrong. The rule is
        // about who is asking.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("caretaker", (await JsonOf(response)).GetProperty("error").GetString()!);
    }

    [Fact]
    public async Task An_illegal_transition_is_a_409()
    {
        var caretaker = await SignedInAsync(CaretakerEmail);

        var response = await caretaker.PatchAsJsonAsync(
            "/api/v1/bookings/b1/status", new { status = "in_progress" });

        // 409, not 403: the rule is about the booking, not the person.
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var body = await JsonOf(response);
        Assert.True(body.TryGetProperty("error", out _));
        // Conflict merges its extra beside `error` rather than nesting it.
        Assert.Equal("b1", body.GetProperty("bookingId").GetString());
    }

    [Fact]
    public async Task A_booking_that_is_not_yours_reads_as_404()
    {
        // Not 403. Booking ids are sequential, so a caller who can tell
        // "no such booking" from "not yours" can count the marketplace's volume.
        var client = await SignedInAsync(OwnerEmail);

        // b2 belongs to somebody else.
        Assert.Equal(
            HttpStatusCode.NotFound,
            (await client.GetAsync("/api/v1/bookings/b2")).StatusCode);
    }

    [Fact]
    public async Task A_booking_body_cannot_carry_a_price()
    {
        // REQUIREMENTS.md C5. There is no price property to bind, so an extra
        // one is ignored and the rate card decides.
        var client = await SignedInAsync(OwnerEmail);

        var response = await client.PostAsJsonAsync("/api/v1/bookings", new
        {
            caretakerId = "c1",
            petIds = new[] { "p1" },
            serviceType = "walking",
            startDateTime = DateTimeOffset.UtcNow.AddDays(3),
            endDateTime = DateTimeOffset.UtcNow.AddDays(3).AddHours(1),
            notes = "",
            priceTotal = 1,      // ignored
            ownerId = "u3",      // ignored
            status = "completed" // ignored
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var booking = await JsonOf(response);
        Assert.Equal(28m, booking.GetProperty("priceTotal").GetDecimal());
        Assert.Equal("u1", booking.GetProperty("ownerId").GetString());
        Assert.Equal("requested", booking.GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_time_the_caretaker_has_not_published_is_a_409_with_a_code()
    {
        await Calendars.CloseCaretakerAsync(db.ConnectionString, "c1");
        var client = await SignedInAsync(OwnerEmail);
        var start = Calendars.DaysAhead(3, hour: 10);

        var response = await client.PostAsJsonAsync("/api/v1/bookings", new
        {
            caretakerId = "c1", petIds = new[] { "p1" }, serviceType = "walking",
            startDateTime = start, endDateTime = start.AddHours(1), notes = "", utcOffsetMinutes = 0,
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await JsonOf(response);
        Assert.Equal("not_available", body.GetProperty("code").GetString());
        Assert.Equal("c1", body.GetProperty("caretakerId").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("error").GetString()));
    }

    [Theory]
    [InlineData(-841)]
    [InlineData(841)]
    public async Task An_impossible_zone_offset_is_a_400(int offset)
    {
        var client = await SignedInAsync(OwnerEmail);
        var start = Calendars.DaysAhead(3, hour: 10);

        var response = await client.PostAsJsonAsync("/api/v1/bookings", new
        {
            caretakerId = "c1", petIds = new[] { "p1" }, serviceType = "walking",
            startDateTime = start, endDateTime = start.AddHours(1), notes = "", utcOffsetMinutes = offset,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues");
        Assert.Contains(issues.EnumerateArray(), i => i.GetProperty("path").GetString() == "utcOffsetMinutes");
    }

    [Fact]
    public async Task Marking_messages_read_is_a_post_and_a_get_does_not_do_it()
    {
        var owner = await SignedInAsync(OwnerEmail);
        var caretaker = await SignedInAsync(CaretakerEmail);

        await caretaker.PostAsJsonAsync(
            "/api/v1/bookings/b1/messages", new { body = "On my way." });

        // Reading the thread twice leaves it unread both times.
        for (var i = 0; i < 2; i++)
        {
            var thread = await JsonOf(await owner.GetAsync("/api/v1/bookings/b1/messages"));
            foreach (var message in thread.EnumerateArray())
                Assert.Equal(JsonValueKind.Null, message.GetProperty("readAt").ValueKind);
        }

        var read = await owner.PostAsync("/api/v1/bookings/b1/messages/read", null);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(1, (await JsonOf(read)).GetProperty("marked").GetInt32());
    }

    // ── The acceptance walk, REQUIREMENTS.md §6.4 ────────────────────────

    [Fact]
    public async Task Search_book_accept_message_complete_review_and_the_rating_moves()
    {
        var owner = await SignedInAsync(OwnerEmail);
        var caretaker = await SignedInAsync(CaretakerEmail);

        // 1. Search.
        var results = await JsonOf(
            await owner.GetAsync("/api/v1/caretakers/search?serviceType=walking&limit=50"));

        var found = results.GetProperty("items").EnumerateArray()
            .Select(c => c.GetProperty("profile").GetProperty("id").GetString())
            .ToArray();
        Assert.Contains("c1", found);

        var ratingBefore = (await JsonOf(await owner.GetAsync("/api/v1/caretakers/c1")))
            .GetProperty("profile").GetProperty("rating").GetDouble();

        // 2. Request a booking.
        var created = await owner.PostAsJsonAsync("/api/v1/bookings", new
        {
            caretakerId = "c1",
            petIds = new[] { "p1" },
            serviceType = "walking",
            startDateTime = DateTimeOffset.UtcNow.AddDays(3),
            endDateTime = DateTimeOffset.UtcNow.AddDays(3).AddHours(1),
            notes = "He pulls when he sees a squirrel.",
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var bookingId = (await JsonOf(created)).GetProperty("id").GetString()!;

        // 3. The caretaker accepts.
        var accepted = await caretaker.PatchAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/status", new { status = "accepted" });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        // 4. Both exchange messages.
        Assert.Equal(HttpStatusCode.Created, (await owner.PostAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/messages", new { body = "Thanks!" })).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await caretaker.PostAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/messages", new { body = "See you then." })).StatusCode);

        // 5. The caretaker runs it to completion.
        await caretaker.PatchAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/status", new { status = "in_progress" });
        var completed = await caretaker.PatchAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/status", new { status = "completed" });
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);

        // 6. Both leave reviews.
        var ownerReview = await owner.PostAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/reviews",
            new { toUserId = "u7", rating = 5, comment = "Biscuit adored him." });
        Assert.Equal(HttpStatusCode.Created, ownerReview.StatusCode);

        var caretakerReview = await caretaker.PostAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/reviews",
            new { toUserId = "u1", rating = 5, comment = "Lovely dog, clear notes." });
        Assert.Equal(HttpStatusCode.Created, caretakerReview.StatusCode);

        Assert.Equal(2, (await JsonOf(
            await owner.GetAsync($"/api/v1/bookings/{bookingId}/reviews"))).GetArrayLength());

        // 7. The caretaker's rating moved.
        var ratingAfter = (await JsonOf(await owner.GetAsync("/api/v1/caretakers/c1")))
            .GetProperty("profile").GetProperty("rating").GetDouble();

        Assert.True(
            ratingAfter > ratingBefore,
            $"a 5-star review should raise {ratingBefore}, got {ratingAfter}");

        // And a second review from the same person is refused.
        var again = await owner.PostAsJsonAsync(
            $"/api/v1/bookings/{bookingId}/reviews",
            new { toUserId = "u7", rating = 1, comment = "Changed my mind." });
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }
}
