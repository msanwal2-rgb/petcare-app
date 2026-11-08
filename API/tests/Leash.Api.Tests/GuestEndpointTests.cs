using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// Booking as a guest, over HTTP (STATUS §3-G): <c>POST /guest/bookings</c>,
/// <c>POST /guest/appointments</c> and <c>POST /auth/set-password</c> are
/// public; everything else about a guest goes through the existing routes.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class GuestEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string GuestEmail = "sam.guest@example.com";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await Calendars.OpenCaretakerAsync(db.ConnectionString, "c1");
        await Calendars.OpenVetAsync(db.ConnectionString, "v1");
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static object Guest(string email = GuestEmail) => new { name = "Sam Lee", email, phone = "+1 512 555 0100" };

    private static object Pet(string species = "dog", string dob = "2021-04-02", int weightLbs = 24) => new
    {
        name = "Biscuit", species, breed = "Beagle", sex = "male", dob, weightLbs,
        allergies = new[] { "chicken" }, behaviorNotes = "Shy with big dogs",
    };

    private static object Walk(string caretakerId = "c1", int days = 3, int offset = 0)
    {
        var start = Calendars.DaysAhead(days, 10);
        return new
        {
            caretakerId, serviceType = "walking",
            startDateTime = start, endDateTime = start.AddHours(1), notes = "", utcOffsetMinutes = offset,
        };
    }

    private static object BookingBody(
        object? guest = null, object? pet = null, object? booking = null, bool saveAccount = false)
        => new { guest = guest ?? Guest(), pet = pet ?? Pet(), booking = booking ?? Walk(), saveAccount };

    private static object Visit()
    {
        var start = Calendars.DaysAhead(3, 10);
        return new
        {
            vetId = "v1", mode = "in_clinic", reason = "Check-up", symptoms = Array.Empty<string>(),
            startDateTime = start, endDateTime = start.AddMinutes(30), notes = "", utcOffsetMinutes = 0,
        };
    }

    private static string TokenFromLink(string link)
        => System.Web.HttpUtility.ParseQueryString(new Uri(link).Query)["token"]!;

    // ── Booking a caretaker ──────────────────────────────────────────────

    [Fact]
    public async Task Anyone_can_book_a_caretaker_as_a_guest()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonOf(response);

        Assert.Equal(
            ["accountEmailSent", "booking", "caretakerName", "petName"],
            body.EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal(
            ["endDateTime", "id", "priceTotal", "serviceType", "startDateTime", "status"],
            body.GetProperty("booking").EnumerateObject().Select(p => p.Name).Order());

        Assert.Equal("requested", body.GetProperty("booking").GetProperty("status").GetString());
        Assert.Equal(28m, body.GetProperty("booking").GetProperty("priceTotal").GetDecimal());
        Assert.Equal("Liam Novak", body.GetProperty("caretakerName").GetString());
        Assert.Equal("Biscuit", body.GetProperty("petName").GetString());
        Assert.False(body.GetProperty("accountEmailSent").GetBoolean());
    }

    [Fact]
    public async Task Saving_the_account_reports_the_email_and_dev_mode_shows_the_link()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/guest/bookings", BookingBody(saveAccount: true));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonOf(response);
        Assert.True(body.GetProperty("accountEmailSent").GetBoolean());

        // The suite runs with Email:DevMode, as the other email flows do; the
        // link is never in a response outside Development.
        Assert.Contains("/set-password?token=", body.GetProperty("devLink").GetString());
    }

    [Fact]
    public async Task A_signed_in_session_does_not_make_the_guest_route_book_as_that_user()
    {
        var maya = _app.CreateSessionClient();
        await maya.PostAsJsonAsync("/api/v1/auth/login", new { email = "maya.chen@example.com", password = "leashdemo123" });

        var response = await maya.PostAsJsonAsync("/api/v1/guest/bookings", BookingBody());

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        var owner = await conn.QuerySingleAsync<string>(
            """SELECT "ownerId" FROM bookings WHERE id = @id""",
            new { id = (await JsonOf(response)).GetProperty("booking").GetProperty("id").GetString() });
        Assert.NotEqual("u1", owner);
    }

    public static TheoryData<string, object> BadBodies => new()
    {
        { "guest.email", BookingBody(guest: new { name = "Sam", email = "not-an-email", phone = "+1 512 555 0100" }) },
        { "guest.name", BookingBody(guest: new { name = "", email = GuestEmail, phone = "+1 512 555 0100" }) },
        { "guest.phone", BookingBody(guest: new { name = "Sam", email = GuestEmail, phone = "" }) },
        { "guest.phone", BookingBody(guest: new { name = "Sam", email = GuestEmail, phone = "call me maybe" }) },
        { "pet.species", BookingBody(pet: Pet(species: "fish")) },
        { "pet.dob", BookingBody(pet: Pet(dob: "2099-01-01")) },
        { "pet.weightLbs", BookingBody(pet: Pet(weightLbs: 500)) },
        { "booking.serviceType", BookingBody(booking: new { caretakerId = "c1", serviceType = "grooming", startDateTime = Calendars.DaysAhead(3, 10), endDateTime = Calendars.DaysAhead(3, 11) }) },
        { "booking.utcOffsetMinutes", BookingBody(booking: Walk(offset: 900)) },
    };

    [Theory]
    [MemberData(nameof(BadBodies))]
    public async Task A_bad_field_is_a_400_naming_it(string path, object body)
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues");
        Assert.Contains(issues.EnumerateArray(), i => i.GetProperty("path").GetString() == path);
    }

    [Fact]
    public async Task An_unknown_caretaker_is_a_404()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/guest/bookings", BookingBody(booking: Walk(caretakerId: "ghost")));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task An_email_with_an_account_is_a_409_telling_them_to_sign_in()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/guest/bookings", BookingBody(guest: Guest("maya.chen@example.com")));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("account_exists", (await JsonOf(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_closed_day_is_a_409_not_available()
    {
        await Calendars.CloseCaretakerAsync(db.ConnectionString, "c1");

        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody());

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("not_available", (await JsonOf(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Too_soon_is_a_409_with_the_earliest_time()
    {
        var soon = DateTimeOffset.UtcNow.AddHours(3);
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(
            booking: new { caretakerId = "c1", serviceType = "walking", startDateTime = soon, endDateTime = soon.AddHours(1), utcOffsetMinutes = 0 }));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await JsonOf(response);
        Assert.Equal(24, body.GetProperty("leadTimeHours").GetInt32());
        Assert.False(body.GetProperty("isMember").GetBoolean());
        Assert.True(body.TryGetProperty("earliestAt", out _));
    }

    [Fact]
    public async Task Guest_booking_is_rate_limited_per_client()
    {
        var client = _app.CreateSessionClient();

        for (var i = 0; i < 5; i++)
        {
            var ok = await client.PostAsJsonAsync("/api/v1/guest/bookings",
                BookingBody(guest: Guest($"guest{i}@example.com"), booking: Walk(days: 3 + i)));
            Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        }

        var limited = await client.PostAsJsonAsync("/api/v1/guest/bookings",
            BookingBody(guest: Guest("guest9@example.com"), booking: Walk(days: 9)));
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
    }

    [Fact]
    public async Task Guest_booking_is_rate_limited_per_email()
    {
        var client = _app.CreateSessionClient();

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.Created,
                (await client.PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(booking: Walk(days: 3 + i)))).StatusCode);

        var limited = await client.PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(booking: Walk(days: 7)));
        Assert.Equal((HttpStatusCode)429, limited.StatusCode);
    }

    // ── Booking a vet ────────────────────────────────────────────────────

    [Fact]
    public async Task Anyone_can_book_a_vet_as_a_guest()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/appointments",
            new { guest = Guest(), pet = Pet(), appointment = Visit(), saveAccount = false });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonOf(response);
        Assert.Equal(
            ["accountEmailSent", "appointment", "petName", "vetName"],
            body.EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal(
            ["endDateTime", "fee", "id", "mode", "startDateTime", "status"],
            body.GetProperty("appointment").EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal("requested", body.GetProperty("appointment").GetProperty("status").GetString());
    }

    [Fact]
    public async Task A_vet_visit_with_an_account_email_is_a_409()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/appointments",
            new { guest = Guest("maya.chen@example.com"), pet = Pet(), appointment = Visit(), saveAccount = false });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("account_exists", (await JsonOf(response)).GetProperty("code").GetString());
    }

    // ── What the provider sees ───────────────────────────────────────────

    private async Task<HttpClient> SignedInAsync(string email)
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = "leashdemo123" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    [Fact]
    public async Task The_caretaker_sees_how_to_reach_a_guest_until_they_have_an_account()
    {
        // A guest cannot read messages, so their caretaker gets their phone and
        // email on the booking — and only until the account is claimed.
        var guest = _app.CreateSessionClient();
        var booked = await JsonOf(await guest.PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(saveAccount: true)));
        var id = booked.GetProperty("booking").GetProperty("id").GetString();
        var liam = await SignedInAsync("liam.novak@example.com");

        var asGuest = await JsonOf(await liam.GetAsync($"/api/v1/bookings/{id}"));
        var contact = asGuest.GetProperty("guestContact");
        Assert.Equal("Sam Lee", contact.GetProperty("name").GetString());
        Assert.Equal(GuestEmail, contact.GetProperty("email").GetString());
        Assert.Equal("+1 512 555 0100", contact.GetProperty("phone").GetString());

        await guest.PostAsJsonAsync("/api/v1/auth/set-password",
            new { token = TokenFromLink(booked.GetProperty("devLink").GetString()!), password = "a-new-password" });

        var claimed = await JsonOf(await liam.GetAsync($"/api/v1/bookings/{id}"));
        Assert.False(claimed.TryGetProperty("guestContact", out _));
    }

    [Fact]
    public async Task An_ordinary_booking_carries_no_guest_contact()
    {
        var liam = await SignedInAsync("liam.novak@example.com");

        var b1 = await JsonOf(await liam.GetAsync("/api/v1/bookings/b1"));

        Assert.False(b1.TryGetProperty("guestContact", out _));
    }

    [Fact]
    public async Task The_clinic_sees_how_to_reach_a_guest()
    {
        var booked = await JsonOf(await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/appointments",
            new { guest = Guest(), pet = Pet(), appointment = Visit(), saveAccount = false }));
        var id = booked.GetProperty("appointment").GetProperty("id").GetString();
        var naomi = await SignedInAsync("naomi.ruiz@example.com");

        var visit = await JsonOf(await naomi.GetAsync($"/api/v1/appointments/{id}"));

        Assert.Equal("+1 512 555 0100", visit.GetProperty("guestContact").GetProperty("phone").GetString());
    }

    // ── Becoming an account ──────────────────────────────────────────────

    [Fact]
    public async Task Setting_the_password_signs_the_guest_in_with_their_booking()
    {
        var client = _app.CreateSessionClient();
        var booked = await JsonOf(await client.PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(saveAccount: true)));
        var bookingId = booked.GetProperty("booking").GetProperty("id").GetString();
        var token = TokenFromLink(booked.GetProperty("devLink").GetString()!);

        var set = await client.PostAsJsonAsync("/api/v1/auth/set-password", new { token, password = "a-new-password" });

        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        Assert.Equal("active", (await JsonOf(set)).GetProperty("user").GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/me")).StatusCode);
        var mine = await JsonOf(await client.GetAsync("/api/v1/bookings"));
        Assert.Contains(mine.GetProperty("items").EnumerateArray(), b => b.GetProperty("id").GetString() == bookingId);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/v1/bookings/{bookingId}")).StatusCode);

        // And the new password signs in from anywhere.
        var login = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = GuestEmail, password = "a-new-password" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task A_used_or_made_up_token_is_a_400_in_the_envelope()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/set-password", new { token = "made-up", password = "a-new-password" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace((await JsonOf(response)).GetProperty("error").GetString()));
    }

    [Fact]
    public async Task A_short_password_is_a_400()
    {
        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/set-password", new { token = "anything", password = "short" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var issues = (await JsonOf(response)).GetProperty("issues");
        Assert.Contains(issues.EnumerateArray(), i => i.GetProperty("path").GetString() == "password");
    }

    [Fact]
    public async Task A_guest_cannot_sign_in()
    {
        await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody(saveAccount: true));

        var login = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/login", new { email = GuestEmail, password = "anything-at-all" });

        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task Signing_up_with_a_guest_email_sends_the_setup_link_instead()
    {
        await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody());

        var signup = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/signup",
            new { name = "Sam Lee", email = GuestEmail, password = "a-new-password" });

        Assert.Equal(HttpStatusCode.Conflict, signup.StatusCode);
        var body = await JsonOf(signup);
        Assert.Equal("finish_setup", body.GetProperty("code").GetString());
        Assert.Contains("/set-password?token=", body.GetProperty("devLink").GetString());
    }

    [Fact]
    public async Task Signing_up_with_an_account_email_is_unchanged()
    {
        var signup = await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/auth/signup",
            new { name = "Maya", email = "maya.chen@example.com", password = "a-new-password" });

        Assert.Equal(HttpStatusCode.Conflict, signup.StatusCode);
        Assert.False((await JsonOf(signup)).TryGetProperty("code", out _));
    }

    [Fact]
    public async Task Forgot_password_answers_a_guest_the_same_way_with_a_setup_link()
    {
        await _app.CreateSessionClient().PostAsJsonAsync("/api/v1/guest/bookings", BookingBody());

        var response = await _app.CreateSessionClient().PostAsJsonAsync(
            "/api/v1/auth/forgot-password", new { email = GuestEmail });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonOf(response);
        Assert.True(body.GetProperty("ok").GetBoolean());
        Assert.Contains("/set-password?token=", body.GetProperty("devLink").GetString());
    }
}
