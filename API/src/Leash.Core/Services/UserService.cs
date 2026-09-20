using System.Text.Json;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Hosting;

namespace Leash.Core.Services;

public sealed class UserService(IUserRepository users) : IUserService
{
    public async Task<UserDto?> GetAsync(string id, CancellationToken ct = default)
        => (await users.GetByIdAsync(id, ct: ct))?.ToDto();

    /// <summary>
    /// The public projection.
    ///
    /// A deleted account is scrubbed rather than removed — orders, payments and
    /// reviews keep their author (REQUIREMENTS.md A16) — but there is no reason
    /// to serve its husk to a profile page.
    /// </summary>
    public async Task<PublicUserDto?> GetPublicAsync(string id, CancellationToken ct = default)
    {
        var user = await users.GetByIdAsync(id, ct: ct);
        return user is null || user.Status == AccountStatus.Deleted
            ? null
            : user.ToPublicDto();
    }

    public async Task<IReadOnlyList<PublicUserDto>> GetPublicManyAsync(
        IReadOnlyCollection<string> ids, CancellationToken ct = default)
    {
        var rows = await users.GetManyAsync(ids, excludeDeleted: true, ct: ct);
        return rows.Select(r => r.ToPublicDto()).ToList();
    }

    public async Task<IReadOnlyList<UserDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await users.ListAsync(ct: ct);
        return rows.Select(r => r.ToDto()).ToList();
    }

    public async Task<UserDto?> UpdateAsync(
        string id, UpdateUserRequest patch, CancellationToken ct = default)
        => (await users.UpdateAsync(id, patch, ct: ct))?.ToDto();
}

public sealed class SettingsService(
    ISettingsRepository settings, IHostEnvironment env) : ISettingsService
{
    /// <summary>
    /// Reads are defaulted and never throw on a missing row, so a fresh database
    /// and a seeded one behave identically. That is what lets the schema ship
    /// without a settings fixture.
    /// </summary>
    private SystemSettings Defaults => new(
        SignupsOpen: true,
        MaintenanceBanner: "",
        DemoLoginVisible: env.IsDevelopment(),
        FreeShippingThresholdCents: 4900);

    public async Task<SystemSettings> GetAsync(CancellationToken ct = default)
    {
        var stored = await settings.GetAllAsync(ct: ct);
        var defaults = Defaults;

        return new SystemSettings(
            Bool(stored, "signupsOpen", defaults.SignupsOpen),
            Text(stored, "maintenanceBanner", defaults.MaintenanceBanner),
            Bool(stored, "demoLoginVisible", defaults.DemoLoginVisible),
            Int(stored, "freeShippingThresholdCents", defaults.FreeShippingThresholdCents));
    }

    /// <summary>
    /// Narrow a stored jsonb value to the declared type, falling back to the
    /// default.
    ///
    /// The column is <c>jsonb</c>, so a row can hold any JSON — including the
    /// wrong shape, if something ever wrote one. Coercing rather than
    /// deserialising strictly means a bad row degrades to the default instead of
    /// taking down every request that reads settings, which for a table read on
    /// the public config endpoint is the right trade.
    /// </summary>
    private static bool Bool(
        IReadOnlyDictionary<string, string> rows, string key, bool fallback)
        => rows.TryGetValue(key, out var raw) && bool.TryParse(raw, out var value)
            ? value
            : fallback;

    private static int Int(
        IReadOnlyDictionary<string, string> rows, string key, int fallback)
        => rows.TryGetValue(key, out var raw)
           && int.TryParse(raw, out var value)
           && value >= 0
            ? value
            : fallback;

    private static string Text(
        IReadOnlyDictionary<string, string> rows, string key, string fallback)
    {
        if (!rows.TryGetValue(key, out var raw)) return fallback;
        try
        {
            // jsonb renders a string with its quotes; the banner is displayed
            // verbatim, so they have to come off.
            using var document = JsonDocument.Parse(raw);
            return document.RootElement.ValueKind == JsonValueKind.String
                ? document.RootElement.GetString() ?? fallback
                : fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }
}
