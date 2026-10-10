using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Leash.Api.Tests.Infrastructure;

namespace Leash.Api.Tests;

/// <summary>
/// The users endpoints, with most of the attention on the two projections.
///
/// The reference project's GET /api/users/:id returned the whole record — email
/// address, phone number and the home coordinates its search map is drawn from
/// — to anyone who asked, against ids that count upward from u1. The public
/// projection is the fix, and these tests are what stop it regressing.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class UserEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string MayaEmail = "maya.chen@example.com";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _app = new LeashApp(db.ConnectionString);
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private static async Task<JsonElement> JsonOf(HttpResponseMessage response)
        => JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private async Task<HttpClient> SignedInAsync()
    {
        var client = _app.CreateSessionClient();
        var login = await client.PostAsJsonAsync(
            "/api/v1/auth/login", new { email = MayaEmail, password = DemoPassword });

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    [Fact]
    public async Task A_public_profile_carries_no_contact_details()
    {
        var body = await JsonOf(await _app.CreateSessionClient().GetAsync("/api/v1/users/u1"));

        Assert.Equal("Maya Chen", body.GetProperty("name").GetString());
        Assert.Equal("Austin", body.GetProperty("address").GetProperty("city").GetString());

        Assert.False(body.TryGetProperty("email", out _));
        Assert.False(body.TryGetProperty("phone", out _));
        Assert.False(body.TryGetProperty("staffRoles", out _));

        // Not even coordinates. A city is a location; a latitude is a house.
        Assert.False(body.GetProperty("address").TryGetProperty("lat", out _));
    }

    [Fact]
    public async Task Me_carries_the_full_record()
    {
        var body = await JsonOf(await (await SignedInAsync()).GetAsync("/api/v1/me"));

        Assert.Equal(MayaEmail, body.GetProperty("email").GetString());
        Assert.True(body.GetProperty("address").TryGetProperty("lat", out _));
    }

    [Fact]
    public async Task A_deleted_account_is_not_served_to_a_profile_page()
    {
        await using var conn = await db.DataSource.OpenConnectionAsync();
        await Dapper.SqlMapper.ExecuteAsync(conn,
            "UPDATE users SET status = 'deleted', \"deletedAt\" = now() WHERE id = 'u3'");

        var response = await _app.CreateSessionClient().GetAsync("/api/v1/users/u3");

        // The row stays, so orders and reviews keep their author
        // (REQUIREMENTS.md A16) — but there is no reason to serve the husk.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Patching_your_own_account_works()
    {
        var response = await (await SignedInAsync()).PatchAsJsonAsync("/api/v1/users/u1", new
        {
            name = "Maya C.",
            roles = new[] { "owner", "caretaker" },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await JsonOf(response);
        Assert.Equal("Maya C.", body.GetProperty("name").GetString());
        Assert.Equal(2, body.GetProperty("roles").GetArrayLength());

        // Untouched fields survive, because the update is one statement of
        // COALESCE rather than a read-modify-write.
        Assert.Equal(MayaEmail, body.GetProperty("email").GetString());
    }

    [Fact]
    public async Task Patching_someone_else_is_forbidden()
    {
        var response = await (await SignedInAsync())
            .PatchAsJsonAsync("/api/v1/users/u2", new { name = "Hijacked" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Verified_cannot_be_set_by_patching_yourself()
    {
        // u5 is seeded unverified; Maya is verified, so patch an unverified
        // account as itself.
        var client = _app.CreateSessionClient();
        await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = "sofia.marino@example.com",
            password = DemoPassword,
        });

        var response = await client.PatchAsJsonAsync("/api/v1/users/u5", new { verified = true });

        // The field is not in the request record, so it is ignored rather than
        // rejected — and the flag does not move. Self-service verification made
        // the whole token flow decorative.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False((await JsonOf(response)).GetProperty("verified").GetBoolean());
    }

    [Fact]
    public async Task Staff_roles_cannot_be_granted_by_patching_yourself()
    {
        var response = await (await SignedInAsync())
            .PatchAsJsonAsync("/api/v1/users/u1", new { staffRoles = new[] { "admin" } });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty((await JsonOf(response)).GetProperty("staffRoles").EnumerateArray());
    }

    [Fact]
    public async Task An_unknown_role_is_a_400()
    {
        var response = await (await SignedInAsync())
            .PatchAsJsonAsync("/api/v1/users/u1", new { roles = new[] { "superuser" } });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var issue = (await JsonOf(response)).GetProperty("issues").EnumerateArray().Single();
        Assert.Equal("roles[0]", issue.GetProperty("path").GetString());
    }

    [Fact]
    public async Task Batch_lookup_is_public_and_returns_public_projections_only()
    {
        // Public, like GET /users/{id}: a signed-out visitor reading reviews on a
        // caretaker's profile needs the authors' names and faces.
        var anonymous = await _app.CreateSessionClient().GetAsync("/api/v1/users?ids=u1,u2");
        Assert.Equal(HttpStatusCode.OK, anonymous.StatusCode);

        var body = await JsonOf(anonymous);
        Assert.Equal(2, body.GetArrayLength());
        foreach (var user in body.EnumerateArray())
        {
            Assert.False(user.TryGetProperty("email", out _));
            Assert.False(user.TryGetProperty("phone", out _));
            Assert.False(user.TryGetProperty("address", out var address)
                && address.TryGetProperty("lat", out _));
        }

        var signedIn = await JsonOf(await (await SignedInAsync()).GetAsync("/api/v1/users?ids=u1,u2"));
        Assert.Equal(2, signedIn.GetArrayLength());
    }

    [Fact]
    public async Task Full_listing_still_requires_a_session()
    {
        // The unfiltered listing carries every email address. Opening the batch
        // lookup must not have opened this with it.
        var response = await _app.CreateSessionClient().GetAsync("/api/v1/users");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.True((await JsonOf(response)).TryGetProperty("error", out _));
    }
}
