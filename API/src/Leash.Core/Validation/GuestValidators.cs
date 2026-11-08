using System.Text.RegularExpressions;
using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;

namespace Leash.Core.Validation;

/// <summary>
/// Booking as a guest (STATUS §3-G). The pet rules are the add-pet form's; the
/// booking and visit rules are the signed-in requests'. The child validators
/// name their fields from the root (<c>guest.email</c>, <c>pet.dob</c>), which
/// is what the form puts the message next to.
/// </summary>
public sealed partial class GuestContactValidator : AbstractValidator<GuestContactRequest>
{
    [GeneratedRegex(@"^[0-9+()\-. ]{7,20}$")]
    private static partial Regex PhoneShape();

    public GuestContactValidator()
    {
        RuleFor(g => g.Name)
            .NotEmpty().WithMessage("What should we call you?")
            .MaximumLength(100);

        RuleFor(g => g.Email)
            .NotEmpty().WithMessage("Enter a valid email.")
            .MaximumLength(254)
            .EmailAddress().WithMessage("Enter a valid email.");

        // Required: a guest cannot read messages, so a phone number is how the
        // caretaker or clinic reaches them.
        RuleFor(g => g.Phone)
            .Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Add a phone number so they can reach you.")
            .Must(p => PhoneShape().IsMatch(p.Trim()))
            .WithMessage("Enter a phone number — digits, spaces and + ( ) - only.");
    }
}

public sealed class GuestPetValidator : AbstractValidator<GuestPetRequest>
{
    public GuestPetValidator()
    {
        RuleFor(p => p.Name).NotEmpty().WithMessage("Give your pet a name").MaximumLength(80);

        RuleFor(p => p.Species)
            .Must(Species.IsValid)
            .WithMessage($"Species must be one of: {string.Join(", ", Species.All)}");

        RuleFor(p => p.Sex)
            .Must(PetSex.IsValid)
            .WithMessage($"Sex must be one of: {string.Join(", ", PetSex.All)}");

        RuleFor(p => p.Breed).NotNull().MaximumLength(120);

        RuleFor(p => p.Dob)
            .Must(PetInputValidator.BeAPlausibleBirthday)
            .WithMessage("Date of birth must be in the past, and within the last 50 years");

        RuleFor(p => p.WeightLbs).InclusiveBetween(0, 400)
            .WithMessage("Weight must be between 0 and 400 lb");

        RuleFor(p => p.Allergies!)
            .Must(a => a.Length <= 20).WithMessage("List at most 20 allergies")
            .When(p => p.Allergies is not null);
        RuleForEach(p => p.Allergies!).NotEmpty().MaximumLength(120)
            .WithMessage("An allergy cannot be blank")
            .When(p => p.Allergies is not null);

        RuleFor(p => p.BehaviorNotes!).MaximumLength(4000).When(p => p.BehaviorNotes is not null);
    }
}

public sealed class GuestBookingDetailsValidator : AbstractValidator<GuestBookingDetails>
{
    public GuestBookingDetailsValidator()
    {
        RuleFor(b => b.CaretakerId).NotEmpty().WithMessage("Choose a caretaker");

        RuleFor(b => b.ServiceType)
            .Must(ServiceTypes.IsValid)
            .WithMessage($"Service must be one of: {string.Join(", ", ServiceTypes.All)}");

        RuleFor(b => b.EndDateTime)
            .GreaterThan(b => b.StartDateTime)
            .WithMessage("The end time must be after the start time");

        RuleFor(b => b.Notes!).MaximumLength(2000).When(b => b.Notes is not null);

        RuleFor(b => b.UtcOffsetMinutes!.Value)
            .InclusiveBetween(-PublishedHours.MaxOffsetMinutes, PublishedHours.MaxOffsetMinutes)
            .WithMessage("That time zone offset isn't a real one")
            .OverridePropertyName("UtcOffsetMinutes")
            .When(b => b.UtcOffsetMinutes is not null);
    }
}

public sealed class GuestAppointmentDetailsValidator : AbstractValidator<GuestAppointmentDetails>
{
    public GuestAppointmentDetailsValidator()
    {
        RuleFor(a => a.VetId).NotEmpty().WithMessage("Choose a vet");

        RuleFor(a => a.Mode)
            .Must(ConsultModes.IsValid)
            .WithMessage($"Consult mode must be one of: {string.Join(", ", ConsultModes.All)}");

        RuleFor(a => a.Reason)
            .NotEmpty().WithMessage("Say what the visit is for")
            .MaximumLength(500);

        RuleFor(a => a.Symptoms!)
            .Must(s => s.Length <= 20).WithMessage("List at most 20 symptoms")
            .When(a => a.Symptoms is not null);
        RuleForEach(a => a.Symptoms!).NotEmpty().MaximumLength(120)
            .When(a => a.Symptoms is not null);

        RuleFor(a => a.EndDateTime)
            .GreaterThan(a => a.StartDateTime)
            .WithMessage("The end time must be after the start time");

        RuleFor(a => a.Notes!).MaximumLength(2000).When(a => a.Notes is not null);

        RuleFor(a => a.UtcOffsetMinutes!.Value)
            .InclusiveBetween(-PublishedHours.MaxOffsetMinutes, PublishedHours.MaxOffsetMinutes)
            .WithMessage("That time zone offset isn't a real one")
            .OverridePropertyName("UtcOffsetMinutes")
            .When(a => a.UtcOffsetMinutes is not null);
    }
}

public sealed class GuestBookingRequestValidator : AbstractValidator<GuestBookingRequest>
{
    public GuestBookingRequestValidator()
    {
        RuleFor(r => r.Guest).NotNull().SetValidator(new GuestContactValidator());
        RuleFor(r => r.Pet).NotNull().SetValidator(new GuestPetValidator());
        RuleFor(r => r.Booking).NotNull().SetValidator(new GuestBookingDetailsValidator());
    }
}

public sealed class GuestAppointmentRequestValidator : AbstractValidator<GuestAppointmentRequest>
{
    public GuestAppointmentRequestValidator()
    {
        RuleFor(r => r.Guest).NotNull().SetValidator(new GuestContactValidator());
        RuleFor(r => r.Pet).NotNull().SetValidator(new GuestPetValidator());
        RuleFor(r => r.Appointment).NotNull().SetValidator(new GuestAppointmentDetailsValidator());
    }
}

public sealed class SetPasswordRequestValidator : AbstractValidator<SetPasswordRequest>
{
    public SetPasswordRequestValidator()
    {
        RuleFor(r => r.Token).NotEmpty();
        RuleFor(r => r.Password)
            .MinimumLength(8).WithMessage("Use at least 8 characters.");
    }
}
