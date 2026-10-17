using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using Leash.Api.Tests.Infrastructure;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The store over HTTP — M6's endpoint suite, which it shipped without. The
/// store's two security properties are HTTP-shaped, and until now they were
/// checked only by hand-run curl walks (HANDOFF.md §7):
///
///  - <b>S9</b>, the one High-severity defect in the reference: ordering
///    against somebody else's pet. Refused as 403 on both quote and order, and
///    refused identically whatever that pet holds, so the refusal cannot be
///    used to read its prescriptions.
///  - <b>S10, price tampering</b>: a body carrying prices is charged the
///    server's total.
///
/// Fixtures: Priya (u3) owns Luna (p4), who holds an active prescription for
/// prod19; Maya (u1) owns o1–o3; Rosa (u21) is ops.
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class StoreEndpointTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string DemoPassword = "leashdemo123";
    private const string Maya = "maya.chen@example.com";      // u1
    private const string Priya = "priya.nair@example.com";    // u3, owns Luna (p4)
    private const string Daniel = "daniel.reyes@example.com"; // u2
    private const string Rosa = "rosa.delgado@example.com";   // u21, ops
    private const string RxProduct = "prod19";

    private LeashApp _app = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await using (var conn = new NpgsqlConnection(db.ConnectionString))
        {
            // Staff sign in with STAFF_PASSWORD, which the suite does not know.
            await conn.ExecuteAsync(
                """UPDATE users SET "passwordHash" = (SELECT "passwordHash" FROM users WHERE id = 'u1') WHERE id = 'u21'""");
        }
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

    private static readonly object Address = new
    {
        name = "Test Buyer", line1 = "1 Main Street", line2 = "", city = "Austin", state = "TX",
        postalCode = "78704", country = "US", phone = "(512) 555-0100",
    };

    private static object Order(string productId, int quantity = 1, string? petId = null) => new
    {
        items = new[] { new { productId, quantity } },
        shippingAddress = Address,
        deliveryInstructions = "",
        petId,
    };

    // ── What is guarded, and what deliberately is not ────────────────────

    [Theory]
    [InlineData("POST", "/api/v1/orders/quote")]
    [InlineData("GET", "/api/v1/orders")]
    [InlineData("POST", "/api/v1/orders")]
    [InlineData("GET", "/api/v1/orders/o1")]
    [InlineData("POST", "/api/v1/orders/o1/cancel")]
    [InlineData("PATCH", "/api/v1/orders/o1/status")]
    [InlineData("POST", "/api/v1/orders/o1/payment/sync")]
    [InlineData("GET", "/api/v1/ops/orders")]
    public async Task Every_order_route_refuses_an_anonymous_caller(string method, string path)
    {
        var response = await _app.CreateSessionClient().SendAsync(
            new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/v1/products")]
    [InlineData("/api/v1/products/vetline-hypoallergenic-cat-dry")]
    [InlineData("/api/v1/brands")]
    public async Task Browsing_the_shop_needs_no_account(string path)
        => Assert.Equal(HttpStatusCode.OK, (await _app.CreateSessionClient().GetAsync(path)).StatusCode);

    // ── S9: somebody else's pet ──────────────────────────────────────────

    [Fact]
    public async Task Ordering_against_somebody_elses_pet_is_a_403()
    {
        var maya = await SignedInAsync(Maya);

        var response = await maya.PostAsJsonAsync("/api/v1/orders", Order(RxProduct, petId: "p4"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        Assert.Equal(0, await conn.ExecuteScalarAsync<int>(
            "SELECT count(*)::int FROM orders WHERE \"userId\" = 'u1' AND \"placedAt\" > now() - interval '1 minute'"));
    }

    [Fact]
    public async Task Quoting_against_somebody_elses_pet_is_a_403()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PostAsJsonAsync("/api/v1/orders/quote",
            new { items = new[] { new { productId = RxProduct, quantity = 1 } }, petId = "p4" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_refusal_is_identical_whatever_the_pet_holds()
    {
        // Otherwise the status code says which prescriptions Luna has.
        var maya = await SignedInAsync(Maya);

        var rx = await maya.PostAsJsonAsync("/api/v1/orders", Order(RxProduct, petId: "p4"));
        var plain = await maya.PostAsJsonAsync("/api/v1/orders", Order("prod13", petId: "p4"));
        var nobody = await maya.PostAsJsonAsync("/api/v1/orders", Order(RxProduct, petId: "p_does_not_exist"));

        Assert.Equal(HttpStatusCode.Forbidden, rx.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, plain.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, nobody.StatusCode);
        Assert.Equal(await rx.Content.ReadAsStringAsync(), await plain.Content.ReadAsStringAsync());
        Assert.Equal(await rx.Content.ReadAsStringAsync(), await nobody.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_owner_with_a_prescription_can_buy_the_rx_food()
    {
        var priya = await SignedInAsync(Priya);

        var response = await priya.PostAsJsonAsync("/api/v1/orders", Order(RxProduct, petId: "p4"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("paid", (await JsonOf(response)).GetProperty("paymentStatus").GetString());
    }

    [Fact]
    public async Task An_rx_product_with_no_pet_is_a_409_carrying_the_quote()
    {
        var priya = await SignedInAsync(Priya);

        var response = await priya.PostAsJsonAsync("/api/v1/orders", Order(RxProduct));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await JsonOf(response);
        Assert.True(body.TryGetProperty("error", out _));
        Assert.Equal("prescription_required",
            body.GetProperty("quote").GetProperty("problems")[0].GetProperty("code").GetString());
    }

    // ── S10: the client's prices are display-only ────────────────────────

    [Fact]
    public async Task A_tampered_price_is_charged_the_servers_total()
    {
        var maya = await SignedInAsync(Maya);
        var quote = await JsonOf(await maya.PostAsJsonAsync("/api/v1/orders/quote",
            new { items = new[] { new { productId = "prod13", quantity = 2 } } }));
        var expected = quote.GetProperty("totalCents").GetInt32();

        // Every field a malicious cart might add. None of them exists on the
        // request type, so none of them is read.
        var response = await maya.PostAsync("/api/v1/orders", JsonContent.Create(new
        {
            items = new[] { new { productId = "prod13", quantity = 2, unitPriceCents = 1, lineTotalCents = 2 } },
            shippingAddress = Address,
            subtotalCents = 2,
            shippingCents = 0,
            taxCents = 0,
            totalCents = 1,
        }));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var order = await JsonOf(response);
        Assert.Equal(expected, order.GetProperty("totalCents").GetInt32());

        await using var conn = new NpgsqlConnection(db.ConnectionString);
        Assert.Equal(expected, await conn.ExecuteScalarAsync<int>(
            "SELECT \"amountCents\" FROM payments WHERE \"orderId\" = @id", new { id = order.GetProperty("id").GetString() }));
    }

    [Fact]
    public async Task The_same_product_twice_in_one_basket_is_a_400()
    {
        // Two lines for one product each pass the stock check alone.
        var maya = await SignedInAsync(Maya);
        var response = await maya.PostAsJsonAsync("/api/v1/orders", new
        {
            items = new[] { new { productId = "prod13", quantity = 1 }, new { productId = "prod13", quantity = 1 } },
            shippingAddress = Address,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Whose order it is ────────────────────────────────────────────────

    [Fact]
    public async Task Somebody_elses_order_is_a_404()
    {
        var daniel = await SignedInAsync(Daniel);

        Assert.Equal(HttpStatusCode.NotFound, (await daniel.GetAsync("/api/v1/orders/o1")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await daniel.PostAsync("/api/v1/orders/o1/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await daniel.PostAsync("/api/v1/orders/o1/payment/sync", null)).StatusCode);
    }

    [Fact]
    public async Task A_customer_cannot_move_their_own_order()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PatchAsJsonAsync("/api/v1/orders/o3/status", new { status = "delivered" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Only_ops_reads_the_fulfilment_queue()
    {
        var maya = await SignedInAsync(Maya);
        Assert.Equal(HttpStatusCode.Forbidden, (await maya.GetAsync("/api/v1/ops/orders")).StatusCode);

        var rosa = await SignedInAsync(Rosa);
        Assert.Equal(HttpStatusCode.OK, (await rosa.GetAsync("/api/v1/ops/orders")).StatusCode);
    }

    [Fact]
    public async Task Ops_moves_an_order_and_the_customer_sees_it()
    {
        var rosa = await SignedInAsync(Rosa);
        var moved = await rosa.PatchAsJsonAsync("/api/v1/orders/o3/status", new { status = "packed", location = "Austin, TX" });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);

        var maya = await SignedInAsync(Maya);
        var order = await JsonOf(await maya.GetAsync("/api/v1/orders/o3"));
        Assert.Equal("packed", order.GetProperty("status").GetString());
    }

    [Fact]
    public async Task An_illegal_ops_move_is_a_409()
    {
        // processing → delivered skips packed and shipped (§11.3).
        var rosa = await SignedInAsync(Rosa);
        var response = await rosa.PatchAsJsonAsync("/api/v1/orders/o3/status", new { status = "delivered" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task A_customer_cancels_inside_the_window_and_is_refunded()
    {
        var maya = await SignedInAsync(Maya);
        var cancelled = await maya.PostAsync("/api/v1/orders/o3/cancel", null);

        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        var order = await JsonOf(cancelled);
        Assert.Equal("cancelled", order.GetProperty("status").GetString());
        Assert.Equal("refunded", order.GetProperty("paymentStatus").GetString());
    }

    [Fact]
    public async Task A_customer_cannot_cancel_once_it_has_shipped()
    {
        var maya = await SignedInAsync(Maya);
        var response = await maya.PostAsync("/api/v1/orders/o2/cancel", null); // out for delivery

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
