using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>caretaker_profiles</c> row.
///
/// The three reputation columns are here because they are columns, and absent
/// from the patch DTO because they are derived. See
/// <see cref="Services.ReputationService"/> — it is the only writer.
/// </summary>
public class CaretakerProfileEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Bio { get; set; } = "";
    public string[] ServicesOffered { get; set; } = [];
    public int ServiceRadiusMiles { get; set; }
    public string[] AcceptedSpecies { get; set; } = [];
    public bool FencedYard { get; set; }
    public bool HasOtherPets { get; set; }
    public bool SmokeFree { get; set; }
    public string[] Certifications { get; set; } = [];
    public string BackgroundCheckStatus { get; set; } = "";
    public double Rating { get; set; }
    public int ReviewCount { get; set; }
    public int ResponseRatePct { get; set; }

    public CaretakerProfileDto ToDto(
        IReadOnlyList<PricingEntryEntity> pricing,
        IReadOnlyList<AvailabilityDayEntity> availability) => new(
        Id, UserId, Bio, ServicesOffered,
        [.. pricing.Select(p => p.ToDto())],
        ServiceRadiusMiles, AcceptedSpecies,
        new HomeEnvironmentDto(FencedYard, HasOtherPets, SmokeFree),
        Certifications, BackgroundCheckStatus, Rating, ReviewCount, ResponseRatePct,
        [.. availability.Select(a => a.ToDto())]);
}

/// <summary>One line of a rate card. The column is integer cents; the DTO is USD.</summary>
public class PricingEntryEntity
{
    public string Id { get; set; } = "";
    public string CaretakerId { get; set; } = "";
    public string ServiceType { get; set; } = "";
    public string Unit { get; set; } = "";
    public int RateCents { get; set; }

    public PricingEntryDto ToDto() => new(ServiceType, Unit, RateCents / 100m);
}

/// <summary>
/// One day of availability. <see cref="Slots"/> is <c>jsonb</c>, deserialised by
/// Npgsql's dynamic JSON support (<c>EnableDynamicJson</c>, set in
/// <c>AddLeashCore</c>).
/// </summary>
public class AvailabilityDayEntity
{
    public string Id { get; set; } = "";
    public string CaretakerId { get; set; } = "";

    /// <summary>
    /// A calendar day, not an instant — the column is <c>date</c>. A caretaker
    /// free on the 10th is free on the 10th wherever the server happens to run.
    /// </summary>
    public DateOnly Date { get; set; }

    public SlotDto[] Slots { get; set; } = [];

    public AvailabilityDayDto ToDto() => new(Date, Slots);
}
