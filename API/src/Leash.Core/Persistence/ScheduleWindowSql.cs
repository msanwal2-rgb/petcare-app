using System.Text;
using Dapper;
using Leash.Core.Models.Dtos;

namespace Leash.Core.Persistence;

/// <summary>
/// The window read shared by <c>vet_appointments</c> and <c>bookings</c>: both
/// tables have <c>"startDateTime"</c>, <c>"endDateTime"</c> and
/// <c>status</c>, and the calendar asks both the same question.
///
/// Soonest first, keyset-paginated on <c>(startDateTime, id)</c> — ascending,
/// unlike the newest-first lists, because a calendar and an "upcoming" list
/// are read forwards. The id tie-break is load-bearing for the same reason it
/// is there: rows share start times.
/// </summary>
public static class ScheduleWindowSql
{
    /// <summary>
    /// The query for one owner's, vet's or caretaker's rows in
    /// <paramref name="window"/>. <paramref name="column"/> is a compile-time
    /// literal from the repository, never request input.
    /// </summary>
    public static (string Where, DynamicParameters Parameters) Build(
        string column, string value, ScheduleWindow window, string? cursor, int limit)
    {
        var parameters = new DynamicParameters();
        parameters.Add("value", value);
        parameters.Add("from", window.From);
        parameters.Add("limitPlusOne", limit + 1);

        // Overlap, not containment: a booking that started before the window
        // and is still running belongs to it.
        var where = new StringBuilder($"""WHERE {column} = @value AND "endDateTime" > @from""");

        if (window.To is { } to)
        {
            where.Append(""" AND "startDateTime" < @to""");
            parameters.Add("to", to);
        }

        if (window.Statuses.Length > 0)
        {
            where.Append(" AND status = ANY(@statuses)");
            parameters.Add("statuses", window.Statuses);
        }

        var (cursorStart, cursorId) = Cursor.DecodeTimestamp(cursor);
        if (cursorId is not null)
        {
            where.Append(""" AND ("startDateTime", id) > (@cursorStart, @cursorId)""");
            parameters.Add("cursorStart", cursorStart);
            parameters.Add("cursorId", cursorId);
        }

        return (where.ToString(), parameters);
    }

    public const string OrderBy = """ORDER BY "startDateTime" ASC, id ASC LIMIT @limitPlusOne""";
}
