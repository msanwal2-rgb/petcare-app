using System.Text.Json;
using Dapper;
using Npgsql;

namespace Leash.Api.Tests.Infrastructure;

/// <summary>
/// Publishing days for a provider, straight into the database.
///
/// Since the server checks requests against the published calendar (STATUS
/// §3-G), a test that books needs the provider to be open then. The seed's
/// days are July 2026 and the suites book relative to the clock, so a test
/// that is about something else opens the calendar first rather than leaning
/// on dates that rot.
///
/// "00:00"–"23:59" is all day: a set that ends at 23:59 runs to midnight.
/// </summary>
public static class Calendars
{
    public static readonly (string Start, string End) AllDay = ("00:00", "23:59");

    /// <summary>Open every day from yesterday to <paramref name="days"/> ahead (UTC dates), all day.</summary>
    public static Task OpenCaretakerAsync(string cs, string caretakerId, int days = 60)
        => OpenAsync(cs, "availability_days", "caretakerId", caretakerId, days);

    /// <summary>Open every day from yesterday to <paramref name="days"/> ahead (UTC dates), all day.</summary>
    public static Task OpenVetAsync(string cs, string vetId, int days = 60)
        => OpenAsync(cs, "vet_availability_days", "vetId", vetId, days);

    /// <summary>Remove every published day, so nothing is bookable.</summary>
    public static Task CloseCaretakerAsync(string cs, string caretakerId)
        => ExecAsync(cs, """DELETE FROM availability_days WHERE "caretakerId" = @id""", new { id = caretakerId });

    /// <summary>Remove every published day, so nothing is bookable.</summary>
    public static Task CloseVetAsync(string cs, string vetId)
        => ExecAsync(cs, """DELETE FROM vet_availability_days WHERE "vetId" = @id""", new { id = vetId });

    /// <summary>Publish one day with exactly these sets, replacing what that day had.</summary>
    public static Task SetCaretakerDayAsync(
        string cs, string caretakerId, DateOnly date, params (string Start, string End)[] sets)
        => SetDayAsync(cs, "availability_days", "caretakerId", caretakerId, date, sets);

    /// <summary>Publish one day with exactly these sets, replacing what that day had.</summary>
    public static Task SetVetDayAsync(
        string cs, string vetId, DateOnly date, params (string Start, string End)[] sets)
        => SetDayAsync(cs, "vet_availability_days", "vetId", vetId, date, sets);

    /// <summary>A UTC instant <paramref name="days"/> from today at a whole hour — never near midnight by accident.</summary>
    public static DateTimeOffset DaysAhead(int days, int hour, int minute = 0)
    {
        var today = DateTime.UtcNow.Date;
        return new DateTimeOffset(today.AddDays(days).AddHours(hour).AddMinutes(minute), TimeSpan.Zero);
    }

    private static async Task OpenAsync(string cs, string table, string column, string id, int days)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        for (var d = -1; d <= days; d++)
            await SetDayAsync(cs, table, column, id, today.AddDays(d), [AllDay]);
    }

    private static Task SetDayAsync(
        string cs, string table, string column, string id, DateOnly date, (string Start, string End)[] sets)
    {
        var slots = JsonSerializer.Serialize(sets.Select(s => new { start = s.Start, end = s.End }));
        return ExecAsync(cs, $"""
            DELETE FROM {table} WHERE "{column}" = @id AND date = @date::date;
            INSERT INTO {table} (id, "{column}", date, slots)
            VALUES (@rowId, @id, @date::date, @slots::jsonb);
            """,
            new { id, date = date.ToString("yyyy-MM-dd"), rowId = $"tav-{Guid.NewGuid():N}", slots });
    }

    private static async Task ExecAsync(string cs, string sql, object args)
    {
        await using var conn = new NpgsqlConnection(cs);
        await conn.ExecuteAsync(sql, args);
    }
}
