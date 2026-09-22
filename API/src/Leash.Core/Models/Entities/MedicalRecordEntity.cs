using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>medical_records</c> row.
///
/// <see cref="AuthorUserId"/> is who wrote it and <see cref="VetId"/> is the vet
/// profile they wrote it as — null when an owner recorded a weight or an
/// allergy themselves. Both are stamped by the server; neither is accepted from
/// a request body.
/// </summary>
public class MedicalRecordEntity
{
    public string Id { get; set; } = "";
    public string PetId { get; set; } = "";
    public string? AppointmentId { get; set; }
    public string? VetId { get; set; }
    public string AuthorUserId { get; set; } = "";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Details { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
    public DateTimeOffset? NextDueAt { get; set; }
    public string? MedicationName { get; set; }
    public string? Dosage { get; set; }

    /// <summary>
    /// Purchases this prescription still authorises, or null when the vet set no
    /// limit. <b>Zero means exhausted</b> and stops authorising products — see
    /// <see cref="Repositories.MedicalRecordRepository"/> for the one place that
    /// rule is expressed.
    /// </summary>
    public int? RefillsLeft { get; set; }

    public DateTimeOffset? ExpiresAt { get; set; }
    public string[] ProductSlugs { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }

    public MedicalRecordDto ToDto() => new(
        Id, PetId, AppointmentId, VetId, AuthorUserId, Type, Title, Details,
        OccurredAt, NextDueAt, MedicationName, Dosage, RefillsLeft, ExpiresAt,
        ProductSlugs, CreatedAt);
}
