using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

public sealed class UpdateUserRequestValidator : AbstractValidator<UpdateUserRequest>
{
    public UpdateUserRequestValidator()
    {
        // Every field is optional — this is a PATCH — so each rule is scoped to
        // "if it was sent". A name sent as an empty string is a mistake worth
        // rejecting; a name not sent at all is not a change.
        RuleFor(r => r.Name)
            .NotEmpty().WithMessage("What should we call you?")
            .When(r => r.Name is not null);

        RuleForEach(r => r.Roles)
            .Must(UserRoles.IsValid).WithMessage("Unknown role.")
            .When(r => r.Roles is not null);

        When(r => r.Address is not null, () =>
        {
            RuleFor(r => r.Address!.City).NotEmpty();
            RuleFor(r => r.Address!.State).NotEmpty();

            // Bounded because these coordinates are what the search map is
            // drawn from and what distance sorting is computed against — an
            // out-of-range pair does not fail, it silently places someone
            // nowhere and drops them from every result.
            RuleFor(r => r.Address!.Lat).InclusiveBetween(-90, 90);
            RuleFor(r => r.Address!.Lng).InclusiveBetween(-180, 180);
        });
    }
}
