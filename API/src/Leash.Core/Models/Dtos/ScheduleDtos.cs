namespace Leash.Core.Models.Dtos;

// ── The dashboards' schedule reads ────────────────────────────────────────
//
// The four list routes — `GET /appointments`, `GET /vets/{id}/appointments`,
// `GET /bookings`, `GET /caretakers/{id}/bookings` — take two shapes of query.
// Without `from` they are what they always were: newest first, a cursor page.
// With `from` they read a *window* of the calendar instead: everything that has
// not ended before `from` (and, given `to`, starts before it), soonest first,
// still a cursor page. That is what the dashboard calendar and its "upcoming"
// list need, and it is what the first-100-newest read could not give them once
// somebody had more than a hundred rows.

/// <summary>
/// The query string of a schedule list. Abstract because the status
/// vocabulary differs — an appointment is <c>confirmed</c> where a booking is
/// <c>accepted</c> — and the validator is chosen by the concrete type.
/// </summary>
public abstract class ScheduleListQuery
{
    public string? Cursor { get; set; }
    public int? Limit { get; set; }

    /// <summary>Read a window starting here. Absent ⇒ the ordinary newest-first list.</summary>
    public DateTimeOffset? From { get; set; }

    /// <summary>The window's end, exclusive. Needs <see cref="From"/>.</summary>
    public DateTimeOffset? To { get; set; }

    /// <summary>Comma-separated statuses to keep. Needs <see cref="From"/>.</summary>
    public string? Status { get; set; }

    /// <summary>The window this query describes, or null for the ordinary list.</summary>
    public ScheduleWindow? ToWindow() => From is { } from
        ? new ScheduleWindow(from, To, ParseStatuses(Status))
        : null;

    public static string[] ParseStatuses(string? csv) => string.IsNullOrWhiteSpace(csv)
        ? []
        : [.. csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct()];
}

public sealed class AppointmentListQuery : ScheduleListQuery;

public sealed class BookingListQuery : ScheduleListQuery;

/// <summary>
/// A stretch of the calendar. A row is in it when it <b>overlaps</b> it —
/// ends after <see cref="From"/> and starts before <see cref="To"/> — so a
/// three-night boarding that began yesterday is on today's page. An empty
/// <see cref="Statuses"/> keeps every status.
/// </summary>
public sealed record ScheduleWindow(DateTimeOffset From, DateTimeOffset? To, string[] Statuses);

// ── The dashboards' headline figures ─────────────────────────────────────

/// <summary>
/// A vet's or caretaker's top cards, counted in SQL over every row rather than
/// over the page a dashboard happens to hold.
///
/// <see cref="Total"/> is every engagement that went ahead or still might —
/// declined and cancelled ones are not work. <see cref="Upcoming"/> is the part
/// of that still live and not over before the viewer's today.
/// <see cref="EarnedCents"/> is the price quoted on each <b>completed</b> one:
/// bookings and vet visits are not charged through Leash, so this is the value
/// of finished work, not money received — the screen says so.
/// </summary>
public sealed record ProviderStatsDto(int Total, int Upcoming, int Completed, int EarnedCents);

/// <summary>
/// An owner's top cards. <see cref="Requests"/>, <see cref="Upcoming"/> and
/// <see cref="Completed"/> count bookings and vet visits together, by the same
/// rules as <see cref="ProviderStatsDto"/>. <see cref="SpentCents"/> is
/// <b>money that actually moved</b>: what the ledger captured from this person —
/// store orders, Leash Plus, adoption fees — less what it refunded.
/// </summary>
public sealed record OwnerStatsDto(int Requests, int Upcoming, int Completed, int SpentCents);

/// <summary>The query string of a stats read.</summary>
public sealed class StatsQuery
{
    /// <summary>
    /// The start of the viewer's today. The browser knows its time zone and
    /// the server does not, so the client says when "today" began; absent ⇒
    /// midnight UTC.
    /// </summary>
    public DateTimeOffset? From { get; set; }
}
