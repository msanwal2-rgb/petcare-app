using System.Text.Json.Serialization;

namespace Leash.Core.Models.Dtos;

/// <summary>
/// Where the practice is. Flat columns on the table because Prisma emitted them
/// that way; nested here because that is the shape
/// <c>web/src/types/index.ts</c> already declares.
///
/// <see cref="Phone"/> is the <b>practice's</b> public line, which the profile's
/// emergency panel shows (db/changes/003). Never the vet's own
/// <c>users.phone</c> — that stays in the private projection. Always present
/// on the way out (empty when unset); on a patch, omitting it leaves the stored
/// number alone.
/// </summary>
public sealed record ClinicDto(
    string Name, string City, string State, double Lat, double Lng, string? Phone = null);

/// <summary>
/// A vet's profile.
///
/// <see cref="Rating"/>, <see cref="ReviewCount"/> and
/// <see cref="ResponseRatePct"/> are <b>derived</b>, and
/// <see cref="VerificationStatus"/> is set by staff (REQUIREMENTS.md V11). None
/// of the four appears on <see cref="VetPatchRequest"/>, which is how a vet is
/// stopped from awarding themselves a reputation or a verified licence — there
/// is nowhere to put one, rather than a check that could be forgotten.
///
/// <see cref="ConsultFee"/> is USD, matching <c>Booking.priceTotal</c> and
/// <c>VetAppointment.fee</c>; the column is integer cents.
/// </summary>
public sealed record VetProfileDto(
    string Id,
    string UserId,
    string ClinicName,
    string Bio,
    string[] Specialties,
    string LicenseNumber,
    string LicenseState,
    string VerificationStatus,
    int YearsExperience,
    string[] AcceptedSpecies,
    string[] ConsultModes,
    decimal ConsultFee,
    bool EmergencyAvailable,
    ClinicDto Clinic,
    double Rating,
    int ReviewCount,
    int ResponseRatePct,
    AvailabilityDayDto[] Availability);

/// <summary>
/// A vet joined to the person behind it — what a search result and a profile
/// page render.
///
/// Shaped like <see cref="CaretakerWithUserDto"/> on purpose, and the nested
/// user is the <b>public</b> projection for the same reason: a search result
/// carrying an email address and home coordinates is the mistake M1 fixed on
/// <c>GET /users/{id}</c>.
/// </summary>
public sealed record VetWithUserDto(
    VetProfileDto Profile,
    PublicUserDto User,
    /// <summary>Straight-line miles to the <b>clinic</b> — the address somebody
    /// actually has to drive to — when the search gave an origin.</summary>
    double? DistanceMiles);

/// <summary>A page of search results plus the opaque cursor for the next one.</summary>
public sealed record VetSearchPage(VetWithUserDto[] Items, string? NextCursor);

/// <summary>
/// An edit to one's own vet profile.
///
/// No <c>rating</c>, no <c>reviewCount</c>, no <c>responseRatePct</c>, no
/// <c>verificationStatus</c> and no <c>userId</c>. <see cref="Availability"/> is
/// <b>replace-whole</b> when present: sending it swaps the entire calendar, and
/// omitting it leaves it untouched.
/// </summary>
public sealed record VetPatchRequest(
    string? Bio,
    string[]? Specialties,
    string? LicenseNumber,
    string? LicenseState,
    int? YearsExperience,
    string[]? AcceptedSpecies,
    string[]? ConsultModes,
    decimal? ConsultFee,
    bool? EmergencyAvailable,
    ClinicDto? Clinic,
    AvailabilityDayDto[]? Availability);

/// <summary>
/// A visit, as the appointment resource and as an entry on a pet's timeline.
///
/// <b>One record, two wire shapes.</b> A participant sees what the visit cost;
/// somebody reading a pet's history who did not book it — a treating vet, a
/// caretaker, an adopter reading the history their animal arrived with — gets
/// the same record with <see cref="Fee"/> <b>absent from the JSON entirely</b>,
/// not null. The clinical content is the point; the fee belonged to whoever
/// paid it, and a shelter's discounted invoice is not the adopter's business.
///
/// The reference implementation modelled this as two TypeScript types
/// (<c>VetAppointment</c> and <c>ClinicalAppointment = Omit&lt;…, "fee"&gt;</c>).
/// One record with a conditionally-written property produces the same two wire
/// shapes without a second mapping that could drift — which is why M5 extended
/// this rather than adding an appointment DTO beside it.
///
/// <b>What is deliberately not here:</b> <c>baseFee</c>, <c>discountPct</c> and
/// <c>priority</c>. All three are recorded on the row (REQUIREMENTS.md V4) and
/// none is on the wire, because the contract in <c>web/src/types/index.ts</c>
/// has one money field and nothing renders the other two yet. M7 brings the
/// membership screens that want "you saved $14" and can widen this then — the
/// columns are already written, so it is a DTO change and not a data migration.
/// </summary>
public sealed record AppointmentTimelineDto(
    string Id,
    string OwnerId,
    string VetId,
    string PetId,
    string Mode,
    string Reason,
    string[] Symptoms,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string Status,
    string Notes,
    DateTimeOffset CreatedAt)
{
    /// <summary>
    /// USD, and only for those entitled to it. <c>WhenWritingNull</c> is what
    /// turns this into the "clinical" shape for everybody else.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public decimal? Fee { get; init; }
}

/// <summary>
/// A request for an appointment.
///
/// <b>No fee and no owner.</b> The owner comes from the authenticated caller;
/// the fee is computed server-side from the vet's own <c>consultFee</c> and the
/// caller's membership discount (REQUIREMENTS.md V4/V5). The reference
/// implementation's <c>CreateAppointmentInput</c> carried a <c>fee</c> field —
/// that identity selects a price, so a route that forgot to re-derive it would
/// be handing out members' discounts to anyone who asked.
/// </summary>
public sealed record CreateAppointmentRequest(
    string VetId,
    string PetId,
    string Mode,
    string Reason,
    string[]? Symptoms,
    DateTimeOffset StartDateTime,
    DateTimeOffset EndDateTime,
    string? Notes);

/// <summary>A status move. The actor is derived from the caller, never sent.</summary>
public sealed record UpdateAppointmentStatusRequest(string Status);

/// <summary>A page of appointments plus the cursor for the next one.</summary>
public sealed record AppointmentPage(AppointmentTimelineDto[] Items, string? NextCursor);

/// <summary>
/// A visit summary: the clinical output of an appointment, written as the vet
/// completes it (REQUIREMENTS.md V7).
///
/// One or more records against the pet, in one transaction with the status
/// move, so a visit never ends up <c>completed</c> with half its notes written.
/// Each entry is a <see cref="MedicalRecordRequest"/> minus the two fields the
/// appointment already answers: the <c>appointmentId</c> is this appointment,
/// and <c>occurredAt</c> defaults to when the visit ended.
/// </summary>
public sealed record VisitSummaryRequest(MedicalRecordRequest[] Records);

/// <summary>
/// What a completed visit produced: the appointment in its new state, and the
/// records it wrote.
///
/// Both, rather than just the appointment, because the screen that submits the
/// form is the one that then shows the owner their pet's updated timeline — and
/// the prescription it may contain is the thing M6's store reads.
/// </summary>
public sealed record VisitSummaryResult(
    AppointmentTimelineDto Appointment,
    MedicalRecordDto[] Records);
