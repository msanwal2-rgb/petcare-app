using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

public sealed class CatalogService(
    ICatalogRepository catalog,
    IPetRepository pets,
    IAccessService access) : ICatalogService
{
    /// <summary>How many recommendations a pet's page shows.</summary>
    private const int RecommendationLimit = 8;

    public async Task<IReadOnlyList<string>> ListBrandsAsync(CancellationToken ct = default)
        => await catalog.ListBrandsAsync(ct: ct);

    /// <summary>
    /// Products worth putting in front of one particular animal: right species,
    /// right life stage for its age, in stock, not prescription-only, and
    /// nothing containing an ingredient it reacts to.
    ///
    /// <b>Owner-only</b>, unlike the rest of the catalogue, because the answer is
    /// derived from the pet's allergy list — a recommendation set is a readout of
    /// the animal's medical profile, and handing it to a sitter would leak what
    /// <see cref="IAccessService.CanAccessPetRecordsAsync"/> exists to protect.
    ///
    /// Returns null when the caller does not own the pet, which the controller
    /// turns into 404.
    /// </summary>
    public async Task<IReadOnlyList<ProductDto>?> RecommendForPetAsync(
        string callerId, string petId, CancellationToken ct = default)
    {
        if (!await access.OwnsPetAsync(callerId, petId, ct: ct)) return null;

        var pet = await pets.GetByIdAsync(petId, ct: ct);
        if (pet is null) return null;

        // Over-fetch, because the allergen filter cannot run in SQL — see
        // HasAllergen. Three times the limit is what the reference used and is
        // ample: it would take a pet reacting to two thirds of the catalogue to
        // exhaust it, and under-filling is a cosmetic failure, not a safety one.
        var candidates = await catalog.ListRecommendationCandidatesAsync(
            pet.Species, LifeStageFor(pet.Species, pet.Dob),
            RecommendationLimit * 3, ct: ct);

        var petAllergens = pet.Allergies
            .Select(a => a.ToLowerInvariant())
            .Where(a => a.Length > 0)
            .ToArray();

        return
        [
            .. candidates
                .Where(p => !HasAllergen(p.Allergens, petAllergens))
                .Take(RecommendationLimit)
                .Select(p => p.ToDto())
        ];
    }

    /// <summary>
    /// Does this product contain something the pet reacts to?
    ///
    /// The match is deliberately <b>loose</b> — substring, either direction,
    /// case-insensitive — because an owner writes "Chicken" and the product
    /// lists "chicken by-product meal". An equality match would miss it, and
    /// missing it is how an allergic animal gets recommended the thing that
    /// makes it ill. Over-filtering is the safe direction to be wrong in: the
    /// cost is a product that does not appear on a recommendations shelf.
    ///
    /// <paramref name="petAllergensLower"/> is expected already lowercased.
    ///
    /// Blank entries are skipped on <b>both</b> sides, and that is the one part
    /// of this worth being careful about: <c>"".Contains(x)</c> and
    /// <c>x.Contains("")</c> are both true, so a single empty string would match
    /// every product in the catalogue and silently return an empty shelf. The
    /// caller strips them too; this does not rely on that, because the failure
    /// is invisible — an empty shelf looks like a thin catalogue, not a bug.
    /// </summary>
    public static bool HasAllergen(
        IReadOnlyCollection<string> productAllergens,
        IReadOnlyCollection<string> petAllergensLower)
    {
        foreach (var raw in productAllergens)
        {
            var allergen = raw.ToLowerInvariant();
            if (allergen.Length == 0) continue;

            foreach (var petAllergen in petAllergensLower)
            {
                if (petAllergen.Length == 0) continue;

                if (allergen.Contains(petAllergen, StringComparison.Ordinal)
                    || petAllergen.Contains(allergen, StringComparison.Ordinal))
                {
                    return true;
                }
            }
        }

        return false;
    }

    /// <summary>
    /// Map an animal's age and species onto the catalogue's life-stage buckets.
    ///
    /// Under a year is a puppy or a kitten; eight years and over is senior;
    /// everything between is adult. The thresholds are the reference
    /// implementation's and are rough by nature — a Great Dane is senior long
    /// before a chihuahua — but this picks which shelf to show, not a treatment
    /// plan, and a breed-weighted table is a catalogue problem rather than an
    /// authorization one.
    ///
    /// Computed against <see cref="Ids.Now"/> so it agrees with every other
    /// clock read in the process.
    /// </summary>
    public static string LifeStageFor(string species, DateOnly dob)
    {
        // Whole days rather than months: a month is not a fixed length, and the
        // reference's 30.44-day average drifts against a real calendar.
        const int DaysInYear = 365;

        var today = DateOnly.FromDateTime(Ids.Now().UtcDateTime);
        var ageInDays = today.DayNumber - dob.DayNumber;

        if (ageInDays < DaysInYear)
            return species == Species.Cat ? LifeStages.Kitten : LifeStages.Puppy;

        return ageInDays >= DaysInYear * 8 ? LifeStages.Senior : LifeStages.Adult;
    }
}
