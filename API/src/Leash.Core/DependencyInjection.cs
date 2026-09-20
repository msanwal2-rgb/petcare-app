using FluentValidation;
using Leash.Core.Configuration;
using Leash.Core.Email;
using Leash.Core.Persistence;
using Leash.Core.Repositories;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Leash.Core.Validation;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Leash.Core;

/// <summary>
/// Everything in this library, registered in one call.
///
/// The composition root lives here rather than in the API's <c>Program.cs</c> so
/// that adding a repository or a service is a one-line change in the project
/// that owns it, and so a second host — a background worker, an integration test
/// that skips HTTP — can get the same object graph without duplicating the
/// wiring.
/// </summary>
public static class DependencyInjection
{
    public static IServiceCollection AddLeashCore(
        this IServiceCollection services, IConfiguration config)
    {
        // ── Database ─────────────────────────────────────────────────────
        // One NpgsqlDataSource for the process. It pools internally, so nothing
        // in this library ever constructs an NpgsqlConnection directly:
        // repositories take the data source and open a connection per call, or
        // borrow the caller's via DbSession.
        var connectionString = config.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:Default is not set. Locally: " +
                "dotnet user-secrets set \"ConnectionStrings:Default\" \"Host=localhost;...\"");

        services.AddNpgsqlDataSource(connectionString, b => b.EnableDynamicJson());

        // Dapper's type handlers are global static state, which is how Dapper
        // works — so they are set once, here, rather than from whichever
        // service happens to run first.
        DapperSetup.Configure();

        services.AddSingleton<IUnitOfWork, UnitOfWork>();

        // ── Repositories ─────────────────────────────────────────────────
        services.AddSingleton<IUserRepository, UserRepository>();
        services.AddSingleton<IVerificationTokenRepository, VerificationTokenRepository>();
        services.AddSingleton<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddSingleton<IRateLimitRepository, RateLimitRepository>();
        services.AddSingleton<ISettingsRepository, SettingsRepository>();
        services.AddSingleton<ICatalogRepository, CatalogRepository>();

        // ── Services ─────────────────────────────────────────────────────
        // Singletons: every one of these is stateless and holds only the data
        // source and its collaborators. Nothing here caches per-request state,
        // which is what would make a scoped lifetime necessary.
        services.AddSingleton<IAuthService, AuthService>();
        services.AddSingleton<IUserService, UserService>();
        services.AddSingleton<IEmailFlowService, EmailFlowService>();
        services.AddSingleton<ITokenService, TokenService>();
        services.AddSingleton<ISessionValidator, SessionValidator>();
        services.AddSingleton<IAccessService, AccessService>();
        services.AddSingleton<IRateLimitService, RateLimitService>();
        services.AddSingleton<ISettingsService, SettingsService>();
        services.AddSingleton<ICatalogService, CatalogService>();

        // ── Supporting ───────────────────────────────────────────────────
        services.AddSingleton<AppOrigin>();
        services.AddSingleton<EmailDevMode>();

        // Real delivery when a provider is configured, a logging stand-in
        // otherwise, so the verification and reset flows are walkable on a
        // machine with no API key.
        if (!string.IsNullOrWhiteSpace(config["Email:ResendApiKey"]))
            services.AddHttpClient<IMailer, ResendMailer>();
        else
            services.AddSingleton<IMailer, LogMailer>();

        // Validators are resolved per request body type by the API's validation
        // filter.
        services.AddValidatorsFromAssemblyContaining<SignupRequestValidator>();

        return services;
    }
}
