using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

/// <summary>
/// An appointment request.
///
/// What is <b>not</b> here is the point, as with a booking: no fee and no
/// owner. Both are server-side, so there is no field to validate and nothing to
/// tamper with. The dates are checked for shape here and for lead time in the
/// service, where the clock and the membership rule live; whether the clinic
/// treats this species or offers this mode is checked there too, because both
/// are facts about a row rather than about the request.
/// </summary>
public sealed class CreateAppointmentValidator : AbstractValidator<CreateAppointmentRequest>
{
    /// <summary>
    /// A sanity bound rather than a clinical one. A consultation with forty
    /// presenting signs is a form somebody is abusing, not a sick animal.
    /// </summary>
    private const int MaxSymptoms = 20;

    public CreateAppointmentValidator()
    {
        RuleFor(a => a.VetId).NotEmpty().WithMessage("Choose a vet");
        RuleFor(a => a.PetId).NotEmpty().WithMessage("Choose a pet");

        RuleFor(a => a.Mode)
            .Must(ConsultModes.IsValid)
            .WithMessage($"Consult mode must be one of: {string.Join(", ", ConsultModes.All)}");

        RuleFor(a => a.Reason)
            .NotEmpty().WithMessage("Say what the visit is for")
            .MaximumLength(500);

        RuleFor(a => a.Symptoms!)
            .Must(s => s.Length <= MaxSymptoms)
            .WithMessage($"List at most {MaxSymptoms} symptoms")
            .When(a => a.Symptoms is not null);

        RuleForEach(a => a.Symptoms!).NotEmpty().MaximumLength(120)
            .When(a => a.Symptoms is not null);

        RuleFor(a => a.EndDateTime)
            .GreaterThan(a => a.StartDateTime)
            .WithMessage("The end time must be after the start time");

        RuleFor(a => a.Notes!).MaximumLength(2000).When(a => a.Notes is not null);
    }
}

public sealed class UpdateAppointmentStatusValidator
    : AbstractValidator<UpdateAppointmentStatusRequest>
{
    public UpdateAppointmentStatusValidator()
    {
        // The §11.2 vocabulary, not §11.1's — "accepted" is not a status an
        // appointment has, and saying so here is more useful than letting it
        // reach the transition table and come back as a conflict.
        RuleFor(r => r.Status)
            .Must(AppointmentStatuses.IsValid)
            .WithMessage($"Status must be one of: {string.Join(", ", AppointmentStatuses.All)}");
    }
}

/// <summary>
/// An edit to one's own vet profile.
///
/// No rules for <c>rating</c>, <c>reviewCount</c>, <c>responseRatePct</c> or
/// <c>verificationStatus</c>, because the request type has no such properties.
/// The first three are derived and the fourth is staff's to set
/// (REQUIREMENTS.md V11) — a vet cannot award themselves a verified licence
/// because there is nowhere to put one.
/// </summary>
public sealed class VetPatchValidator : AbstractValidator<VetPatchRequest>
{
    public VetPatchValidator()
    {
        RuleFor(v => v.Bio!).MaximumLength(4000).When(v => v.Bio is not null);

        RuleForEach(v => v.Specialties!)
            .Must(VetSpecialties.IsValid)
            .WithMessage($"Specialty must be one of: {string.Join(", ", VetSpecialties.All)}")
            .When(v => v.Specialties is not null);

        RuleForEach(v => v.AcceptedSpecies!)
            .Must(Species.IsValid)
            .WithMessage($"Species must be one of: {string.Join(", ", Species.All)}")
            .When(v => v.AcceptedSpecies is not null);

        RuleForEach(v => v.ConsultModes!)
            .Must(ConsultModes.IsValid)
            .WithMessage($"Consult mode must be one of: {string.Join(", ", ConsultModes.All)}")
            .When(v => v.ConsultModes is not null);

        RuleFor(v => v.LicenseNumber!).MaximumLength(64)
            .When(v => v.LicenseNumber is not null);

        RuleFor(v => v.LicenseState!).MaximumLength(64)
            .When(v => v.LicenseState is not null);

        RuleFor(v => v.YearsExperience!.Value)
            .InclusiveBetween(0, 70).WithMessage("That looks like a typo")
            .When(v => v.YearsExperience is not null);

        RuleFor(v => v.ConsultFee!.Value)
            .GreaterThanOrEqualTo(0).WithMessage("A fee cannot be negative")
            .LessThanOrEqualTo(10_000).WithMessage("That fee looks like a typo")
            .When(v => v.ConsultFee is not null);

        RuleFor(v => v.Clinic!).ChildRules(clinic =>
        {
            clinic.RuleFor(c => c.Name).NotEmpty().MaximumLength(200)
                .WithMessage("The clinic needs a name");
            clinic.RuleFor(c => c.City).MaximumLength(120);
            clinic.RuleFor(c => c.State).MaximumLength(120);
            clinic.RuleFor(c => c.Lat).InclusiveBetween(-90, 90);
            clinic.RuleFor(c => c.Lng).InclusiveBetween(-180, 180);
            // The practice's public line. Loose on format — clinics write numbers
            // many ways — but bounded, and only digits and the usual punctuation.
            clinic.RuleFor(c => c.Phone!)
                .MaximumLength(40)
                .Matches(@"^[0-9+()\-.\s]*$").WithMessage("That doesn't look like a phone number")
                .When(c => c.Phone is not null);
        }).When(v => v.Clinic is not null);

        RuleForEach(v => v.Availability!).SetValidator(new AvailabilityDayValidator())
            .When(v => v.Availability is not null);

        RuleFor(v => v.Availability!)
            .Must(a => a.Select(x => x.Date).Distinct().Count() == a.Length)
            .WithMessage("The same date is listed twice")
            .When(v => v.Availability is not null);
    }
}

/// <summary>
/// A visit summary.
///
/// Each entry is validated as a health record would be, with two fields left
/// alone: <c>appointmentId</c> because the route already says which visit this
/// is and the service overwrites whatever is sent, and <c>occurredAt</c>
/// because an omitted one means "when the visit ended".
///
/// <b>Every record type the server accepts is accepted here</b>, including
/// <c>allergy</c> — REQUIREMENTS.md V9. The reference implementation's form
/// offered five of the six, so a vet who found a food allergy during a
/// consultation had nowhere to record it and the owner's allergy list — which
/// is what the store's recommendations read — stayed wrong.
/// </summary>
public sealed class VisitSummaryValidator : AbstractValidator<VisitSummaryRequest>
{
    /// <summary>A consultation, not a chart import.</summary>
    private const int MaxRecords = 20;

    public VisitSummaryValidator()
    {
        RuleFor(s => s.Records)
            .NotEmpty().WithMessage("A visit summary needs at least one entry")
            .Must(r => r.Length <= MaxRecords)
            .WithMessage($"A visit summary holds at most {MaxRecords} entries");

        RuleForEach(s => s.Records).ChildRules(record =>
        {
            record.RuleFor(r => r.Type)
                .Must(MedicalRecordTypes.IsValid)
                .WithMessage(
                    $"Record type must be one of: {string.Join(", ", MedicalRecordTypes.All)}");

            record.RuleFor(r => r.Title)
                .NotEmpty().WithMessage("Give the entry a title")
                .MaximumLength(200);

            record.RuleFor(r => r.Details!).MaximumLength(4000)
                .When(r => r.Details is not null);

            record.RuleFor(r => r.MedicationName!).NotEmpty().MaximumLength(200)
                .When(r => r.Type == MedicalRecordTypes.Prescription);

            record.RuleFor(r => r.RefillsLeft!.Value)
                .GreaterThanOrEqualTo(0)
                .WithMessage("Refills cannot be negative — leave it blank for no limit")
                .When(r => r.RefillsLeft is not null);
        });
    }
}
