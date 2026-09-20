using Leash.Api.Features.Catalog;
using Leash.Api.Infrastructure.Json;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// ── Database ─────────────────────────────────────────────────────────────
// One NpgsqlDataSource for the process. It pools internally, so nothing here
// should ever `new NpgsqlConnection`. Handlers take the data source and open a
// connection per request.
var connectionString =
    builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Default is not set. Locally: " +
        "dotnet user-secrets set \"ConnectionStrings:Default\" \"Host=localhost;...\"");

builder.Services.AddNpgsqlDataSource(connectionString, b => b.EnableDynamicJson());

// ── JSON ─────────────────────────────────────────────────────────────────
// camelCase to match the TypeScript contract, and timestamps formatted exactly
// as JavaScript's toISOString() produces them. See IsoDateTimeConverter for why
// that second one is load-bearing rather than cosmetic.
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new IsoDateTimeConverter());
    o.SerializerOptions.Converters.Add(new NullableIsoDateTimeConverter());
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// ── Static files + SPA fallback ──────────────────────────────────────────
// In production the Vite build lands in wwwroot and this process serves both
// the app and the API — one deployable, no Node. In development Vite runs on
// :5173 and proxies /api here instead, so these are harmless no-ops.
app.UseDefaultFiles();
app.UseStaticFiles();

// ── API ──────────────────────────────────────────────────────────────────
// Everything is versioned from the first endpoint. An app-store binary cannot
// be force-updated, so v1 will still be serving old mobile clients long after
// the web app has moved on. Costs nothing now; impossible to add cheaply later.
var api = app.MapGroup("/api/v1");

api.MapCatalog();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Any unmatched non-API path is a client route — hand it the SPA shell and let
// React Router resolve it. This is what makes /caretaker/{id} work for an id
// the server has never heard of, which is exactly what Next.js static export
// could not do and why the SPA was the right call.
app.MapFallbackToFile("index.html");

app.Run();

/// <summary>Exposed so WebApplicationFactory can boot the app in integration tests.</summary>
public partial class Program;
