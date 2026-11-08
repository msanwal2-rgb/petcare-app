using Leash.Core.Models.Dtos;
using Leash.Core.Services;

namespace Leash.Api.Tests;

/// <summary>
/// The server's own reading of a provider's published calendar (STATUS §3-G).
///
/// Before this, nothing on the server looked at availability: the vet form
/// offered only published hours, the caretaker form showed none, and either
/// request could name any time. Published hours are local clock times
/// ("09:00") and the server knows no one's zone, so a request carries the
/// browser's offset and these rules read the instants in it.
///
/// Pure functions, no database.
/// </summary>
public sealed class PublishedHoursTests
{
    private static readonly DateOnly Day = new(2026, 12, 7);

    private static AvailabilityDayDto Open(DateOnly date, params (string Start, string End)[] sets)
        => new(date, [.. sets.Select(s => new SlotDto(s.Start, s.End))]);

    private static DateTimeOffset At(DateOnly date, int hour, int minute = 0, int offsetMinutes = 0)
        => new(date.Year, date.Month, date.Day, hour, minute, 0, TimeSpan.FromMinutes(offsetMinutes));

    private static readonly AvailabilityDayDto[] Clinic =
        [Open(Day, ("09:00", "12:00"), ("13:00", "17:00"))];

    // ── A visit: one published set holds the whole of it ───────────────────

    [Fact]
    public void A_visit_inside_a_published_set_is_covered()
        => Assert.True(PublishedHours.CoversVisit(Clinic, At(Day, 9), At(Day, 9, 30), 0));

    [Fact]
    public void A_visit_that_is_exactly_the_set_is_covered()
        => Assert.True(PublishedHours.CoversVisit(Clinic, At(Day, 13), At(Day, 17), 0));

    [Fact]
    public void A_visit_starting_before_the_set_opens_is_not()
        => Assert.False(PublishedHours.CoversVisit(Clinic, At(Day, 8, 45), At(Day, 9, 15), 0));

    [Fact]
    public void A_visit_running_past_the_set_is_not()
        => Assert.False(PublishedHours.CoversVisit(Clinic, At(Day, 11, 45), At(Day, 12, 15), 0));

    [Fact]
    public void A_visit_spanning_the_lunch_gap_is_not_held_by_either_set()
        => Assert.False(PublishedHours.CoversVisit(Clinic, At(Day, 11), At(Day, 14), 0));

    [Fact]
    public void A_visit_on_a_day_nobody_published_is_not()
        => Assert.False(PublishedHours.CoversVisit(Clinic, At(Day.AddDays(1), 10), At(Day.AddDays(1), 10, 30), 0));

    [Fact]
    public void A_published_day_with_no_hours_is_closed()
        => Assert.False(PublishedHours.CoversVisit(
            [Open(Day)], At(Day, 10), At(Day, 10, 30), 0));

    [Fact]
    public void Hours_are_read_in_the_requesters_zone()
    {
        // 09:00 at UTC-6 is 15:00 UTC. Read in the right zone it is the
        // morning set; read as UTC it would be the afternoon one.
        var start = At(Day, 9, 0, offsetMinutes: -360).ToUniversalTime();
        var end = start.AddMinutes(30);

        Assert.True(PublishedHours.CoversVisit(Clinic, start, end, -360));
        Assert.True(PublishedHours.CoversVisit(
            [Open(Day, ("15:00", "16:00"))], start, end, 0));
        Assert.False(PublishedHours.CoversVisit(
            [Open(Day, ("15:00", "16:00"))], start, end, -360));
    }

    [Fact]
    public void The_zone_decides_the_day_as_well_as_the_hour()
    {
        // 23:30 UTC on the 6th is 05:30 on the 7th at UTC+6.
        var start = At(Day.AddDays(-1), 23, 30);
        var dawn = new[] { Open(Day, ("05:00", "07:00")) };

        Assert.True(PublishedHours.CoversVisit(dawn, start, start.AddMinutes(30), 360));
        Assert.False(PublishedHours.CoversVisit(dawn, start, start.AddMinutes(30), 0));
    }

    [Fact]
    public void A_set_ending_at_23_59_runs_to_midnight()
    {
        // The editor cannot say 24:00, so "until 23:59" is how a provider
        // says "until the end of the day".
        var late = new[] { Open(Day, ("20:00", "23:59")) };

        Assert.True(PublishedHours.CoversVisit(late, At(Day, 23, 30), At(Day.AddDays(1), 0), 0));
        Assert.True(PublishedHours.CoversVisit(late, At(Day, 23, 59), At(Day, 23, 59).AddSeconds(30), 0));
    }

    [Fact]
    public void A_visit_may_run_over_midnight_into_hours_that_carry_straight_on()
        => Assert.True(PublishedHours.CoversVisit(
            [Open(Day, ("20:00", "23:59")), Open(Day.AddDays(1), ("00:00", "03:00"))],
            At(Day, 23, 30), At(Day.AddDays(1), 0, 30), 0));

    [Fact]
    public void A_visit_cannot_run_over_midnight_into_a_gap()
    {
        Assert.False(PublishedHours.CoversVisit(
            [Open(Day, ("20:00", "23:59")), Open(Day.AddDays(1), ("01:00", "03:00"))],
            At(Day, 23, 30), At(Day.AddDays(1), 0, 30), 0));
        Assert.False(PublishedHours.CoversVisit(
            [Open(Day, ("20:00", "23:00")), Open(Day.AddDays(1), ("00:00", "03:00"))],
            At(Day, 22, 30), At(Day.AddDays(1), 0, 30), 0));
        Assert.False(PublishedHours.CoversVisit(
            [Open(Day, ("20:00", "23:59"))],
            At(Day, 23, 30), At(Day.AddDays(1), 0, 30), 0));
    }

    [Fact]
    public void Malformed_hours_open_nothing()
        => Assert.False(PublishedHours.CoversVisit(
            [Open(Day, ("nine", "noon"), ("25:00", "26:00"))], At(Day, 10), At(Day, 10, 30), 0));

    // ── A stay: the drop-off and the pick-up each land in open hours ───────

    private static readonly AvailabilityDayDto[] Sitter =
    [
        Open(Day, ("08:00", "12:00"), ("13:00", "18:00")),
        Open(Day.AddDays(3), ("08:00", "12:00")),
    ];

    [Fact]
    public void A_stay_with_both_ends_in_open_hours_is_covered()
        => Assert.True(PublishedHours.CoversStay(Sitter, At(Day, 9), At(Day.AddDays(3), 11), 0));

    [Fact]
    public void The_days_in_between_are_not_checked()
        => Assert.True(PublishedHours.CoversStay(Sitter, At(Day, 17), At(Day.AddDays(3), 8), 0));

    [Fact]
    public void A_walk_inside_one_set_is_covered()
        => Assert.True(PublishedHours.CoversStay(Sitter, At(Day, 13), At(Day, 14), 0));

    [Fact]
    public void A_drop_off_outside_open_hours_is_not()
        => Assert.False(PublishedHours.CoversStay(Sitter, At(Day, 7), At(Day.AddDays(3), 11), 0));

    [Fact]
    public void A_drop_off_at_closing_time_is_not()
        => Assert.False(PublishedHours.CoversStay(Sitter, At(Day, 18), At(Day.AddDays(3), 11), 0));

    [Fact]
    public void A_pick_up_on_a_closed_day_is_not()
        => Assert.False(PublishedHours.CoversStay(Sitter, At(Day, 9), At(Day.AddDays(2), 11), 0));

    [Fact]
    public void A_pick_up_after_closing_is_not()
        => Assert.False(PublishedHours.CoversStay(Sitter, At(Day, 9), At(Day.AddDays(3), 12, 30), 0));

    [Fact]
    public void A_pick_up_at_midnight_counts_against_the_day_that_is_ending()
    {
        var open = new[] { Open(Day, ("18:00", "23:59")) };

        Assert.True(PublishedHours.CoversStay(open, At(Day, 19), At(Day.AddDays(1), 0), 0));
    }

    [Fact]
    public void A_stay_is_read_in_the_requesters_zone()
    {
        // 08:30 at UTC+5 is 03:30 UTC — closed if read as UTC.
        var start = At(Day, 8, 30, offsetMinutes: 300).ToUniversalTime();
        var end = At(Day, 11, 0, offsetMinutes: 300).ToUniversalTime();

        Assert.True(PublishedHours.CoversStay(Sitter, start, end, 300));
        Assert.False(PublishedHours.CoversStay(Sitter, start, end, 0));
    }
}
