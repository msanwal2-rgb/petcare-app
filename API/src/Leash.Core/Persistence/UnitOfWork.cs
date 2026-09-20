using Npgsql;

namespace Leash.Core.Persistence;

/// <summary>
/// One database transaction, shared by several repository calls.
///
/// ── Why this exists ──
///
/// Any operation that writes more than one row has a failure mode where half of
/// it lands. Some of those halves are merely untidy; several in this
/// application are actively wrong:
///
///  - <b>Password reset</b> sets a new hash, bumps the session watermark and
///    drops the refresh tokens. If the hash lands and the watermark does not,
///    the attacker whose theft prompted the reset keeps a working session —
///    the reset silently did nothing it was for.
///  - <b>Token rotation</b> issues a replacement and revokes its predecessor.
///    Either half alone breaks single-use: revoke without issue locks the user
///    out, issue without revoke leaves two live tokens.
///  - <b>Issuing a verification token</b> deletes the previous one first. Both
///    or neither; otherwise a resend can leave two live links, or none.
///
/// So the rule, recorded in BUILD_PLAN.md: <b>a write that touches more than one
/// row or more than one table runs inside a transaction.</b> PostgreSQL has
/// transactional DDL and cheap transactions, so this costs nothing and removes
/// a whole class of "how did the data get like that?".
///
/// Repository write methods therefore take an optional scope. Passed one, they
/// enlist in the caller's transaction; passed nothing, they open and commit
/// their own — so a single-statement call site stays a single line.
/// </summary>
public interface IUnitOfWork
{
    Task<ITransactionScope> BeginAsync(CancellationToken ct = default);
}

/// <summary>
/// A connection with an open transaction. Disposing without
/// <see cref="CommitAsync"/> rolls back, which is the safe default: an
/// exception on the way out of a using block leaves nothing behind.
/// </summary>
public interface ITransactionScope : IAsyncDisposable
{
    NpgsqlConnection Connection { get; }
    NpgsqlTransaction Transaction { get; }
    Task CommitAsync(CancellationToken ct = default);
}

public sealed class UnitOfWork(NpgsqlDataSource db) : IUnitOfWork
{
    public async Task<ITransactionScope> BeginAsync(CancellationToken ct = default)
    {
        var conn = await db.OpenConnectionAsync(ct);
        try
        {
            var tx = await conn.BeginTransactionAsync(ct);
            return new TransactionScope(conn, tx);
        }
        catch
        {
            // BeginTransaction failed, so nothing owns the connection yet.
            await conn.DisposeAsync();
            throw;
        }
    }

    private sealed class TransactionScope(NpgsqlConnection conn, NpgsqlTransaction tx)
        : ITransactionScope
    {
        private bool _committed;

        public NpgsqlConnection Connection { get; } = conn;
        public NpgsqlTransaction Transaction { get; } = tx;

        public async Task CommitAsync(CancellationToken ct = default)
        {
            await Transaction.CommitAsync(ct);
            _committed = true;
        }

        public async ValueTask DisposeAsync()
        {
            // Npgsql rolls back on dispose, but doing it explicitly says so at
            // the one place somebody reading this will look for it.
            if (!_committed)
            {
                try
                {
                    await Transaction.RollbackAsync();
                }
                catch (Exception)
                {
                    // The transaction is already gone — the connection dropped,
                    // or the server aborted it. There is nothing to undo and
                    // nothing useful to report from a dispose.
                }
            }

            await Transaction.DisposeAsync();
            await Connection.DisposeAsync();
        }
    }
}

/// <summary>
/// Resolves the connection a repository method should use: the caller's, when
/// it is running inside a transaction, or a fresh one from the pool.
///
/// The <c>Owned</c> flag is what tells the caller whether to dispose it. A
/// repository must not dispose a connection it borrowed — that would close the
/// transaction out from under the operation that opened it.
/// </summary>
public readonly struct DbSession(
    NpgsqlConnection connection, NpgsqlTransaction? transaction, bool owned)
    : IAsyncDisposable
{
    public NpgsqlConnection Connection { get; } = connection;
    public NpgsqlTransaction? Transaction { get; } = transaction;
    private bool Owned { get; } = owned;

    public static async Task<DbSession> OpenAsync(
        NpgsqlDataSource db, ITransactionScope? scope, CancellationToken ct)
        => scope is null
            ? new DbSession(await db.OpenConnectionAsync(ct), null, owned: true)
            : new DbSession(scope.Connection, scope.Transaction, owned: false);

    public ValueTask DisposeAsync()
        => Owned ? Connection.DisposeAsync() : ValueTask.CompletedTask;
}
