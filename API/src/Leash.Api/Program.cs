using Leash.Api.Auth;
using Leash.Api.Filters;
using Leash.Api.Json;
using Leash.Core;

var builder = WebApplication.CreateBuilder(args);

// ── Leash.Core ───────────────────────────────────────────────────────────
// Models, repositories and services, with their interfaces, registered in one
// call. The data source, the Dapper type handlers and the unit of work come
// with it. See Leash.Core/DependencyInjection.cs.
builder.Services.AddLeashCore(builder.Configuration);

// ── Authentication ───────────────────────────────────────────────────────
// Cookie for the browser, rotating JWT pair for native clients, one policy
// scheme choosing between them per request. See Auth/AuthSetup.cs.
builder.Services.AddLeashAuth(builder.Configuration);

// ── Controllers ──────────────────────────────────────────────────────────
builder.Services.AddControllers(options =>
{
    // Validation runs before every action body, globally rather than per
    // attribute — see Filters/ValidationActionFilter.cs for why.
    options.Filters.Add<ValidationActionFilter>();
})
.AddJsonOptions(options =>
{
    // camelCase to match the TypeScript contract, and timestamps formatted
    // exactly as JavaScript's toISOString() produces them. See
    // IsoDateTimeConverter for why that second one is load-bearing rather than
    // cosmetic.
    options.JsonSerializerOptions.PropertyNamingPolicy =
        System.Text.Json.JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.Converters.Add(new IsoDateTimeConverter());
    options.JsonSerializerOptions.Converters.Add(new NullableIsoDateTimeConverter());
})
.ConfigureApiBehaviorOptions(options =>
{
    // Off, because the default writes a ProblemDetails body on a binding
    // failure — a different shape from the error envelope every other failure
    // in this API uses, and one the frontend's fetch layer does not parse.
    // ValidationActionFilter answers those instead.
    options.SuppressModelStateInvalidFilter = true;
});

// ── Background jobs ──────────────────────────────────────────────────────
// Advances paid orders through fulfilment on an interval and closes out
// abandoned checkouts. Idempotent at any cadence; off under the integration
// tests. See Jobs/FulfilmentWorker.cs, including the note about running it on
// one instance.
builder.Services.AddHostedService<Leash.Api.Jobs.FulfilmentWorker>();

// Delivers the email half of every notification from the outbox (N6). Safe
// on every instance — see Jobs/NotificationOutboxWorker.cs.
builder.Services.AddHostedService<Leash.Api.Jobs.NotificationOutboxWorker>();

// ── CORS ─────────────────────────────────────────────────────────────────
// Only for a deployment where the SPA is a separate site from this API (e.g.
// the frontend on :8081, this on :8080). List the SPA's address(es):
//   "Cors": { "Origins": [ "http://localhost:8081" ] }
// Unset, nothing is allowed cross-origin — the single-site default.
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
if (corsOrigins.Length > 0)
{
    builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
        .WithOrigins(corsOrigins.Select(o => o.TrimEnd('/')).ToArray())
        .AllowAnyHeader()
        .AllowAnyMethod()
        // The session is a cookie, so the browser must be allowed to send it.
        .AllowCredentials()));
}

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Always in Development; elsewhere only while Swagger:Enabled is true
// (appsettings.json ships it on so a review deployment can be checked from the
// browser — turn it off before real users arrive).
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Swagger:Enabled"))
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

if (corsOrigins.Length > 0) app.UseCors();

app.UseAuthentication();
app.UseAuthorization();

// Every route is versioned from the first endpoint, via [Route("api/v1/...")]
// on the controllers. An app-store binary cannot be force-updated, so v1 will
// still be serving old mobile clients long after the web app has moved on.
app.MapControllers();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

// Any unmatched non-API path is a client route — hand it the SPA shell and let
// React Router resolve it. This is what makes /caretaker/{id} work for an id
// the server has never heard of, which is exactly what Next.js static export
// could not do and why the SPA was the right call.
app.MapFallbackToFile("index.html");

app.Run();

/// <summary>Exposed so WebApplicationFactory can boot the app in integration tests.</summary>
public partial class Program;
