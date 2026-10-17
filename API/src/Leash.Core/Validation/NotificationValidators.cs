using FluentValidation;
using Leash.Core.Models.Dtos;

namespace Leash.Core.Validation;

/// <summary>
/// Mark-as-read takes the ids that were shown (REQUIREMENTS.md N7). An empty
/// list is refused rather than read as "everything" — that reading is the
/// defect N7 names.
/// </summary>
public sealed class MarkNotificationsReadValidator : AbstractValidator<MarkNotificationsReadRequest>
{
    /// <summary>A page of the bell is at most 50; this leaves headroom without being unbounded.</summary>
    public const int MaxIds = 100;

    public MarkNotificationsReadValidator()
    {
        RuleFor(r => r.Ids)
            .Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("List the notifications to mark read")
            .NotEmpty().WithMessage("List the notifications to mark read")
            .Must(ids => ids.Length <= MaxIds)
            .WithMessage($"At most {MaxIds} at a time")
            .Must(ids => ids.All(id => !string.IsNullOrWhiteSpace(id)))
            .WithMessage("An id is blank");
    }
}
