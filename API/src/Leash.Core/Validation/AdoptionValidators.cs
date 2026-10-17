using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

// The adoption module's inputs, with the reference's Zod bounds. What is not
// here is the point, as elsewhere: no applicantId, no shelterId, no
// verificationStatus, no responseRatePct and no listing status on a patch —
// each is the caller, staff, derived, or its own endpoint.

public sealed class ShelterPatchValidator : AbstractValidator<ShelterPatchRequest>
{
    public ShelterPatchValidator()
    {
        RuleFor(s => s.Name!).Must(n => n.Trim().Length is >= 1 and <= 120)
            .When(s => s.Name is not null).WithMessage("Give the shelter a name of up to 120 characters");
        RuleFor(s => s.Bio!).MaximumLength(4000).When(s => s.Bio is not null);
        RuleFor(s => s.Kind!).Must(ShelterKinds.IsValid).When(s => s.Kind is not null)
            .WithMessage($"Kind must be one of: {string.Join(", ", ShelterKinds.All)}");
        RuleFor(s => s.RegistrationNumber!).MaximumLength(60).When(s => s.RegistrationNumber is not null);
        RuleFor(s => s.RegistrationState!).MaximumLength(60).When(s => s.RegistrationState is not null);
        RuleFor(s => s.AcceptedSpecies!).Must(a => a.All(Species.IsValid)).When(s => s.AcceptedSpecies is not null)
            .WithMessage($"Species must be from: {string.Join(", ", Species.All)}");
        RuleFor(s => s.WebsiteUrl!).MaximumLength(300).When(s => s.WebsiteUrl is not null);
        RuleFor(s => s.Phone!).MaximumLength(40).When(s => s.Phone is not null);
        RuleFor(s => s.Email!).MaximumLength(200).When(s => s.Email is not null);
        RuleFor(s => s.Address!).ChildRules(a =>
        {
            a.RuleFor(x => x.Line).NotNull().MaximumLength(200);
            a.RuleFor(x => x.City).NotNull().MaximumLength(100);
            a.RuleFor(x => x.State).NotNull().MaximumLength(100);
        }).When(s => s.Address is not null);
        RuleFor(s => s.AdoptionPolicy!).MaximumLength(4000).When(s => s.AdoptionPolicy is not null);
    }
}

/// <summary>The listing fields a create and an edit share.</summary>
internal static class ListingRules
{
    public static void Apply<T>(
        AbstractValidator<T> v,
        Func<T, int?> fee, Func<T, string?> headline, Func<T, string?> story,
        Func<T, string?> kids, Func<T, string?> dogs, Func<T, string?> cats, Func<T, string?> trained,
        Func<T, string?> energy, Func<T, string?> notes, Func<T, string?> city, Func<T, string?> state)
    {
        v.RuleFor(x => fee(x)!.Value).InclusiveBetween(0, 1_000_000).When(x => fee(x) is not null)
            .OverridePropertyName("feeCents").WithMessage("The fee must be between $0 and $10,000");
        v.RuleFor(x => headline(x)!).MaximumLength(200).When(x => headline(x) is not null)
            .OverridePropertyName("headline");
        v.RuleFor(x => story(x)!).MaximumLength(8000).When(x => story(x) is not null)
            .OverridePropertyName("story");

        foreach (var (name, get) in new[] { ("goodWithKids", kids), ("goodWithDogs", dogs),
                                            ("goodWithCats", cats), ("houseTrained", trained) })
        {
            v.RuleFor(x => get(x)!).Must(TriStates.IsValid).When(x => get(x) is not null)
                .OverridePropertyName(name).WithMessage($"{name} must be yes, no or unknown");
        }

        v.RuleFor(x => energy(x)!).Must(EnergyLevels.IsValid).When(x => energy(x) is not null)
            .OverridePropertyName("energyLevel").WithMessage("Energy must be low, moderate or high");
        v.RuleFor(x => notes(x)!).MaximumLength(2000).When(x => notes(x) is not null)
            .OverridePropertyName("specialNeedsNotes");
        v.RuleFor(x => city(x)!).NotEmpty().When(x => city(x) is not null).OverridePropertyName("city");
        v.RuleFor(x => state(x)!).NotEmpty().When(x => state(x) is not null).OverridePropertyName("state");
    }
}

public sealed class CreateListingValidator : AbstractValidator<CreateListingRequest>
{
    public CreateListingValidator()
    {
        RuleFor(l => l.PetId).NotEmpty().WithMessage("Choose the animal to list");
        ListingRules.Apply(this, l => l.FeeCents, l => l.Headline, l => l.Story, l => l.GoodWithKids,
            l => l.GoodWithDogs, l => l.GoodWithCats, l => l.HouseTrained, l => l.EnergyLevel,
            l => l.SpecialNeedsNotes, l => l.City, l => l.State);
    }
}

public sealed class UpdateListingValidator : AbstractValidator<UpdateListingRequest>
{
    public UpdateListingValidator()
    {
        ListingRules.Apply(this, l => l.FeeCents, l => l.Headline, l => l.Story, l => l.GoodWithKids,
            l => l.GoodWithDogs, l => l.GoodWithCats, l => l.HouseTrained, l => l.EnergyLevel,
            l => l.SpecialNeedsNotes, l => l.City, l => l.State);
    }
}

public sealed class ListingStatusValidator : AbstractValidator<ListingStatusRequest>
{
    public ListingStatusValidator()
    {
        RuleFor(s => s.Status).Must(ListingStatuses.IsValid)
            .WithMessage($"Status must be one of: {string.Join(", ", ListingStatuses.All)}");
    }
}

public sealed class CreateApplicationValidator : AbstractValidator<CreateApplicationRequest>
{
    public CreateApplicationValidator()
    {
        RuleFor(a => a.ListingId).NotEmpty().WithMessage("Say which animal you are applying for");
        RuleFor(a => a.HouseholdAdults).InclusiveBetween(1, 20).WithMessage("Between 1 and 20 adults");
        RuleFor(a => a.HouseholdChildren).InclusiveBetween(0, 20).WithMessage("Between 0 and 20 children");
        RuleFor(a => a.HomeType).Must(t => t is not null && HomeTypes.IsValid(t))
            .WithMessage($"Home must be one of: {string.Join(", ", HomeTypes.All)}");
        RuleFor(a => a.HoursAlonePerDay).InclusiveBetween(0, 24).WithMessage("Between 0 and 24 hours");
        RuleFor(a => a.OtherPetsNotes!).MaximumLength(2000).When(a => a.OtherPetsNotes is not null);
        RuleFor(a => a.Experience!).MaximumLength(4000).When(a => a.Experience is not null);
        RuleFor(a => a.Message!).MaximumLength(4000).When(a => a.Message is not null);
    }
}

/// <summary><c>completed</c> is absent: it is reached by completing the adoption, not by a status write.</summary>
public sealed class ApplicationStatusValidator : AbstractValidator<ApplicationStatusRequest>
{
    public ApplicationStatusValidator()
    {
        RuleFor(s => s.Status).Must(ApplicationStatuses.Writable.Contains)
            .WithMessage($"Status must be one of: {string.Join(", ", ApplicationStatuses.Writable)}");
        RuleFor(s => s.Note!).MaximumLength(1000).When(s => s.Note is not null);
    }
}

public sealed class ReverseAdoptionValidator : AbstractValidator<ReverseAdoptionRequest>
{
    public ReverseAdoptionValidator()
    {
        RuleFor(r => r.Reason).Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("Say why the animal is going back")
            .Must(r => r.Trim().Length is >= 3 and <= 500).WithMessage("Give a reason of 3 to 500 characters");
    }
}
