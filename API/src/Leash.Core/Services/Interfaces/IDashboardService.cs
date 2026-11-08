using Leash.Core.Models.Dtos;

namespace Leash.Core.Services.Interfaces;

/// <summary>
/// The dashboards' top cards, counted on the server.
///
/// The dashboards used to count the first hundred rows of each list in the
/// browser, which goes quietly wrong for anyone with a hundred and one — and an
/// "earnings" figure is money, which the server owns. Each read is scoped
/// exactly as the list beside it: a clinic's and a caretaker's figures are
/// theirs alone, and an owner's are read from the session.
/// </summary>
public interface IDashboardService
{
    /// <summary>A clinic's figures. Null unless the caller owns the vet profile.</summary>
    Task<ProviderStatsDto?> GetVetStatsAsync(
        string callerId, string vetId, DateTimeOffset? upcomingFrom,
        CancellationToken ct = default);

    /// <summary>A caretaker's figures. Null unless the caller owns the caretaker profile.</summary>
    Task<ProviderStatsDto?> GetCaretakerStatsAsync(
        string callerId, string caretakerId, DateTimeOffset? upcomingFrom,
        CancellationToken ct = default);

    /// <summary>The caller's own figures as an owner.</summary>
    Task<OwnerStatsDto> GetOwnerStatsAsync(
        string callerId, DateTimeOffset? upcomingFrom, CancellationToken ct = default);
}
