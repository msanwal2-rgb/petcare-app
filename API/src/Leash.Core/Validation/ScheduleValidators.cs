using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

/// <summary>
/// The schedule lists' query string. One rule set; the status vocabulary is
/// the only thing that differs between appointments and bookings.
/// </summary>
public abstract class ScheduleListQueryValidator<T> : AbstractValidator<T>
    where T : ScheduleListQuery
{
    protected ScheduleListQueryValidator(Func<string, bool> isStatus, string kind)
    {
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null)
            .OverridePropertyName("limit")
            .WithMessage("Limit must be at least 1");

        RuleFor(q => q.To).Null().When(q => q.From is null)
            .WithMessage("A window's end needs its start (from)");

        RuleFor(q => q.To!.Value).GreaterThan(q => q.From!.Value).OverridePropertyName("to")
            .When(q => q.From is not null && q.To is not null)
            .WithMessage("The window must end after it starts");

        RuleFor(q => q.Status).Null().When(q => q.From is null)
            .WithMessage("A status filter applies to a window — give it a start (from)");

        RuleFor(q => q.Status!)
            .Must(s => ScheduleListQuery.ParseStatuses(s).All(isStatus))
            .When(q => q.From is not null && q.Status is not null)
            .WithMessage($"Unknown {kind} status");
    }
}

public sealed class AppointmentListQueryValidator()
    : ScheduleListQueryValidator<AppointmentListQuery>(AppointmentStatuses.IsValid, "appointment");

public sealed class BookingListQueryValidator()
    : ScheduleListQueryValidator<BookingListQuery>(BookingStatuses.IsValid, "booking");

/// <summary>
/// A new time for an appointment. The shape is checked here; whether it is
/// in the future is the service's call, because the clock lives there.
/// </summary>
public sealed class RescheduleAppointmentValidator : AbstractValidator<RescheduleAppointmentRequest>
{
    public RescheduleAppointmentValidator()
    {
        RuleFor(r => r.StartDateTime).NotEqual(default(DateTimeOffset))
            .WithMessage("Choose a new start time");

        RuleFor(r => r.EndDateTime).NotEqual(default(DateTimeOffset))
            .WithMessage("Choose a new end time");

        RuleFor(r => r.EndDateTime).GreaterThan(r => r.StartDateTime)
            .When(r => r.StartDateTime != default && r.EndDateTime != default)
            .WithMessage("The end time must be after the start time");
    }
}
