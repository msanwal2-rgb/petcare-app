namespace Leash.Core.Models.Dtos;

/// <summary>
/// One entry in a pet's health timeline.
///
/// The prescription fields (<see cref="MedicationName"/>,
/// <see cref="Dosage"/>, <see cref="RefillsLeft"/>, <see cref="ExpiresAt"/>,
/// <see cref="ProductSlugs"/>) are null on every other entry type. They are on
/// the one record type rather than in a side table because a prescription
/// <i>is</i> a clinical finding — it belongs in the timeline in date order, and
/// splitting it would mean two reads to render one list.
/// </summary>
public sealed record MedicalRecordDto(
    string Id,
    string PetId,
    string? AppointmentId,
    string? VetId,
    string AuthorUserId,
    string Type,
    string Title,
    string Details,
    DateTimeOffset OccurredAt,
    DateTimeOffset? NextDueAt,
    string? MedicationName,
    string? Dosage,
    int? RefillsLeft,
    DateTimeOffset? ExpiresAt,
    string[] ProductSlugs,
    DateTimeOffset CreatedAt);

/// <summary>
/// A new health record.
///
/// <b>No <c>authorUserId</c> and no <c>vetId</c>.</b> Both are stamped by the
/// server from the authenticated caller and from the vet profile that
/// <see cref="Services.Interfaces.IAccessService.CanAccessPetRecordsAsync"/>
/// returned when it granted access. A client that could name its own author
/// could write a prescription as somebody else's vet.
/// </summary>
public sealed record MedicalRecordRequest(
    string Type,
    string Title,
    string? Details,
    DateTimeOffset OccurredAt,
    string? AppointmentId,
    DateTimeOffset? NextDueAt,
    string? MedicationName,
    string? Dosage,
    int? RefillsLeft,
    DateTimeOffset? ExpiresAt,
    string[]? ProductSlugs);
