using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Single-use, expiring tokens for email verification and password reset.
///
/// The repository stores and consumes <b>hashes</b>. Hashing is the service's
/// job, so nothing behind this interface ever holds a usable token — which is
/// the property that makes a dump of <c>verification_tokens</c> worthless.
/// </summary>
public interface IVerificationTokenRepository
{
    /// <summary>
    /// Store a token hash, first deleting any prior token of the same type for
    /// the same identifier.
    ///
    /// One method rather than delete-then-insert at the service layer because
    /// the pair must be atomic: a reset requested twice in quick succession must
    /// not leave both links live, or neither. It opens its own transaction when
    /// no scope is passed.
    /// </summary>
    Task CreateAsync(
        string id, string identifier, string tokenHash, string type,
        DateTimeOffset expiresAt, DateTimeOffset createdAt,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Delete the row and return what it held, atomically.
    ///
    /// <c>DELETE ... RETURNING</c> rather than select-then-delete: two requests
    /// racing on the same token must not both be handed the identifier, and only
    /// one <c>DELETE</c> can match a row. Returns null when nothing matched.
    ///
    /// The row goes even when expired — a token that has been presented has been
    /// in the world, and keeping it only leaves something to retry against.
    /// Expiry and type are checked by the caller on what comes back.
    /// </summary>
    Task<VerificationTokenEntity?> ConsumeAsync(
        string tokenHash, ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// Rotating refresh tokens for native clients.
///
/// These are primitives, not a rotation method: the rotation itself is a
/// read-decide-write sequence that has to hold a row lock across all three
/// steps, and <see cref="TokenService"/> owns that transaction. Putting the
/// orchestration in the service is what lets it also consult
/// <c>ISessionValidator</c> mid-transaction — a repository has no business
/// knowing about the revocation watermark.
/// </summary>
public interface IRefreshTokenRepository
{
    Task CreateAsync(
        string id, string userId, string tokenHash, DateTimeOffset issuedAt,
        DateTimeOffset expiresAt, string userAgent,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Read a token and lock its row for the rest of the transaction.
    ///
    /// <c>SELECT ... FOR UPDATE</c> is what makes rotation single-use under
    /// concurrency: two refreshes arriving together on one token serialise here,
    /// and the second sees the <c>revokedAt</c> the first wrote. Without the
    /// lock both would read an unrevoked row and both would mint a pair.
    ///
    /// Requires a scope — a lock with no transaction around it is released
    /// immediately and buys nothing.
    /// </summary>
    Task<RefreshTokenEntity?> FindForUpdateAsync(
        string tokenHash, ITransactionScope scope, CancellationToken ct = default);

    /// <summary>Mark a token spent and record which token replaced it.</summary>
    Task MarkRotatedAsync(
        string id, string replacedById, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task RevokeAllForUserAsync(
        string userId, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// The sliding-window counters behind the credential endpoints.
///
/// In the database rather than in memory on purpose: in-process counters reset
/// on every deploy and are per-instance, so the limit an attacker actually faces
/// is the limit times the number of instances.
/// </summary>
public interface IRateLimitRepository
{
    /// <summary>Attempts recorded for this bucket and key since <paramref name="since"/>.</summary>
    Task<int> CountSinceAsync(
        string bucket, string key, DateTimeOffset since,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task RecordAsync(
        string id, string bucket, string key, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task ClearAsync(
        string bucket, string key,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Drop hits that have aged out of every window. Housekeeping only — the
    /// count queries are bounded by time, so stale rows are a storage cost and
    /// not a correctness one.
    /// </summary>
    Task<int> PurgeBeforeAsync(
        DateTimeOffset cutoff, ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>Runtime settings an administrator can change without a deploy.</summary>
public interface ISettingsRepository
{
    Task<IReadOnlyDictionary<string, string>> GetAllAsync(
        ITransactionScope? scope = null, CancellationToken ct = default);
}
