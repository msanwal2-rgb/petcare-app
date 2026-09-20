using Dapper;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

public sealed class CatalogRepository(NpgsqlDataSource db) : ICatalogRepository
{
    public async Task<IReadOnlyList<string>> ListBrandsAsync(
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        var brands = await session.Connection.QueryAsync<string>(new CommandDefinition(
            """
            SELECT DISTINCT brand
            FROM products
            WHERE active = true
            ORDER BY brand ASC
            """,
            transaction: session.Transaction, cancellationToken: ct));

        return brands.ToList();
    }
}
