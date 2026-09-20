using Leash.Core;
using Leash.Core.Email;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Leash.Api.Tests.Infrastructure;

/// <summary>
/// Leash.Core's object graph, without ASP.NET.
///
/// Built through <see cref="DependencyInjection.AddLeashCore"/> rather than by
/// newing services up by hand, which is worth the few extra lines: the service
/// tests then also cover the registrations. A service that works when
/// constructed directly and fails to resolve — a missing registration, a
/// lifetime mismatch, a cycle — is a real failure mode, and hand-construction
/// hides it until the app starts.
///
/// The mailer is replaced with <see cref="RecordingMailer"/> so the email
/// templates can be asserted on.
/// </summary>
public sealed class CoreHost : IAsyncDisposable
{
    public const string TestSecret = "test-only-secret-3f8a1c0d5e7b9a2c4d6f8e0a1b3c5d7e";
    public const string TestOrigin = "http://test.local";

    private readonly ServiceProvider _provider;

    public RecordingMailer Mailer { get; } = new();

    public CoreHost(string connectionString)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = connectionString,
                ["Auth:Secret"] = TestSecret,
                ["App:Origin"] = TestOrigin,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(config);
        services.AddSingleton<IHostEnvironment>(new TestEnvironment());
        services.AddLogging();

        services.AddLeashCore(config);

        // After AddLeashCore, so this registration wins.
        services.AddSingleton<IMailer>(Mailer);

        _provider = services.BuildServiceProvider();
    }

    public T Get<T>() where T : notnull => _provider.GetRequiredService<T>();

    public ValueTask DisposeAsync() => _provider.DisposeAsync();

    /// <summary>
    /// Development, because two behaviours under test are gated on it: the
    /// dev-mode links that let the email flows be walked without a provider,
    /// and the default for <c>demoLoginVisible</c>.
    /// </summary>
    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "Leash.Api.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; }
            = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}

/// <summary>
/// Captures what would have been sent, so the template can be asserted on. The
/// production fallback logs instead, which is untestable by design.
/// </summary>
public sealed class RecordingMailer : IMailer
{
    public List<MailMessage> Sent { get; } = [];

    public Task SendAsync(MailMessage message, CancellationToken ct = default)
    {
        Sent.Add(message);
        return Task.CompletedTask;
    }

    public void Clear() => Sent.Clear();
}
