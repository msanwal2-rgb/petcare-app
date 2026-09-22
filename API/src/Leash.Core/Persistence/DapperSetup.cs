using System.Data;
using Dapper;

namespace Leash.Core.Persistence;

/// <summary>
/// Teaches Dapper the two type conversions this schema needs, and states the
/// rule that row types follow.
///
/// ── Why row types are mutable classes, not positional records ──
///
/// Dapper has two ways to materialise a row: match a constructor, or construct
/// with a parameterless constructor and set properties by name. Constructor
/// matching compares the reader's reported field types against the parameter
/// types, and it fails on both of the types this schema leans on:
///
///  - <c>text[]</c> is reported as <c>System.Array</c>, which does not match a
///    <c>string[]</c> parameter — and this schema has <c>roles</c>,
///    <c>staffRoles</c>, <c>allergies</c>, <c>medications</c>,
///    <c>productSlugs</c>, <c>acceptedSpecies</c> and more;
///  - <c>timestamptz</c> is reported as <c>DateTime</c>, which does not match a
///    <c>DateTimeOffset</c> parameter — and BUILD_PLAN section 8 maps every
///    instant to <c>DateTimeOffset</c>.
///
/// The failure is a runtime <c>InvalidOperationException</c> naming the
/// signature it wanted, which is legible once you have seen it and baffling
/// the first time. So: <b>every type Dapper materialises is a class with
/// parameterless construction and settable properties</b>, and the DTOs it maps
/// to stay positional records. That split is worth keeping — the row type is a
/// database concern shaped by the driver, the DTO is a contract shaped by the
/// client.
/// </summary>
public static class DapperSetup
{
    public static void Configure()
    {
        // Property mapping still needs the DateTime → DateTimeOffset step,
        // because the property is DateTimeOffset and the reader hands back a
        // DateTime.
        SqlMapper.AddTypeHandler(new DateTimeOffsetHandler());

        // jsonb → a typed array. Npgsql's EnableDynamicJson can do this when it
        // is told the target type, but Dapper reads columns through
        // IDataReader.GetValue, which hands back the raw string before Npgsql
        // ever sees a destination — so the conversion has to happen here.
        SqlMapper.AddTypeHandler(new JsonHandler<Models.Dtos.SlotDto[]>());
    }

    /// <summary>
    /// Shared options for every <c>jsonb</c> column.
    ///
    /// camelCase on the way out and case-insensitive on the way in, because the
    /// seeded JSON was written by the old TypeScript stack
    /// (<c>{"start": "09:00"}</c>) and the C# properties are PascalCase. Matching
    /// only exactly would deserialise every seeded slot to nulls — silently,
    /// since a JSON object with no recognised members is not an error.
    /// </summary>
    private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// <c>jsonb</c> ↔ <typeparamref name="T"/>.
    ///
    /// The parameter is typed as <c>jsonb</c> explicitly rather than left to
    /// inference: a string parameter against a <c>jsonb</c> column is a
    /// "column is of type jsonb but expression is of type text" error, and it
    /// only shows up on the write path.
    /// </summary>
    private sealed class JsonHandler<T> : SqlMapper.TypeHandler<T>
    {
        public override T? Parse(object value) => value switch
        {
            string json => System.Text.Json.JsonSerializer.Deserialize<T>(json, JsonOptions),
            T already => already,
            null => default,
            _ => throw new DataException(
                $"Cannot read {value.GetType().Name} as {typeof(T).Name}."),
        };

        public override void SetValue(IDbDataParameter parameter, T? value)
        {
            parameter.Value = System.Text.Json.JsonSerializer.Serialize(value, JsonOptions);

            if (parameter is Npgsql.NpgsqlParameter npgsql)
                npgsql.NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Jsonb;
        }
    }

    /// <summary>
    /// <c>timestamptz</c> ↔ <see cref="DateTimeOffset"/>.
    ///
    /// Npgsql reads <c>timestamptz</c> as a <see cref="DateTime"/> with
    /// <see cref="DateTimeKind.Utc"/> — the instant is right, the offset is
    /// simply not carried, because PostgreSQL does not store one. So the
    /// conversion is exact and the zero offset is a statement of fact rather
    /// than an assumption.
    ///
    /// Writing goes the other way: the value is normalised to UTC first, so a
    /// caller that hands over a local-time offset stores the same instant
    /// rather than a shifted one.
    /// </summary>
    private sealed class DateTimeOffsetHandler : SqlMapper.TypeHandler<DateTimeOffset>
    {
        public override DateTimeOffset Parse(object value) => value switch
        {
            DateTimeOffset offset => offset,
            DateTime utc => new DateTimeOffset(
                DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeSpan.Zero),
            string text => DateTimeOffset.Parse(
                text, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal),
            _ => throw new DataException(
                $"Cannot read {value?.GetType().Name ?? "null"} as a DateTimeOffset."),
        };

        public override void SetValue(IDbDataParameter parameter, DateTimeOffset value)
        {
            // Npgsql wants a UTC DateTime for timestamptz. Handing it a
            // DateTimeOffset works too, but only for offset zero — which is
            // true of everything Ids.Now() produces and not of everything a
            // caller might pass, so it is normalised here instead of relied on.
            parameter.Value = value.UtcDateTime;
            parameter.DbType = DbType.DateTime2;
        }
    }
}
