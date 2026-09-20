using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// Everything the application does to the <c>users</c> table.
///
/// One interface per aggregate, each exposing only the operations that are
/// actually needed, rather than a generic <c>IRepository&lt;T&gt;</c>. With
/// Dapper and hand-written SQL a generic CRUD surface buys nothing — there is no
/// change tracker to abstract over — and it costs the thing that matters here:
/// <see cref="GetCredentialByEmailAsync"/> and <see cref="GetAccountGateAsync"/>
/// return deliberately different projections of the same row, and a generic
/// <c>GetById</c> would flatten them into one shape that carries a password hash
/// everywhere.
///
/// ── The scope parameter ──
///
/// Every method takes an optional <see cref="ITransactionScope"/>. Passed one,
/// it enlists in the caller's transaction; passed nothing, it runs on its own
/// connection. That is what lets a service group several of these into one
/// atomic operation (see BUILD_PLAN.md — transactions) without every call site
/// paying for the ceremony.
/// </summary>
public interface IUserRepository
{
    Task<UserEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<UserEntity?> GetByEmailAsync(
        string email, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The row plus its password hash. Only sign-in and OAuth linking call this.</summary>
    Task<UserCredentialEntity?> GetCredentialByEmailAsync(
        string email, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<UserEntity?> GetByGoogleIdAsync(
        string googleId, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The two columns session validation reads, on every authenticated request.
    /// Its own method because it runs far more often than anything else here and
    /// has no business fetching fourteen columns to look at two.
    /// </summary>
    Task<AccountGateEntity?> GetAccountGateAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<UserEntity>> GetManyAsync(
        IReadOnlyCollection<string> ids, bool excludeDeleted,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<IReadOnlyList<UserEntity>> ListAsync(
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<UserEntity> CreateAsync(
        UserEntity user, string? passwordHash, string? googleId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Apply a patch, leaving omitted fields alone. Returns null when the user
    /// does not exist.
    /// </summary>
    Task<UserEntity?> UpdateAsync(
        string id, UpdateUserRequest patch,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<UserEntity?> MarkVerifiedAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Set a new password hash and bump the revocation watermark in one
    /// statement. Both or neither, always — a hash that lands without the
    /// watermark leaves the session a reset was meant to kill.
    /// </summary>
    Task<bool> SetPasswordAndRevokeSessionsAsync(
        string id, string passwordHash, DateTimeOffset revokedAt,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Claim a Google id for an account that already exists. False when another
    /// account holds it, so one Google account cannot key two Leash accounts.
    /// </summary>
    Task<bool> LinkGoogleAsync(
        string id, string googleId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Attach a Google id to a passwordless account and mark it verified — the
    /// adoption case in REQUIREMENTS.md A7.
    /// </summary>
    Task<UserEntity?> AdoptGoogleIdAsync(
        string id, string googleId,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task TouchLastLoginAsync(
        string id, DateTimeOffset at,
        ITransactionScope? scope = null, CancellationToken ct = default);
}
