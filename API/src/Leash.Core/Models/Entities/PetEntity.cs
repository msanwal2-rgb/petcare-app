using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>pets</c> row as the database holds it.
///
/// A mutable class with parameterless construction, because Dapper materialises
/// it — <c>text[]</c> and <c>timestamptz</c> both defeat constructor matching.
/// See Persistence/DapperSetup.cs.
///
/// <see cref="OwnedSince"/> is on the entity but <b>not</b> on
/// <see cref="PetDto"/>. It is an authorization input, read by
/// <see cref="Services.AccessService"/> and written only at creation and at an
/// adoption transfer. Nothing renders it, so nothing ships it.
///
/// <see cref="VetName"/> and <see cref="VetPhone"/> are flat here because the
/// columns are flat; the DTO nests them as <c>vetContact</c>, which is the shape
/// the client already expects.
/// </summary>
public class PetEntity
{
    public string Id { get; set; } = "";
    public string OwnerId { get; set; } = "";
    public DateTimeOffset OwnedSince { get; set; }
    public string Name { get; set; } = "";
    public string Species { get; set; } = "";
    public string Breed { get; set; } = "";
    public string Sex { get; set; } = "";

    /// <summary>
    /// A calendar date, not an instant. The column is <c>date</c>: a pet born on
    /// the 12th was born on the 12th in every timezone, and storing it as a
    /// timestamp is how a birthday moves a day when the server relocates.
    /// </summary>
    public DateOnly Dob { get; set; }

    public int WeightLbs { get; set; }
    public string PhotoUrl { get; set; } = "";
    public bool Vaccinated { get; set; }
    public string[] Allergies { get; set; } = [];
    public string[] Medications { get; set; } = [];
    public string BehaviorNotes { get; set; } = "";
    public string FeedingInstructions { get; set; } = "";
    public string VetName { get; set; } = "";
    public string VetPhone { get; set; } = "";

    public PetDto ToDto() => new(
        Id, OwnerId, Name, Species, Breed, Sex, Dob, WeightLbs, PhotoUrl,
        Vaccinated, Allergies, Medications, BehaviorNotes, FeedingInstructions,
        new VetContactDto(VetName, VetPhone));
}
