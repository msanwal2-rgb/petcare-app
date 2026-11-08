using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// The dashboards' figures. See <see cref="IDashboardService"/>; the rules are
/// the three tables below.
/// </summary>
public sealed class DashboardService(
    IDashboardRepository dashboard,
    IAccessService access) : IDashboardService
{
    /// <summary>
    /// What counts, for appointments. <b>Counted</b> is everything that went
    /// ahead or still might — a declined or cancelled request was never work.
    /// <b>Live</b> is what can still happen.
    /// </summary>
    private static readonly EngagementRules Appointments = new(
        Counted:
        [
            AppointmentStatuses.Requested, AppointmentStatuses.Confirmed,
            AppointmentStatuses.InProgress, AppointmentStatuses.Completed,
        ],
        Live:
        [
            AppointmentStatuses.Requested, AppointmentStatuses.Confirmed,
            AppointmentStatuses.InProgress,
        ],
        Completed: AppointmentStatuses.Completed);

    /// <summary>The same rules in the booking vocabulary.</summary>
    private static readonly EngagementRules Bookings = new(
        Counted:
        [
            BookingStatuses.Requested, BookingStatuses.Accepted,
            BookingStatuses.InProgress, BookingStatuses.Completed,
        ],
        Live: [BookingStatuses.Requested, BookingStatuses.Accepted, BookingStatuses.InProgress],
        Completed: BookingStatuses.Completed);

    /// <summary>
    /// The payments where money moved. Each contributes what was captured less
    /// what was refunded, so a refunded payment adds nothing and a partial
    /// refund adds the part kept. A disputed payment was captured and is still
    /// held, so it counts until the dispute is lost — which refunds it.
    /// </summary>
    private static readonly string[] Settled =
    [
        PaymentStatuses.Paid, PaymentStatuses.PartiallyRefunded,
        PaymentStatuses.Refunded, PaymentStatuses.Disputed,
    ];

    public async Task<ProviderStatsDto?> GetVetStatsAsync(
        string callerId, string vetId, DateTimeOffset? upcomingFrom,
        CancellationToken ct = default)
    {
        // Theirs alone, as the schedule it summarises.
        if (!await access.OwnsVetProfileAsync(callerId, vetId, ct: ct)) return null;

        var counts = await dashboard.CountVetAppointmentsAsync(
            vetId, Appointments, Today(upcomingFrom), ct: ct);

        return Provider(counts);
    }

    public async Task<ProviderStatsDto?> GetCaretakerStatsAsync(
        string callerId, string caretakerId, DateTimeOffset? upcomingFrom,
        CancellationToken ct = default)
    {
        if (!await access.OwnsCaretakerProfileAsync(callerId, caretakerId, ct: ct)) return null;

        var counts = await dashboard.CountCaretakerBookingsAsync(
            caretakerId, Bookings, Today(upcomingFrom), ct: ct);

        return Provider(counts);
    }

    public async Task<OwnerStatsDto> GetOwnerStatsAsync(
        string callerId, DateTimeOffset? upcomingFrom, CancellationToken ct = default)
    {
        var from = Today(upcomingFrom);

        var bookings = await dashboard.CountOwnerBookingsAsync(callerId, Bookings, from, ct: ct);
        var visits = await dashboard.CountOwnerAppointmentsAsync(callerId, Appointments, from, ct: ct);
        var spent = await dashboard.SumSpentCentsAsync(callerId, Settled, ct: ct);

        return new OwnerStatsDto(
            Requests: bookings.Total + visits.Total,
            Upcoming: bookings.Upcoming + visits.Upcoming,
            Completed: bookings.Completed + visits.Completed,
            SpentCents: spent);
    }

    private static ProviderStatsDto Provider(EngagementCounts c)
        => new(c.Total, c.Upcoming, c.Completed, c.CompletedValueCents);

    /// <summary>
    /// The start of the viewer's today, as the client said it; else midnight
    /// UTC. Only "today" — never a timestamp the viewer could push into the
    /// past to make the card count history — so it is clamped to within a day
    /// of now either way, which covers every time zone.
    /// </summary>
    public static DateTimeOffset Today(DateTimeOffset? given)
    {
        var now = Ids.Now();
        var midnightUtc = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);

        if (given is not { } from) return midnightUtc;

        var earliest = now.AddHours(-26);
        var latest = now;
        return from < earliest ? earliest : from > latest ? latest : from;
    }
}
