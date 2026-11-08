using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;

namespace Leash.Core.Validation;

// The admin console's inputs. Kept apart from the customer validators so that
// "is this input reachable by a customer?" is answered by which file it is in.

public sealed class AdminUserQueryValidator : AbstractValidator<AdminUserQuery>
{
    public AdminUserQueryValidator()
    {
        RuleFor(q => q.Q!).MaximumLength(200).When(q => q.Q is not null);
        RuleFor(q => q.Role!).Must(UserRoles.IsValid).When(q => q.Role is not null).WithMessage("Unknown role");
        RuleFor(q => q.StaffRole!).Must(StaffRoles.IsValid).When(q => q.StaffRole is not null)
            .WithMessage("Unknown staff role");
        RuleFor(q => q.Status!)
            .Must(s => s is AccountStatus.Active or AccountStatus.Suspended or AccountStatus.Deleted
                or AccountStatus.Guest or AccountStatus.Pending)
            .When(q => q.Status is not null).WithMessage("Unknown status");
        RuleFor(q => q.AuthMethod!).Must(m => m is "password" or "google")
            .When(q => q.AuthMethod is not null).WithMessage("Sign-in method must be password or google");
        RuleFor(q => q.Sort!).Must(s => s is "newest" or "oldest" or "name" or "recent_login")
            .When(q => q.Sort is not null).WithMessage("Sort must be newest, oldest, name or recent_login");
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null);
    }
}

/// <summary>
/// One action per request, carrying exactly what that action needs. A field
/// that belongs to another action is refused rather than ignored — so a reason
/// cannot ride along with a reactivation into the audit log.
/// </summary>
public sealed class AdminUserActionValidator : AbstractValidator<AdminUserActionRequest>
{
    private static readonly string[] Actions =
        ["verify", "suspend", "reactivate", "sign_out", "set_roles", "set_staff_roles"];

    public AdminUserActionValidator()
    {
        RuleFor(a => a.Action).Must(Actions.Contains)
            .WithMessage($"Action must be one of: {string.Join(", ", Actions)}");

        RuleFor(a => a.Verified).NotNull().When(a => a.Action == "verify")
            .WithMessage("Say whether the account is verified");
        RuleFor(a => a.Verified).Null().When(a => a.Action != "verify")
            .WithMessage("Only verify takes verified");

        RuleFor(a => a.Reason).Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("A suspension needs a reason")
            .Must(r => r!.Trim().Length is >= 3 and <= 500).WithMessage("Give a reason of 3 to 500 characters")
            .When(a => a.Action == "suspend");
        RuleFor(a => a.Reason).Null().When(a => a.Action != "suspend")
            .WithMessage("Only suspend takes a reason");

        RuleFor(a => a.Roles).Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("List the roles")
            .Must(r => r!.All(UserRoles.IsValid) && r!.Distinct().Count() == r!.Length)
            .WithMessage($"Roles must be from: {string.Join(", ", UserRoles.All)}")
            .When(a => a.Action == "set_roles");
        RuleFor(a => a.Roles).Null().When(a => a.Action != "set_roles")
            .WithMessage("Only set_roles takes roles");

        RuleFor(a => a.StaffRoles).Cascade(CascadeMode.Stop)
            .NotNull().WithMessage("List the staff roles")
            .Must(r => r!.All(StaffRoles.IsValid) && r!.Distinct().Count() == r!.Length)
            .WithMessage($"Staff roles must be from: {string.Join(", ", StaffRoles.All)}")
            .When(a => a.Action == "set_staff_roles");
        RuleFor(a => a.StaffRoles).Null().When(a => a.Action != "set_staff_roles")
            .WithMessage("Only set_staff_roles takes staff roles");
    }
}

public sealed class AdminProfessionalQueryValidator : AbstractValidator<AdminProfessionalQuery>
{
    public AdminProfessionalQueryValidator()
    {
        RuleFor(q => q.Q!).MaximumLength(200).When(q => q.Q is not null);
        RuleFor(q => q.Kind!).Must(k => k is "caretaker" or "vet" or "shelter").When(q => q.Kind is not null)
            .WithMessage("Kind must be caretaker, vet or shelter");
        RuleFor(q => q.Status!).Must(s => s is "verified" or "pending" or "none").When(q => q.Status is not null)
            .WithMessage("Status must be verified, pending or none");
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null);
    }
}

public sealed class AdminVerificationValidator : AbstractValidator<AdminVerificationRequest>
{
    public AdminVerificationValidator()
    {
        RuleFor(v => v.Kind).Must(k => k is "caretaker" or "vet" or "shelter")
            .WithMessage("Kind must be caretaker, vet or shelter");
        RuleFor(v => v.Status).Must(s => s is "verified" or "pending" or "none")
            .WithMessage("Status must be verified, pending or none");
        RuleFor(v => v.Note!).MaximumLength(500).When(v => v.Note is not null);
    }
}

public sealed class AdminPaymentQueryValidator : AbstractValidator<AdminPaymentQuery>
{
    private static readonly string[] Statuses =
    [
        PaymentStatuses.Unpaid, PaymentStatuses.Pending, PaymentStatuses.RequiresAction,
        PaymentStatuses.Processing, PaymentStatuses.Authorized, PaymentStatuses.Paid,
        PaymentStatuses.PartiallyRefunded, PaymentStatuses.Refunded, PaymentStatuses.Failed,
        PaymentStatuses.Disputed,
    ];

    public AdminPaymentQueryValidator()
    {
        RuleFor(q => q.Q!).MaximumLength(200).When(q => q.Q is not null);
        RuleFor(q => q.Status!).Must(Statuses.Contains).When(q => q.Status is not null)
            .WithMessage("Unknown payment status");
        RuleFor(q => q.Kind!)
            .Must(k => k is PaymentKinds.Order or PaymentKinds.SubscriptionInvoice or PaymentKinds.AdoptionFee)
            .When(q => q.Kind is not null).WithMessage("Unknown payment kind");
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null);
    }
}

public sealed class AdminRefundValidator : AbstractValidator<AdminRefundRequest>
{
    public AdminRefundValidator()
    {
        RuleFor(r => r.AmountCents!.Value).GreaterThan(0).When(r => r.AmountCents is not null)
            .WithMessage("The amount must be positive");
        RuleFor(r => r.Reason!).Must(RefundReasons.All.Contains).When(r => r.Reason is not null)
            .WithMessage($"Reason must be one of: {string.Join(", ", RefundReasons.All)}");
        RuleFor(r => r.Note!).MaximumLength(500).When(r => r.Note is not null);
    }
}

public sealed class AdminSubscriptionQueryValidator : AbstractValidator<AdminSubscriptionQuery>
{
    public AdminSubscriptionQueryValidator()
    {
        RuleFor(q => q.Q!).MaximumLength(200).When(q => q.Q is not null);
        RuleFor(q => q.Status!).Must(SubscriptionStatuses.All.Contains).When(q => q.Status is not null)
            .WithMessage("Unknown subscription status");
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null);
    }
}

public sealed class AdminSubscriptionActionValidator : AbstractValidator<AdminSubscriptionActionRequest>
{
    public AdminSubscriptionActionValidator()
    {
        RuleFor(a => a.Action).Must(a => a is "cancel" or "resume" or "extend_grace")
            .WithMessage("Action must be cancel, resume or extend_grace");
        RuleFor(a => a.Days).NotNull().InclusiveBetween(1, 60).When(a => a.Action == "extend_grace")
            .WithMessage("Extend by 1 to 60 days");
        RuleFor(a => a.Days).Null().When(a => a.Action != "extend_grace")
            .WithMessage("Only extend_grace takes days");
        RuleFor(a => a.Immediately).Null().When(a => a.Action != "cancel")
            .WithMessage("Only cancel takes immediately");
    }
}

public sealed class AdminAuditQueryValidator : AbstractValidator<AdminAuditQuery>
{
    public AdminAuditQueryValidator()
    {
        RuleFor(q => q.Limit!.Value).GreaterThan(0).When(q => q.Limit is not null);
    }
}

public sealed class SettingsPatchValidator : AbstractValidator<SettingsPatchRequest>
{
    public SettingsPatchValidator()
    {
        RuleFor(s => s.MaintenanceBanner!).MaximumLength(300).When(s => s.MaintenanceBanner is not null);
        RuleFor(s => s.FreeShippingThresholdCents!.Value).InclusiveBetween(0, 1_000_000)
            .When(s => s.FreeShippingThresholdCents is not null);
    }
}
