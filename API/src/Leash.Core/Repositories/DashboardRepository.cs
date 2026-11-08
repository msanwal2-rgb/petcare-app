using Dapper;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Npgsql;

namespace Leash.Core.Repositories;

/// <summary>Dapper aggregates over <c>vet_appointments</c>, <c>bookings</c> and <c>payments</c>.</summary>
public sealed class DashboardRepository(NpgsqlDataSource db) : IDashboardRepository
{
    public Task<EngagementCounts> CountVetAppointmentsAsync(
        string vetId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => CountAsync("vet_appointments", "\"vetId\"", "\"feeCents\"", vetId, rules, upcomingFrom, scope, ct);

    public Task<EngagementCounts> CountCaretakerBookingsAsync(
        string caretakerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => CountAsync("bookings", "\"caretakerId\"", "\"priceTotalCents\"", caretakerId, rules, upcomingFrom, scope, ct);

    public Task<EngagementCounts> CountOwnerAppointmentsAsync(
        string ownerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => CountAsync("vet_appointments", "\"ownerId\"", "\"feeCents\"", ownerId, rules, upcomingFrom, scope, ct);

    public Task<EngagementCounts> CountOwnerBookingsAsync(
        string ownerId, EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => CountAsync("bookings", "\"ownerId\"", "\"priceTotalCents\"", ownerId, rules, upcomingFrom, scope, ct);

    /// <summary>
    /// Every figure in one round trip. <paramref name="table"/>,
    /// <paramref name="column"/> and <paramref name="priceColumn"/> are
    /// compile-time literals from the four callers above, never request input.
    ///
    /// "Upcoming" is live and not over before <paramref name="upcomingFrom"/> —
    /// the same overlap rule as the calendar's window, so the card and the list
    /// under it agree. A request nobody answered whose time has passed is in
    /// neither.
    /// </summary>
    private async Task<EngagementCounts> CountAsync(
        string table, string column, string priceColumn, string value,
        EngagementRules rules, DateTimeOffset upcomingFrom,
        ITransactionScope? scope, CancellationToken ct)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);

        // ::int because count(*) and sum(int) are bigint.
        return await session.Connection.QuerySingleAsync<EngagementCounts>(
            new CommandDefinition(
                $"""
                 SELECT
                     count(*) FILTER (WHERE status = ANY(@counted))::int AS "Total",
                     count(*) FILTER (WHERE status = ANY(@live)
                                        AND "endDateTime" > @upcomingFrom)::int AS "Upcoming",
                     count(*) FILTER (WHERE status = @completed)::int AS "Completed",
                     COALESCE(sum({priceColumn}) FILTER (WHERE status = @completed), 0)::int
                         AS "CompletedValueCents"
                 FROM {table}
                 WHERE {column} = @value
                 """,
                new
                {
                    value,
                    counted = rules.Counted,
                    live = rules.Live,
                    completed = rules.Completed,
                    upcomingFrom,
                },
                session.Transaction, cancellationToken: ct));
    }

    public async Task<int> SumSpentCentsAsync(
        string userId, IReadOnlyCollection<string> settledStatuses,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        await using var session = await DbSession.OpenAsync(db, scope, ct);
        return await session.Connection.QuerySingleAsync<int>(
            new CommandDefinition(
                """
                SELECT COALESCE(sum("amountCents" - "amountRefundedCents"), 0)::int
                FROM payments
                WHERE "userId" = @userId AND status = ANY(@settled)
                """,
                new { userId, settled = settledStatuses.ToArray() },
                session.Transaction, cancellationToken: ct));
    }
}
