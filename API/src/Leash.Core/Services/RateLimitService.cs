using System.Security.Cryptography;
using System.Text;
using Leash.Core.Models.Dtos;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Configuration;

namespace Leash.Core.Services;

/// <summary>
/// A true sliding window, counted in the database.
///
/// Keys are always hashes. A rate-limit table holding email addresses and
/// visitor IPs is a small breach waiting to become a large one, so
/// <see cref="ClientKey"/> and <see cref="SubjectKey"/> salt and hash before
/// anything is written.
/// </summary>
public sealed class RateLimitService(
    IRateLimitRepository hits,
    IUnitOfWork unitOfWork,
    IConfiguration config) : IRateLimitService
{
    /// <summary>
    /// Salt for the key hashes. Falls back to the auth secret so there is one
    /// fewer thing to configure; either way it must be stable across instances
    /// or the same caller counts as several.
    /// </summary>
    private readonly string _salt =
        config["RateLimiting:Salt"] ?? config["Auth:Secret"] ?? string.Empty;

    /// <summary>
    /// Record an attempt and say whether it is permitted.
    ///
    /// Counts first, then records, so the Nth attempt is allowed and the
    /// (N+1)th is not. Recording even when refused is deliberate: hammering a
    /// blocked endpoint keeps it blocked, rather than letting the window drain
    /// while the attacker keeps trying.
    ///
    /// The count and the insert share a transaction so the decision is made
    /// against the same snapshot it is recorded into — otherwise a burst of
    /// concurrent attempts can all read the same low count and all be allowed,
    /// which is precisely the case the limit exists for.
    /// </summary>
    public async Task<RateLimitVerdict> ConsumeAsync(
        RateLimitRule rule, string key, CancellationToken ct = default)
    {
        var now = Ids.Now();
        var since = now - rule.Window;

        await using var scope = await unitOfWork.BeginAsync(ct);

        var used = await hits.CountSinceAsync(rule.Bucket, key, since, scope, ct);
        await hits.RecordAsync(Ids.New("rl"), rule.Bucket, key, now, scope, ct);

        await scope.CommitAsync(ct);

        return used >= rule.Limit
            ? new RateLimitVerdict(false, used, rule.Limit, rule.Message)
            : new RateLimitVerdict(true, used + 1, rule.Limit, null);
    }

    public Task ClearAsync(RateLimitRule rule, string key, CancellationToken ct = default)
        => hits.ClearAsync(rule.Bucket, key, ct: ct);

    public string SubjectKey(string value)
        => Hash($"{_salt}:{value.Trim().ToLowerInvariant()}");

    /// <summary>
    /// A stable, non-identifying key for an unauthenticated caller.
    ///
    /// Behind a proxy the forwarded header is the only way to tell callers
    /// apart, which means a client can influence its own bucket. That is
    /// acceptable here and nowhere else: the worst a forged header achieves is
    /// landing in someone else's bucket, the per-email limit still holds the
    /// line for the attack this defends against, and nothing is authorised from
    /// it.
    /// </summary>
    public string ClientKey(string ip, string userAgent)
        => Hash($"{_salt}:{ip}:{userAgent}");

    public string UserKey(string userId) => $"uid:{userId}";

    public Task<int> PurgeExpiredAsync(CancellationToken ct = default)
        => hits.PurgeBeforeAsync(Ids.Now() - TimeSpan.FromHours(25), ct: ct);

    private static string Hash(string input)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(input)))[..32];
}
