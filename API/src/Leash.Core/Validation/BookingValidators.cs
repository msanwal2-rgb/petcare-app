using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;

namespace Leash.Core.Validation;

/// <summary>
/// A booking request.
///
/// What is <b>not</b> here is the point: no price and no owner. Both are
/// server-side, so there is no field to validate and nothing to tamper with.
/// The dates are checked for shape here and for lead time in the service, where
/// the clock and the membership rule live.
/// </summary>
public sealed class CreateBookingValidator : AbstractValidator<CreateBookingRequest>
{
    /// <summary>
    /// One booking covers one household's animals, not a kennel. The cap is a
    /// sanity bound rather than a product rule — it stops a request naming ten
    /// thousand pet ids from turning into ten thousand ownership checks.
    /// </summary>
    private const int MaxPetsPerBooking = 10;

    public CreateBookingValidator()
    {
        RuleFor(b => b.CaretakerId).NotEmpty().WithMessage("Choose a caretaker");

        RuleFor(b => b.ServiceType)
            .Must(ServiceTypes.IsValid)
            .WithMessage($"Service must be one of: {string.Join(", ", ServiceTypes.All)}");

        RuleFor(b => b.PetIds)
            .NotEmpty().WithMessage("Choose at least one pet")
            .Must(ids => ids.Length <= MaxPetsPerBooking)
            .WithMessage($"A booking can cover at most {MaxPetsPerBooking} pets")
            .Must(ids => ids.Distinct(StringComparer.Ordinal).Count() == ids.Length)
            .WithMessage("The same pet is listed twice");

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

public sealed class UpdateBookingStatusValidator : AbstractValidator<UpdateBookingStatusRequest>
{
    public UpdateBookingStatusValidator()
    {
        RuleFor(r => r.Status)
            .Must(BookingStatuses.IsValid)
            .WithMessage($"Status must be one of: {string.Join(", ", BookingStatuses.All)}");
    }
}

public sealed class CreateMessageValidator : AbstractValidator<CreateMessageRequest>
{
    public CreateMessageValidator()
    {
        RuleFor(m => m.Body)
            .NotEmpty().WithMessage("Write a message first")
            .MaximumLength(4000);
    }
}

public sealed class CreateReviewValidator : AbstractValidator<CreateReviewRequest>
{
    public CreateReviewValidator()
    {
        RuleFor(r => r.ToUserId).NotEmpty();

        // Half-stars are a real thing in this UI, so the step is 0.5 rather
        // than a whole number.
        RuleFor(r => r.Rating)
            .InclusiveBetween(1, 5).WithMessage("Rate between 1 and 5")
            .Must(rating => Math.Abs(rating * 2 - Math.Round(rating * 2)) < 1e-9)
            .WithMessage("Ratings go in half-stars");

        RuleFor(r => r.Comment!).MaximumLength(4000).When(r => r.Comment is not null);
    }
}

public sealed class PricingEntryValidator : AbstractValidator<PricingEntryDto>
{
    public PricingEntryValidator()
    {
        RuleFor(p => p.ServiceType)
            .Must(ServiceTypes.IsValid)
            .WithMessage($"Service must be one of: {string.Join(", ", ServiceTypes.All)}");

        RuleFor(p => p.Unit)
            .Must(PricingUnits.IsValid)
            .WithMessage("Charge per hour or per day");

        RuleFor(p => p.Rate)
            .GreaterThan(0).WithMessage("A rate must be more than nothing")
            .LessThanOrEqualTo(10_000).WithMessage("That rate looks like a typo");
    }
}

public sealed class AvailabilityDayValidator : AbstractValidator<AvailabilityDayDto>
{
    /// <summary>A real 24-hour clock time — "24:00" and "09:75" are not.</summary>
    private const string ClockTime = @"^([01]\d|2[0-3]):[0-5]\d$";

    /// <summary>
    /// More stretches of hours than anyone works in a day. A bound, so a
    /// published day cannot be a thousand-slot payload.
    /// </summary>
    public const int MaxSlotsPerDay = 12;

    public AvailabilityDayValidator()
    {
        RuleFor(d => d.Slots).Must(s => s.Length <= MaxSlotsPerDay)
            .WithMessage($"At most {MaxSlotsPerDay} sets of hours in a day");

        RuleForEach(d => d.Slots).ChildRules(slot =>
        {
            slot.RuleFor(s => s.Start).Matches(ClockTime)
                .WithMessage("Times look like 09:00");
            slot.RuleFor(s => s.End).Matches(ClockTime)
                .WithMessage("Times look like 17:00");
            slot.RuleFor(s => s)
                .Must(s => string.CompareOrdinal(s.End, s.Start) > 0)
                .WithMessage("A slot must end after it starts");
        });

        // Two stretches of hours that overlap would offer an owner the same
        // time twice. Zero-padded HH:MM compares correctly as text.
        RuleFor(d => d.Slots)
            .Must(slots =>
            {
                var sorted = slots.OrderBy(s => s.Start, StringComparer.Ordinal).ToArray();
                for (var i = 1; i < sorted.Length; i++)
                    if (string.CompareOrdinal(sorted[i].Start, sorted[i - 1].End) < 0) return false;
                return true;
            })
            .WithMessage("Two sets of hours on one day overlap");
    }
}

/// <summary>The whole published calendar, which is sent replace-whole.</summary>
public static class AvailabilityRules
{
    /// <summary>
    /// A bound on the days sent in one save — a little over the year ahead
    /// the editor lets anyone plan, so a calendar cannot be a payload of
    /// thousands of rows. The editor drops days already past when it saves.
    /// </summary>
    public const int MaxDays = 400;
}

/// <summary>
/// An edit to one's own caretaker profile.
///
/// No rules for <c>rating</c>, <c>reviewCount</c> or <c>responseRatePct</c>,
/// because the request type has no such properties. They are derived, and
/// <see cref="Services.ReputationService"/> is their only writer — a caretaker
/// cannot award themselves a reputation because there is nowhere to put one.
/// </summary>
public sealed class CaretakerPatchValidator : AbstractValidator<CaretakerPatchRequest>
{
    public CaretakerPatchValidator()
    {
        RuleFor(c => c.Bio!).MaximumLength(4000).When(c => c.Bio is not null);

        RuleForEach(c => c.ServicesOffered!)
            .Must(ServiceTypes.IsValid)
            .WithMessage($"Service must be one of: {string.Join(", ", ServiceTypes.All)}")
            .When(c => c.ServicesOffered is not null);

        RuleForEach(c => c.AcceptedSpecies!)
            .Must(Species.IsValid)
            .WithMessage($"Species must be one of: {string.Join(", ", Species.All)}")
            .When(c => c.AcceptedSpecies is not null);

        RuleFor(c => c.ServiceRadiusMiles!.Value)
            .InclusiveBetween(1, 200).WithMessage("A service radius is between 1 and 200 miles")
            .When(c => c.ServiceRadiusMiles is not null);

        RuleFor(c => c.BackgroundCheckStatus!)
            .Must(BackgroundCheckStatuses.IsValid)
            .When(c => c.BackgroundCheckStatus is not null);

        RuleForEach(c => c.Certifications!).NotEmpty().MaximumLength(200)
            .When(c => c.Certifications is not null);

        RuleForEach(c => c.Pricing!).SetValidator(new PricingEntryValidator())
            .When(c => c.Pricing is not null);

        RuleFor(c => c.Pricing!)
            .Must(p => p.Select(x => x.ServiceType).Distinct(StringComparer.Ordinal).Count() == p.Length)
            .WithMessage("Each service can have only one rate")
            .When(c => c.Pricing is not null);

        RuleForEach(c => c.Availability!).SetValidator(new AvailabilityDayValidator())
            .When(c => c.Availability is not null);

        RuleFor(c => c.Availability!)
            .Must(a => a.Select(x => x.Date).Distinct().Count() == a.Length)
            .WithMessage("The same date is listed twice")
            .When(c => c.Availability is not null);

        RuleFor(c => c.Availability!)
            .Must(a => a.Length <= AvailabilityRules.MaxDays)
            .WithMessage($"At most {AvailabilityRules.MaxDays} days can be published at once")
            .When(c => c.Availability is not null);
    }
}
