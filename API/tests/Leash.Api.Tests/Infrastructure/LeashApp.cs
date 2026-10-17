using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Leash.Api.Tests.Infrastructure;

/// <summary>
/// The real application, booted in-process against the test database.
///
/// These tests are the part the reference project does not have. Its Vitest
/// suites exercise the server functions directly, which is the right level for
/// the transition tables and the money rules — but it means nothing ever checked
/// the pipeline: that the cookie is actually issued, that <c>[Authorize]</c> is
/// actually on the action, that the 401 body is the envelope the client parses.
/// An authorization hole lives in exactly that gap.
///
/// ── Why the settings go in environment variables ──
///
/// <c>ConfigureAppConfiguration</c> is the obvious way to point the host at the
/// test database, and it does not work here. <c>Program.cs</c> reads
/// <c>builder.Configuration.GetConnectionString("Default")</c> in its own body,
/// while it is constructing the service graph; the factory's configuration
/// delegates are applied to the builder after that body has run. The host then
/// reports the overridden value from <c>IConfiguration</c> while its
/// <c>NpgsqlDataSource</c> is already bound to whatever
/// <c>appsettings.Development.json</c> said — so the tests quietly read and
/// wrote the development database, passed the ones that only needed *some*
/// seeded data, and failed the ones that depended on a clean table.
///
/// Environment variables are read by <c>WebApplicationBuilder</c>'s default
/// configuration, before <c>Program</c>'s body, so they are the only override
/// that is in place early enough. The double underscore is the standard
/// separator for a nested key.
/// </summary>
public sealed class LeashApp : WebApplicationFactory<Program>
{
    public const string TestSecret = "test-only-secret-3f8a1c0d5e7b9a2c4d6f8e0a1b3c5d7e";
    public const string TestOrigin = "http://test.local";

    public LeashApp(string connectionString)
    {
        // Set in the constructor, which runs before the host is built — the host
        // is created lazily on first access to Services or CreateClient.
        Environment.SetEnvironmentVariable("ConnectionStrings__Default", connectionString);
        Environment.SetEnvironmentVariable("Auth__Secret", TestSecret);
        Environment.SetEnvironmentVariable("App__Origin", TestOrigin);
        Environment.SetEnvironmentVariable("Email__DevMode", "true");

        // Google stays unconfigured, so the tests also cover the "feature not
        // set up on this deployment" path — which is the state every machine is
        // in until somebody creates an OAuth client.
        Environment.SetEnvironmentVariable("Auth__Google__ClientId", null);
        Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", null);

        // No provider key, so the mailer logs instead of sending. The email
        // templates are asserted on at the service level, through CoreHost.
        Environment.SetEnvironmentVariable("Email__ResendApiKey", null);

        // The fulfilment job would otherwise start advancing the seeded orders
        // thirty seconds into any test run long enough — moving o3 to delivered
        // underneath a test asserting it is processing. Tests drive it directly
        // through IFulfilmentService with an injected clock instead.
        Environment.SetEnvironmentVariable("Fulfilment__Enabled", "false");

        // Likewise the outbox drain: tests that assert on email drive
        // INotificationOutbox themselves, at the service level.
        Environment.SetEnvironmentVariable("Notifications__Outbox__Enabled", "false");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Development, because two behaviours under test are gated on it: the
        // dev-mode links that let the email flows be walked without a provider,
        // and the refusal of the unfiltered user listing outside development.
        builder.UseEnvironment(Environments.Development);

        // Belt and braces: these reach IConfiguration even if the environment
        // variables are ever cleared by something else in the process. They are
        // not sufficient on their own — see the class comment.
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:Secret"] = TestSecret,
                ["App:Origin"] = TestOrigin,
                ["Email:DevMode"] = "true",
            }));
    }

    /// <summary>
    /// A client that keeps cookies, which is what makes a session testable
    /// across requests.
    ///
    /// <c>AllowAutoRedirect = false</c> so a redirect is an assertable result
    /// rather than something the handler quietly follows — the OAuth and
    /// sign-out paths are redirects, and where they point is the behaviour.
    /// </summary>
    public HttpClient CreateSessionClient() => CreateClient(new WebApplicationFactoryClientOptions
    {
        HandleCookies = true,
        AllowAutoRedirect = false,
    });
}
