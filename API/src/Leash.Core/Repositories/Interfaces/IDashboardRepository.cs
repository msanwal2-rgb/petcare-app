using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// The dashboards' headline figures, each one aggregate query.
///
/// Read-only and across tables (bookings, vet appointments, payments), which is
/// why it is its own repository rather than a method on each: what a dashboard
/// card counts is a reporting question, and widening it must never widen a
/// list or an authorization query.
///
/// The status lists are arguments — they are rules, and they live in
/// <see cref="Services.DashboardService"/>.
/// </summary>
public interface IDashboardRepository
{
    /// <summary>One clinic's appointments, counted. <paramref name="vetId"/> is a profile id.</summary>
    Task<EngagementCounts> CountVetAppointmentsAsync(
        string vetId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>One caretaker's bookings, counted. <paramref name="caretakerId"/> is a profile id.</summary>
    Task<EngagementCounts> CountCaretakerBookingsAsync(
        string caretakerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The appointments this person booked as an owner, counted.</summary>
    Task<EngagementCounts> CountOwnerAppointmentsAsync(
        string ownerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>The bookings this person made as an owner, counted.</summary>
    Task<EngagementCounts> CountOwnerBookingsAsync(
        string ownerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// What the ledger captured from this person less what it refunded, over
    /// payments whose status is one of <paramref name="settledStatuses"/>.
    /// </summary>
    Task<int> SumSpentCentsAsync(
        string userId, IReadOnlyCollection<string> settledStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>
/// Which statuses count as what, for one table's vocabulary. A booking says
/// <c>accepted</c> where an appointment says <c>confirmed</c>.
/// </summary>
public sealed record EngagementRules(
    string[] Counted,
    string[] Live,
    string Completed);

/// <summary>A mutable class, because Dapper materialises it.</summary>
public sealed class EngagementCounts
{
    public int Total { get; set; }
    public int Upcoming { get; set; }
    public int Completed { get; set; }

    /// <summary>The quoted price of the completed ones, in cents.</summary>
    public int CompletedValueCents { get; set; }
}
