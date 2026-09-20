using Dapper;
using Npgsql;
using Respawn;

namespace Leash.Api.Tests.Infrastructure;

/// <summary>
/// The test database: built from <c>db/petapp.sql</c>, seeded from
/// <c>db/reference/</c> and <c>db/devseed/</c>, and reset between tests.
///
/// Built from the master schema on every run rather than assumed to exist, for
/// the reason BUILD_PLAN.md section 9 gives: the suite is also the check that
/// <c>petapp.sql</c> actually produces a working database. A schema the tests
/// never build is a schema nobody has run from scratch since the last time
/// somebody remembered to.
///
/// Reset is Respawn (truncate everything) followed by re-applying the two seed
/// files. The reference project reset from a snapshot schema instead, because
/// its database was across a network and re-seeding dominated the suite's
/// wall-clock. Locally the seed is 465 INSERTs against a socket on the same
/// machine, so the simpler thing is fast enough — which is the same reason the
/// suite is expected to run in a minute or two rather than the original's
/// forty.
/// </summary>
public sealed class DatabaseFixture : IAsyncLifetime
{
    /// <summary>
    /// Overridable so CI can point at its own database without editing this.
    /// Defaults to the local petapp_test from the M0 bootstrap.
    /// </summary>
    public string ConnectionString { get; } =
        Environment.GetEnvironmentVariable("LEASH_TEST_DB")
        ?? "Host=localhost;Port=5432;Database=petapp_test;Username=leash;Password=devonly";

    public NpgsqlDataSource DataSource { get; private set; } = null!;

    private Respawner _respawner = null!;
    private string _referenceSql = null!;
    private string _devseedSql = null!;

    public async Task InitializeAsync()
    {
        // The tests that exercise services directly never boot the app, so they
        // would otherwise depend on some earlier test having booted it to
        // register Dapper's type handlers. Set here as well, and idempotent.
        Leash.Core.Persistence.DapperSetup.Configure();

        var db = RepoPaths.Db();

        var schemaSql = await File.ReadAllTextAsync(Path.Combine(db, "petapp.sql"));
        _referenceSql = await ReadAllInAsync(Path.Combine(db, "reference"));
        _devseedSql = await ReadAllInAsync(Path.Combine(db, "devseed"));

        await using (var admin = new NpgsqlConnection(ConnectionString))
        {
            await admin.OpenAsync();

            // A clean slate every run. DROP SCHEMA rather than dropping the
            // database, because dropping requires no other connection to exist
            // and the pooler makes that unreliable from inside the same process.
            await admin.ExecuteAsync("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

            // petapp.sql contains psql meta-commands (\restrict) that Npgsql
            // cannot execute, so they are stripped. They are an anti-injection
            // guard for the psql client and carry no schema.
            await admin.ExecuteAsync(StripPsqlMetaCommands(schemaSql));

            await admin.ExecuteAsync(_referenceSql);
            await admin.ExecuteAsync(_devseedSql);

            _respawner = await Respawner.CreateAsync(admin, new RespawnerOptions
            {
                DbAdapter = DbAdapter.Postgres,
                SchemasToInclude = ["public"],

                // The script journal describes the schema, not the data. Wiping
                // it would leave a database that cannot say what it holds.
                TablesToIgnore = [new Respawn.Graph.Table("public", "schema_version")],
            });
        }

        DataSource = new NpgsqlDataSourceBuilder(ConnectionString)
            .EnableDynamicJson()
            .Build();
    }

    /// <summary>Back to the seeded state. Called before every test.</summary>
    public async Task ResetAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();

        await _respawner.ResetAsync(conn);
        await conn.ExecuteAsync(_referenceSql);
        await conn.ExecuteAsync(_devseedSql);
    }

    public async Task DisposeAsync()
    {
        if (DataSource is not null) await DataSource.DisposeAsync();
    }

    private static async Task<string> ReadAllInAsync(string directory)
    {
        var files = Directory.GetFiles(directory, "*.sql").OrderBy(f => f).ToArray();
        var parts = new List<string>(files.Length);
        foreach (var file in files)
            parts.Add(StripPsqlMetaCommands(await File.ReadAllTextAsync(file)));
        return string.Join("\n", parts);
    }

    private static string StripPsqlMetaCommands(string sql)
        => string.Join('\n', sql
            .Split('\n')
            .Where(line => !line.StartsWith("\\", StringComparison.Ordinal)));
}

public static class RepoPaths
{
    /// <summary>
    /// The repository's <c>db/</c> directory, found by walking up from the test
    /// binary.
    ///
    /// Walked rather than hard-coded as a relative path because the depth from
    /// the assembly to the repository root differs between a <c>dotnet test</c>
    /// run, a Visual Studio run and a published test bundle, and a wrong
    /// relative path fails as a confusing "file not found" at the top of every
    /// test.
    /// </summary>
    public static string Db()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "db", "petapp.sql");
            if (File.Exists(candidate)) return Path.Combine(directory.FullName, "db");
            directory = directory.Parent;
        }

        throw new InvalidOperationException(
            $"Could not find db/petapp.sql above {AppContext.BaseDirectory}.");
    }
}

/// <summary>
/// One collection for every test that touches the database, so xUnit serialises
/// them. They share one database and each resets it, so running two at once
/// would have one truncating the other's fixtures mid-test.
/// </summary>
[CollectionDefinition(Name)]
public sealed class DatabaseCollection : ICollectionFixture<DatabaseFixture>
{
    public const string Name = "database";
}
