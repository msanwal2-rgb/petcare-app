using Leash.Core.Models.Entities;

namespace Leash.Core.Services;

/// <summary>
/// Whether a pet's active prescriptions cover a basket's Rx-only lines, and
/// which refills that uses (REQUIREMENTS.md S7, P9).
///
/// ── The rule, as the owner decided it ──
///
/// <c>refillsLeft</c> is the number of purchases a prescription still
/// authorises. <b>Zero means exhausted</b> — the active-prescription predicate
/// already excludes it — and <b>null means the vet set no limit</b>, which never
/// runs out. Checkout decrements it in the same transaction as the stock
/// (STATUS.md §5). Until M6 nothing did, and one prescription authorised
/// unlimited purchases until it expired: exactly the inconsistency P9 forbade.
///
/// ── One refill per unit, not per line ──
///
/// A judgment call, made in the direction that refuses rather than
/// over-authorises. Counted per line, a single remaining refill would cover a
/// line of ninety-nine bags. Counted per unit, "three refills" is three bags,
/// which is what a vet writing it means.
///
/// ── Several prescriptions, one running tally ──
///
/// A pet may hold more than one prescription naming a product, and one
/// prescription may name several products. So this is stateful: each line draws
/// down what is left after the lines before it, and two Rx products in one
/// basket cannot both claim the same refill. An unlimited prescription covers
/// any quantity and is used first, because it costs the owner nothing. Among
/// limited ones the soonest to expire is used first — a refill that would lapse
/// unused is the one worth spending.
/// </summary>
public sealed class PrescriptionCover
{
    public enum Outcome
    {
        Covered,

        /// <summary>No active prescription names this product.</summary>
        NotPrescribed,

        /// <summary>Prescribed, but not for this many. See <see cref="Result.Available"/>.</summary>
        Insufficient,
    }

    public sealed record Use(string RecordId, int Count);

    public sealed record Result(Outcome Outcome, int Available, IReadOnlyList<Use> Uses);

    private readonly IReadOnlyList<MedicalRecordEntity> _prescriptions;

    /// <summary>What is left on each limited prescription; null for an unlimited one.</summary>
    private readonly Dictionary<string, int?> _remaining;

    public PrescriptionCover(IReadOnlyList<MedicalRecordEntity> activePrescriptions)
    {
        _prescriptions = activePrescriptions;
        _remaining = activePrescriptions.ToDictionary(p => p.Id, p => p.RefillsLeft);
    }

    /// <summary>
    /// Cover <paramref name="quantity"/> units of the product with
    /// <paramref name="slug"/>, drawing down the running tally when it can.
    /// A refusal draws down nothing.
    /// </summary>
    public Result Cover(string slug, int quantity)
    {
        var candidates = _prescriptions
            .Where(p => p.ProductSlugs.Contains(slug, StringComparer.Ordinal))
            .ToList();

        if (candidates.Count == 0) return new(Outcome.NotPrescribed, 0, []);

        if (candidates.Any(p => _remaining[p.Id] is null))
            return new(Outcome.Covered, int.MaxValue, []);

        var ordered = candidates
            .OrderBy(p => p.ExpiresAt ?? DateTimeOffset.MaxValue)
            .ThenBy(p => p.OccurredAt)
            .ThenBy(p => p.Id, StringComparer.Ordinal)
            .ToList();

        var available = ordered.Sum(p => _remaining[p.Id]!.Value);
        if (available < quantity) return new(Outcome.Insufficient, available, []);

        var uses = new List<Use>();
        var owed = quantity;
        foreach (var p in ordered)
        {
            if (owed == 0) break;

            var take = Math.Min(owed, _remaining[p.Id]!.Value);
            if (take == 0) continue;

            uses.Add(new Use(p.Id, take));
            _remaining[p.Id] -= take;
            owed -= take;
        }

        return new(Outcome.Covered, available, uses);
    }

    /// <summary>The customer-facing reason a line was refused.</summary>
    public static string Message(Result result, string productName, int quantity) => result switch
    {
        { Outcome: Outcome.Insufficient, Available: 0 } =>
            $"The prescription for {productName} has no refills left. Your vet can renew it.",
        { Outcome: Outcome.Insufficient } =>
            $"The prescription for {productName} covers {result.Available} more, and there are {quantity} in your basket.",
        _ => $"{productName} needs a current prescription from your vet.",
    };
}
