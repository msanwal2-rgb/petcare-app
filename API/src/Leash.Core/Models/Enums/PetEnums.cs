namespace Leash.Core.Models.Enums;

/// <summary>
/// The animals this marketplace handles. Stored as <c>text</c>, validated at the
/// boundary — REQUIREMENTS.md section 2.4, same reasoning as <see cref="UserRoles"/>.
///
/// <b>Three values, not more.</b> <c>web/src/types/index.ts</c> declares
/// <c>Species = "dog" | "cat" | "other"</c>, and the same three constrain a
/// product's <c>species</c>, a caretaker's <c>acceptedSpecies</c> and a vet's.
/// Accepting a fourth here would let the API store a value the client's type
/// system says cannot exist — <c>SPECIES_LABELS[pet.species]</c> renders
/// <c>undefined</c> and nothing fails loudly.
///
/// Widening this is a contract change: add it here, in <c>types/index.ts</c>,
/// and in every label map keyed on it, in one commit.
/// </summary>
public static class Species
{
    public const string Dog = "dog";
    public const string Cat = "cat";
    public const string Other = "other";

    public static readonly string[] All = [Dog, Cat, Other];

    public static bool IsValid(string value) => All.Contains(value);
}

public static class PetSex
{
    public const string Male = "male";
    public const string Female = "female";

    public static readonly string[] All = [Male, Female];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// The catalogue's life-stage buckets. <c>All</c> on a product means it suits
/// every stage, so it matches whatever a pet maps to — see
/// <see cref="Services.CatalogService.LifeStageFor"/>.
/// </summary>
public static class LifeStages
{
    public const string Puppy = "puppy";
    public const string Kitten = "kitten";
    public const string Adult = "adult";
    public const string Senior = "senior";

    /// <summary>Not a stage. A product tagged this suits every stage.</summary>
    public const string All = "all";
}

/// <summary>
/// The six kinds of entry in a pet's health timeline (REQUIREMENTS.md P3).
///
/// The split that matters is <see cref="OwnerAuthorable"/>: two of these are
/// things an owner observes about their own animal, and four are clinical
/// findings. Only a treating vet may write the clinical four, because a
/// <c>prescription</c> is what unlocks Rx-only products in the store — a
/// prescription written by the patient's owner would defeat the entire gate.
/// </summary>
public static class MedicalRecordTypes
{
    public const string VisitNote = "visit_note";
    public const string Vaccination = "vaccination";
    public const string Prescription = "prescription";
    public const string LabResult = "lab_result";
    public const string Weight = "weight";
    public const string Allergy = "allergy";

    public static readonly string[] All =
        [VisitNote, Vaccination, Prescription, LabResult, Weight, Allergy];

    /// <summary>
    /// The entry types an owner may author on their own pet: what they can see
    /// for themselves. Everything else is a clinical finding and needs a vet.
    /// </summary>
    public static readonly string[] OwnerAuthorable = [Allergy, Weight];

    public static bool IsValid(string value) => All.Contains(value);

    /// <summary>
    /// May a pet's owner write this kind of entry about their own animal?
    /// A named predicate because the API refuses on it and the message it
    /// returns names the two they *can* add.
    /// </summary>
    public static bool OwnerMayAuthor(string type) => OwnerAuthorable.Contains(type);
}
