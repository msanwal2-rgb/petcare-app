using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

/// <summary>
/// The validation boundary for the credential endpoints, mirroring the Zod
/// schemas in <c>lib/validation/schemas.ts</c>.
///
/// Messages are written for the person filling in the form, not for a
/// developer: the client renders them next to the field the <c>path</c> names.
/// </summary>
public sealed class SignupRequestValidator : AbstractValidator<SignupRequest>
{
    public SignupRequestValidator()
    {
        RuleFor(r => r.Name)
            .NotEmpty().WithMessage("What should we call you?");

        RuleFor(r => r.Email)
            .NotEmpty().WithMessage("Enter a valid email.")
            .EmailAddress().WithMessage("Enter a valid email.");

        // Eight characters, matching the reference project. A length floor is
        // the only rule here on purpose: composition rules ("one symbol, one
        // digit") push people towards Password1! and are worse than length.
        RuleFor(r => r.Password)
            .MinimumLength(8).WithMessage("Use at least 8 characters.");

        // Roles are self-declared — that is what onboarding is — but only from
        // the marketplace set. Staff roles are not accepted here or anywhere a
        // user can reach (REQUIREMENTS.md A12); the absence of a rule admitting
        // them is what enforces that, so this list must never grow to include
        // one.
        RuleForEach(r => r.Roles)
            .Must(UserRoles.IsValid)
            .WithMessage("Unknown role.")
            .When(r => r.Roles is not null);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        // Deliberately shallow. A 400 that says "that is not a valid email"
        // before the rate limiter has counted the attempt is a free oracle, and
        // the password is checked against a hash, not a policy — the policy
        // applied when it was set.
        RuleFor(r => r.Email).NotEmpty();
        RuleFor(r => r.Password).NotEmpty();
    }
}

public sealed class VerifyEmailRequestValidator : AbstractValidator<VerifyEmailRequest>
{
    public VerifyEmailRequestValidator() => RuleFor(r => r.Token).NotEmpty();
}

public sealed class ForgotPasswordRequestValidator : AbstractValidator<ForgotPasswordRequest>
{
    public ForgotPasswordRequestValidator()
    {
        RuleFor(r => r.Email)
            .NotEmpty().WithMessage("Enter a valid email.")
            .EmailAddress().WithMessage("Enter a valid email.");
    }
}

public sealed class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(r => r.Token).NotEmpty();
        RuleFor(r => r.Password)
            .MinimumLength(8).WithMessage("Use at least 8 characters.");
    }
}

public sealed class RefreshRequestValidator : AbstractValidator<RefreshRequest>
{
    public RefreshRequestValidator() => RuleFor(r => r.RefreshToken).NotEmpty();
}
