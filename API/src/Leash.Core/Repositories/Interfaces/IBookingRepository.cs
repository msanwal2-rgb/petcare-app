using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Persistence;

namespace Leash.Core.Repositories.Interfaces;

/// <summary>
/// <c>bookings</c>.
///
/// Both list methods are cursor-paginated. A caretaker with two years of
/// history has thousands of rows, and "load them all and show twenty" is the
/// shape that works in the demo and falls over in production — STATUS.md §5
/// makes cursor pagination the rule for every list endpoint from M4.
/// </summary>
public interface IBookingRepository
{
    Task<BookingEntity?> GetByIdAsync(
        string id, ITransactionScope? scope = null, CancellationToken ct = default);

    Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByOwnerAsync(
        string ownerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByCaretakerAsync(
        string caretakerId, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// The bookings this person made that overlap <paramref name="window"/>,
    /// soonest first — the owner's calendar.
    /// </summary>
    Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByOwnerInWindowAsync(
        string ownerId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>One caretaker's bookings that overlap <paramref name="window"/>, soonest first.</summary>
    Task<(IReadOnlyList<BookingEntity> Rows, string? NextCursor)> ListByCaretakerInWindowAsync(
        string caretakerId, ScheduleWindow window, string? cursor, int limit,
        ITransactionScope? scope = null, CancellationToken ct = default);

    Task<BookingEntity> CreateAsync(
        BookingEntity booking, ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// Move the status. Returns the row as it now stands, or null if it is gone.
    ///
    /// The legality and actor checks are <b>not</b> here — they are rules, and
    /// they live in <see cref="Services.BookingService"/>. This writes what it
    /// is told.
    /// </summary>
    Task<BookingEntity?> UpdateStatusAsync(
        string id, string status,
        ITransactionScope? scope = null, CancellationToken ct = default);

    /// <summary>
    /// How many of this caretaker's requests are answered and how many are still
    /// waiting — the two numbers a response rate is computed from.
    /// </summary>
    Task<RequestCounts> CountRequestsAsync(
        string caretakerId, IReadOnlyCollection<string> answered, string waiting,
        ITransactionScope? scope = null, CancellationToken ct = default);
}

/// <summary>A mutable class, because Dapper materialises it.</summary>
public sealed class RequestCounts
{
    public int Answered { get; set; }
    public int Waiting { get; set; }
}
