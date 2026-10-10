using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>vet_profiles</c> row.
///
/// Deliberately the same shape as <see cref="CaretakerProfileEntity"/>: both are
/// a user-linked professional profile with a calendar, a derived reputation and
/// a search. The three reputation columns are here because they are columns and
/// absent from the patch DTO because they are derived —
/// <see cref="Services.ReputationService"/> is their only writer.
///
/// <see cref="VerificationStatus"/> is the one field a vet may not set about
/// themselves at all (REQUIREMENTS.md V11): a licence badge the holder can
/// grant themselves is not a badge. Staff set it in M9; until then it is
/// whatever the seed says, and a new profile starts at <c>none</c>.
/// </summary>
public class VetProfileEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ClinicName { get; set; } = "";
    public string Bio { get; set; } = "";
    public string[] Specialties { get; set; } = [];
    public string LicenseNumber { get; set; } = "";
    public string LicenseState { get; set; } = "";
    public string VerificationStatus { get; set; } = "";
    public int YearsExperience { get; set; }
    public string[] AcceptedSpecies { get; set; } = [];
    public string[] ConsultModes { get; set; } = [];

    /// <summary>Integer cents. The DTO divides by 100 exactly once, below.</summary>
    public int ConsultFeeCents { get; set; }

    public bool EmergencyAvailable { get; set; }
    public string ClinicCity { get; set; } = "";
    public string ClinicState { get; set; } = "";

    /// <summary>The practice's public line. Empty until the vet sets one.</summary>
    public string ClinicPhone { get; set; } = "";

    public double Lat { get; set; }
    public double Lng { get; set; }
    public double Rating { get; set; }
    public int ReviewCount { get; set; }
    public int ResponseRatePct { get; set; }

    public VetProfileDto ToDto(IReadOnlyList<VetAvailabilityDayEntity> availability) => new(
        Id, UserId, ClinicName, Bio, Specialties, LicenseNumber, LicenseState,
        VerificationStatus, YearsExperience, AcceptedSpecies, ConsultModes,
        ConsultFeeCents / 100m, EmergencyAvailable,
        new ClinicDto(ClinicName, ClinicCity, ClinicState, Lat, Lng, ClinicPhone),
        Rating, ReviewCount, ResponseRatePct,
        [.. availability.Select(a => a.ToDto())]);
}

/// <summary>
/// One day of a vet's calendar. Its own table and its own row type rather than
/// a shared one with <see cref="AvailabilityDayEntity"/>, because the foreign
/// key differs (<c>"vetId"</c> against <c>"caretakerId"</c>) and Dapper binds by
/// column name.
/// </summary>
public class VetAvailabilityDayEntity
{
    public string Id { get; set; } = "";
    public string VetId { get; set; } = "";

    /// <summary>A calendar day, not an instant — the column is <c>date</c>.</summary>
    public DateOnly Date { get; set; }

    public SlotDto[] Slots { get; set; } = [];

    public AvailabilityDayDto ToDto() => new(Date, Slots);
}

/// <summary>
/// The <c>vet_appointments</c> row.
///
/// ── Three numbers, not one (REQUIREMENTS.md V4) ──
///
/// <see cref="BaseFeeCents"/> is what the vet lists, <see cref="DiscountPct"/>
/// is what was taken off, and <see cref="FeeCents"/> is what the customer was
/// actually quoted. All three are snapshotted at booking time, because a
/// membership that lapses next month must not rewrite what somebody was told
/// last week — and because "why was I charged this?" has no answer if only the
/// total survives.
///
/// <see cref="Priority"/> records whether the booking was made under the Leash
/// Plus lead time rather than the standard one. It is history, not an
/// entitlement: revoking a membership does not un-book the appointment it
/// allowed.
/// </summary>
public class VetAppointmentEntity
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";

    /// <summary>A <c>vet_profiles</c> id, <b>not</b> a user id.</summary>
    public string VetId { get; set; } = "";

    public string PetId { get; set; } = "";
    public string Mode { get; set; } = "";
    public string Reason { get; set; } = "";
    public string[] Symptoms { get; set; } = [];
    public DateTimeOffset StartDateTime { get; set; }
    public DateTimeOffset EndDateTime { get; set; }
    public string Status { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public int BaseFeeCents { get; set; }
    public int DiscountPct { get; set; }
    public bool Priority { get; set; }
    public int FeeCents { get; set; }

    /// <summary>
    /// The visit as one of its own two parties sees it — <b>with</b> the fee.
    ///
    /// Both sides are entitled to it: the owner pays it and the vet charges it.
    /// Callers reach this only after
    /// <see cref="Services.Interfaces.IAccessService.IsAppointmentParticipantAsync"/>
    /// has said so.
    /// </summary>
    public AppointmentTimelineDto ToDto() => Shape() with { Fee = FeeCents / 100m };

    /// <summary>
    /// The visit as <paramref name="viewerId"/> is entitled to see it on a
    /// <i>pet's timeline</i>: with the fee if they booked it, without it
    /// otherwise. The single division by 100 for this DTO lives here.
    /// </summary>
    public AppointmentTimelineDto ToDto(string viewerId)
        => Shape() with { Fee = OwnerId == viewerId ? FeeCents / 100m : null };

    private AppointmentTimelineDto Shape() => new(
        Id, OwnerId, VetId, PetId, Mode, Reason, Symptoms,
        StartDateTime, EndDateTime, Status, Notes, CreatedAt);
}
