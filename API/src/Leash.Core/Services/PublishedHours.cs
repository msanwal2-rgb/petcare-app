using System.Globalization;
using Leash.Core.Models.Dtos;

namespace Leash.Core.Services;

/// <summary>
/// Whether a request falls inside a provider's published calendar (STATUS §3-G).
///
/// Published hours are local clock times on calendar days — "09:00" on the 7th
/// — and the server knows nobody's time zone (STATUS §3-AV: the clinic's zone
/// is stored nowhere). So the request brings the browser's offset from UTC
/// and the instants are read in it. Trusting it is cheap: a wrong offset only
/// moves which of the provider's own hours are checked, and the provider
/// still accepts or declines every request.
///
/// <list type="bullet">
/// <item>A day nobody published, or published with no hours, is closed.</item>
/// <item>A set that ends at 23:59 runs to midnight — the editor cannot say
///   24:00, so 23:59 is how a provider says "to the end of the day".</item>
/// <item>Malformed hours open nothing.</item>
/// </list>
///
/// This is the same reading the booking screens use (web/src/lib/availability.ts);
/// the server is the one that decides.
/// </summary>
public static class PublishedHours
{
    /// <summary>The widest offset a real zone has: UTC−14 to UTC+14.</summary>
    public const int MaxOffsetMinutes = 14 * 60;

    private const double MinutesPerDay = 24 * 60;

    /// <summary>
    /// A vet visit: held from start to end by published hours. Normally one
    /// set; a visit over midnight needs the evening set to run to midnight and
    /// the next day's to start at 00:00 and reach its end.
    /// </summary>
    public static bool CoversVisit(
        IEnumerable<AvailabilityDayDto> days, DateTimeOffset start, DateTimeOffset end, int utcOffsetMinutes)
    {
        if (end <= start) return false;

        var calendar = Index(days);
        var (startDay, startMinute) = Local(start, utcOffsetMinutes);
        var endMinute = MinutesFrom(startDay, end, utcOffsetMinutes);

        // Walk day by day: each day's part must sit in one set, and a part that
        // carries on to the next day must run to that day's midnight.
        var day = startDay;
        var from = startMinute;
        var to = endMinute;
        while (true)
        {
            var partEnd = Math.Min(to, MinutesPerDay);
            if (!SetsOf(calendar, day).Any(s => s.Start <= from && partEnd <= s.End)) return false;
            if (to <= MinutesPerDay) return true;

            day = day.AddDays(1);
            from = 0;
            to -= MinutesPerDay;
        }
    }

    /// <summary>
    /// A caretaker booking: the drop-off falls in open hours on its day (from
    /// opening, before closing) and so does the pick-up (opening to closing,
    /// both inclusive). The days in between are not read — an animal boarding
    /// over a closed Sunday is still boarding.
    /// </summary>
    public static bool CoversStay(
        IEnumerable<AvailabilityDayDto> days, DateTimeOffset start, DateTimeOffset end, int utcOffsetMinutes)
    {
        if (end <= start) return false;

        var calendar = Index(days);

        var (startDay, startMinute) = Local(start, utcOffsetMinutes);
        if (!SetsOf(calendar, startDay).Any(s => s.Start <= startMinute && startMinute < s.End)) return false;

        var (endDay, endMinute) = Local(end, utcOffsetMinutes);
        if (SetsOf(calendar, endDay).Any(s => s.Start <= endMinute && endMinute <= s.End)) return true;

        // A pick-up at exactly midnight is the end of the day that is ending.
        return endMinute == 0
               && SetsOf(calendar, endDay.AddDays(-1)).Any(s => s.End >= MinutesPerDay);
    }

    private readonly record struct Hours(double Start, double End);

    private static Dictionary<DateOnly, Hours[]> Index(IEnumerable<AvailabilityDayDto> days)
    {
        var index = new Dictionary<DateOnly, Hours[]>();
        foreach (var day in days)
        {
            var sets = new List<Hours>();
            foreach (var slot in day.Slots ?? [])
            {
                if (ClockMinutes(slot.Start) is not { } start || ClockMinutes(slot.End) is not { } end) continue;
                if (end == MinutesPerDay - 1) end = MinutesPerDay;     // 23:59 → midnight
                if (end > start) sets.Add(new Hours(start, end));
            }
            index[day.Date] = [.. sets];
        }
        return index;
    }

    private static Hours[] SetsOf(Dictionary<DateOnly, Hours[]> calendar, DateOnly day)
        => calendar.TryGetValue(day, out var sets) ? sets : [];

    private static (DateOnly Day, double Minute) Local(DateTimeOffset instant, int utcOffsetMinutes)
    {
        var local = instant.ToOffset(TimeSpan.FromMinutes(utcOffsetMinutes)).DateTime;
        return (DateOnly.FromDateTime(local), local.TimeOfDay.TotalMinutes);
    }

    /// <summary>Minutes from the start of <paramref name="day"/>, local, to <paramref name="instant"/>.</summary>
    private static double MinutesFrom(DateOnly day, DateTimeOffset instant, int utcOffsetMinutes)
    {
        var local = instant.ToOffset(TimeSpan.FromMinutes(utcOffsetMinutes)).DateTime;
        return (local - day.ToDateTime(TimeOnly.MinValue)).TotalMinutes;
    }

    /// <summary>"HH:mm" on a 24-hour clock, or null. "24:00" and "09:75" are not clock times.</summary>
    private static double? ClockMinutes(string? value)
        => TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)
            ? t.Hour * 60 + t.Minute
            : null;
}
