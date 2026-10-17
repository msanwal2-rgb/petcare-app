using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The bell over HTTP: guarded, scoped to the caller, the N7 contract, and the
/// M8 acceptance walk — a caretaker accepts, and the owner's bell says so.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class NotificationEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string OwnerEmail = "maya.chen@example.com";      // u1, owns b1
    private const string CaretakerEmail = "liam.novak@example.com"; // u7 = c1

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

    private async Task AcceptB1Async()
    {
        var liam = await SignedInAsync(CaretakerEmail);
        var accepted = await liam.PatchAsJsonAsync("/api/v1/bookings/b1/status", new { status = "accepted" });
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("POST")]
    public async Task Refuses_an_anonymous_caller_with_the_envelope(string method)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), "/api/v1/notifications")
            {
                Content = JsonContent.Create(new { ids = new[] { "n_x" } }),
            });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }

    [Fact]
    public async Task An_accepted_booking_rings_the_owners_bell()
    {
        await AcceptB1Async();

        var maya = await SignedInAsync(OwnerEmail);
        var feed = await JsonOf(await maya.GetAsync("/api/v1/notifications"));

        Assert.Equal(1, feed.GetProperty("unread").GetInt32());
        var n = feed.GetProperty("items")[0];
        Assert.Equal("booking_accepted", n.GetProperty("kind").GetString());
        Assert.Equal("/booking/b1", n.GetProperty("href").GetString());
        Assert.Equal(JsonValueKind.Null, n.GetProperty("readAt").ValueKind);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", n.GetProperty("createdAt").GetString());

        // The tie-break column is internal.
        Assert.False(n.TryGetProperty("seq", out _));
    }

    [Fact]
    public async Task The_caretaker_who_accepted_hears_nothing()
    {
        await AcceptB1Async();

        var liam = await SignedInAsync(CaretakerEmail);
        var feed = await JsonOf(await liam.GetAsync("/api/v1/notifications"));

        Assert.Equal(0, feed.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Marking_read_clears_what_was_named_and_reports_the_rest()
    {
        await AcceptB1Async();
        var maya = await SignedInAsync(OwnerEmail);
        var id = (await JsonOf(await maya.GetAsync("/api/v1/notifications")))
            .GetProperty("items")[0].GetProperty("id").GetString();

        var marked = await maya.PostAsJsonAsync("/api/v1/notifications", new { ids = new[] { id } });

        Assert.Equal(HttpStatusCode.OK, marked.StatusCode);
        Assert.Equal(0, (await JsonOf(marked)).GetProperty("unread").GetInt32());
    }

    [Fact]
    public async Task Somebody_elses_id_matches_nothing()
    {
        await AcceptB1Async();
        var maya = await SignedInAsync(OwnerEmail);
        var id = (await JsonOf(await maya.GetAsync("/api/v1/notifications")))
            .GetProperty("items")[0].GetProperty("id").GetString();

        var liam = await SignedInAsync(CaretakerEmail);
        var attempt = await liam.PostAsJsonAsync("/api/v1/notifications", new { ids = new[] { id } });
        Assert.Equal(HttpStatusCode.OK, attempt.StatusCode);

        var feed = await JsonOf(await maya.GetAsync("/api/v1/notifications"));
        Assert.Equal(1, feed.GetProperty("unread").GetInt32());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"ids\":[]}")]
    [InlineData("{\"id\":\"n_x\"}")]
    public async Task Marking_read_without_naming_anything_is_a_400_not_mark_all(string body)
    {
        // N7. The reference's `{}` meant "clear everything".
        await AcceptB1Async();
        var maya = await SignedInAsync(OwnerEmail);

        var response = await maya.PostAsync("/api/v1/notifications",
            new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Validation failed", (await JsonOf(response)).GetProperty("error").GetString());

        var feed = await JsonOf(await maya.GetAsync("/api/v1/notifications"));
        Assert.Equal(1, feed.GetProperty("unread").GetInt32());
    }
}
