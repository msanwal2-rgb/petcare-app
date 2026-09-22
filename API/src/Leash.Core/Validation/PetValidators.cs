using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

/// <summary>
/// Messages are written for the person filling in the form, not for the
/// developer reading a log.
/// </summary>
public sealed class VetContactValidator : AbstractValidator<VetContactDto>
{
    public VetContactValidator()
    {
        RuleFor(v => v.Name).NotEmpty().WithMessage("Your vet's name is required")
            .MaximumLength(120);
        RuleFor(v => v.Phone).NotEmpty().WithMessage("Your vet's phone number is required")
            .MaximumLength(40);
    }
}

public sealed class PetInputValidator : AbstractValidator<PetInputRequest>
{
    public PetInputValidator()
    {
        RuleFor(p => p.Name).NotEmpty().WithMessage("Give your pet a name")
            .MaximumLength(80);

        RuleFor(p => p.Species)
            .Must(Species.IsValid)
            .WithMessage($"Species must be one of: {string.Join(", ", Species.All)}");

        RuleFor(p => p.Sex)
            .Must(PetSex.IsValid)
            .WithMessage($"Sex must be one of: {string.Join(", ", PetSex.All)}");

        RuleFor(p => p.Breed).NotNull().MaximumLength(120);
        RuleFor(p => p.PhotoUrl).NotNull().MaximumLength(2048);
        RuleFor(p => p.BehaviorNotes).NotNull().MaximumLength(4000);
        RuleFor(p => p.FeedingInstructions).NotNull().MaximumLength(4000);

        // A pet born tomorrow is a typo, and a pet born in 1900 is a different
        // typo. Both are worth catching at the boundary rather than showing a
        // life stage of "senior" for a puppy.
        RuleFor(p => p.Dob)
            .Must(BeAPlausibleBirthday)
            .WithMessage("Date of birth must be in the past, and within the last 50 years");

        RuleFor(p => p.WeightLbs).InclusiveBetween(0, 400)
            .WithMessage("Weight must be between 0 and 400 lb");

        RuleFor(p => p.Allergies).NotNull();
        RuleFor(p => p.Medications).NotNull();
        RuleForEach(p => p.Allergies).NotEmpty().MaximumLength(120)
            .WithMessage("An allergy cannot be blank");
        RuleForEach(p => p.Medications).NotEmpty().MaximumLength(200);

        RuleFor(p => p.VetContact).NotNull().SetValidator(new VetContactValidator()!);
    }

    internal static bool BeAPlausibleBirthday(DateOnly dob)
    {
        var today = DateOnly.FromDateTime(Persistence.Ids.Now().UtcDateTime);
        return dob <= today && dob >= today.AddYears(-50);
    }
}

/// <summary>
/// The patch. Every rule is conditional on the property having been sent, so
/// <c>{ "weightLbs": 70 }</c> is not failed for the twelve fields it omits.
///
/// There is no <c>ownerId</c> rule here because there is no <c>ownerId</c>
/// property — the transfer backdoor is closed by the type, not by a check. A
/// client still sending one gets a 400 from the strict-binding rule below rather
/// than having it silently ignored, which is the version that lets a stale
/// client go on believing it works.
/// </summary>
public sealed class PetPatchValidator : AbstractValidator<PetPatchRequest>
{
    public PetPatchValidator()
    {
        RuleFor(p => p.Name!).NotEmpty().MaximumLength(80)
            .WithMessage("Give your pet a name")
            .When(p => p.Name is not null);

        RuleFor(p => p.Species!)
            .Must(Species.IsValid)
            .WithMessage($"Species must be one of: {string.Join(", ", Species.All)}")
            .When(p => p.Species is not null);

        RuleFor(p => p.Sex!)
            .Must(PetSex.IsValid)
            .WithMessage($"Sex must be one of: {string.Join(", ", PetSex.All)}")
            .When(p => p.Sex is not null);

        RuleFor(p => p.Breed!).MaximumLength(120).When(p => p.Breed is not null);
        RuleFor(p => p.PhotoUrl!).MaximumLength(2048).When(p => p.PhotoUrl is not null);
        RuleFor(p => p.BehaviorNotes!).MaximumLength(4000).When(p => p.BehaviorNotes is not null);
        RuleFor(p => p.FeedingInstructions!).MaximumLength(4000)
            .When(p => p.FeedingInstructions is not null);

        RuleFor(p => p.Dob!.Value)
            .Must(PetInputValidator.BeAPlausibleBirthday)
            .WithMessage("Date of birth must be in the past, and within the last 50 years")
            .When(p => p.Dob is not null);

        RuleFor(p => p.WeightLbs!.Value).InclusiveBetween(0, 400)
            .WithMessage("Weight must be between 0 and 400 lb")
            .When(p => p.WeightLbs is not null);

        RuleForEach(p => p.Allergies!).NotEmpty().MaximumLength(120)
            .WithMessage("An allergy cannot be blank")
            .When(p => p.Allergies is not null);

        RuleForEach(p => p.Medications!).NotEmpty().MaximumLength(200)
            .When(p => p.Medications is not null);

        RuleFor(p => p.VetContact!).SetValidator(new VetContactValidator())
            .When(p => p.VetContact is not null);
    }
}

/// <summary>
/// A health record.
///
/// Note what is <b>not</b> validated: the author and the vet profile. They are
/// not on the request at all — the server stamps both from the authenticated
/// caller and from the access check that granted the write. See
/// <see cref="Services.MedicalRecordService"/>.
/// </summary>
public sealed class MedicalRecordValidator : AbstractValidator<MedicalRecordRequest>
{
    public MedicalRecordValidator()
    {
        RuleFor(r => r.Type)
            .Must(MedicalRecordTypes.IsValid)
            .WithMessage($"Type must be one of: {string.Join(", ", MedicalRecordTypes.All)}");

        RuleFor(r => r.Title).NotEmpty().WithMessage("Give this entry a title")
            .MaximumLength(200);

        RuleFor(r => r.Details!).MaximumLength(8000).When(r => r.Details is not null);
        RuleFor(r => r.MedicationName!).MaximumLength(200).When(r => r.MedicationName is not null);
        RuleFor(r => r.Dosage!).MaximumLength(400).When(r => r.Dosage is not null);

        RuleFor(r => r.RefillsLeft!.Value)
            .GreaterThanOrEqualTo(0).WithMessage("Refills cannot be negative")
            .When(r => r.RefillsLeft is not null);

        RuleForEach(r => r.ProductSlugs!).NotEmpty().MaximumLength(200)
            .When(r => r.ProductSlugs is not null);

        // A prescription that expires before it was written authorises nothing
        // and is almost certainly a mistyped year. Only checked for
        // prescriptions: a vaccination's nextDueAt is legitimately years out and
        // an expiry is meaningless on a weight entry.
        RuleFor(r => r)
            .Must(r => r.ExpiresAt is null || r.ExpiresAt > r.OccurredAt)
            .WithName("expiresAt")
            .WithMessage("A prescription cannot expire before it was written")
            .When(r => r.Type == MedicalRecordTypes.Prescription);
    }
}
