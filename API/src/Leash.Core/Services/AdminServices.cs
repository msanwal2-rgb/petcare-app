using System.Text.Json;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// The staff check every console method starts with (REQUIREMENTS.md D1).
/// <c>admin</c> satisfies every role (<see cref="IAccessService.HasStaffRoleAsync"/>);
/// <see cref="AdminRefusal.AnyStaff"/> asks for any role at all.
/// </summary>
public sealed class StaffGate(IAccessService access)
{
    public async Task<AdminRefusal?> RequireAsync(string callerId, string role, CancellationToken ct = default)
    {
        if (role == AdminRefusal.AnyStaff)
        {
            foreach (var any in StaffRoles.All)
                if (await access.HasStaffRoleAsync(callerId, any, ct: ct)) return null;
            return AdminRefusal.NeedsRole(role);
        }

        return await access.HasStaffRoleAsync(callerId, role, ct: ct) ? null : AdminRefusal.NeedsRole(role);
    }
}

/// <summary>See <see cref="IAuditLog"/>.</summary>
public sealed class AuditLog(IAuditRepository audit, StaffGate gate) : IAuditLog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task RecordAsync(
        StaffActor actor, string action, string targetType, string targetId, string summary,
        object? metadata = null, ITransactionScope? scope = null, CancellationToken ct = default)
        => audit.InsertAsync(
            actor.UserId, action, targetType, targetId, summary,
            metadata is null ? null : JsonSerializer.Serialize(metadata, Json),
            actor.Ip, Ids.Now(), scope, ct);

    public async Task<(AdminAuditPage? Page, AdminRefusal? Refusal)> ListAsync(
        string callerId, AdminAuditQuery query, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Admin, ct) is { } refusal) return (null, refusal);

        var (rows, next, total) = await audit.ListAsync(query, Math.Clamp(query.Limit ?? 50, 1, 200), ct);

        return (new AdminAuditPage([.. rows.Select(r => new AdminAuditEntryDto(
            r.Id, r.ActorUserId, r.ActorName, r.ActorEmail, r.Action, r.TargetType, r.TargetId, r.Summary,
            r.Metadata is null ? null : JsonDocument.Parse(r.Metadata).RootElement.Clone(),
            r.Ip, r.CreatedAt))], next, total), null);
    }
}

/// <summary>See <see cref="IAdminUserService"/>.</summary>
public sealed class AdminUserService(
    IAdminRepository admin,
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IAuditLog audit,
    StaffGate gate,
    IUnitOfWork unitOfWork) : IAdminUserService
{
    public async Task<(AdminUserPage? Page, AdminRefusal? Refusal)> SearchAsync(
        string callerId, AdminUserQuery query, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Support, ct) is { } refusal) return (null, refusal);

        var (rows, next, total) = await admin.SearchUsersAsync(query, Math.Clamp(query.Limit ?? 25, 1, 100), ct);
        return (new AdminUserPage([.. rows.Select(Summary)], next, total), null);
    }

    public async Task<(AdminUserDetailDto? Detail, AdminRefusal? Refusal)> GetAsync(
        string callerId, string userId, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Support, ct) is { } refusal) return (null, refusal);

        var row = await admin.GetUserAsync(userId, ct: ct);
        if (row is null) return (null, new AdminRefusal(AdminFailure.NotFound, $"User {userId} not found"));

        var counts = await admin.CountUserActivityAsync(userId, ct);
        var orders = await admin.RecentOrdersAsync(userId, 10, ct);
        var caretaker = await admin.CaretakerProfileForAsync(userId, ct);
        var vet = await admin.VetProfileForAsync(userId, ct);

        return (new AdminUserDetailDto(
            row.Id, row.Name, row.Email, row.AvatarUrl, row.Roles, row.StaffRoles, row.Status, row.Verified,
            row.CreatedAt, row.LastLoginAt, row.AddressCity, row.AddressState, row.AuthMethods,
            row.Phone, new AddressDto(row.AddressCity, row.AddressState, row.Lat, row.Lng),
            row.SuspendedAt, row.SuspendedReason, row.DeletedAt, row.SessionsValidFrom,
            counts, [.. orders], caretaker, vet), null);
    }

    public async Task<(UserDto? User, AdminRefusal? Refusal)> ApplyAsync(
        StaffActor actor, string userId, AdminUserActionRequest action, CancellationToken ct = default)
    {
        // Who may grant staff access is a different decision from who may read
        // an account: the one action gated on admin rather than support.
        var role = action.Action == "set_staff_roles" ? StaffRoles.Admin : StaffRoles.Support;
        if (await gate.RequireAsync(actor.UserId, role, ct) is { } refusal) return (null, refusal);

        // D4: nobody edits their own staff access, and nobody suspends
        // themselves — "admin" is a role, not a starting point.
        if (userId == actor.UserId && action.Action is "set_staff_roles" or "suspend")
            return (null, new AdminRefusal(AdminFailure.SelfEdit, "You can't change your own staff access or suspend yourself"));

        var now = Ids.Now();
        await using var scope = await unitOfWork.BeginAsync(ct);

        // Anything that can take an admin away runs under the admins' lock, so
        // two admins removing each other at once serialise and the second sees
        // one left. The caller's own authority is re-read under that lock too.
        var removesAdmin = action.Action is "set_staff_roles" or "suspend";
        IReadOnlyList<string> admins = removesAdmin ? await admin.LockActiveAdminsAsync(scope, ct) : [];
        if (role == StaffRoles.Admin && !admins.Contains(actor.UserId))
            return (null, AdminRefusal.NeedsRole(StaffRoles.Admin));

        var user = await admin.GetUserAsync(userId, scope, ct);
        if (user is null) return (null, new AdminRefusal(AdminFailure.NotFound, "That user no longer exists"));

        var losesAdmin = admins.Contains(userId) && action.Action switch
        {
            "set_staff_roles" => !(action.StaffRoles ?? []).Contains(StaffRoles.Admin),
            "suspend" => true,
            _ => false,
        };
        if (losesAdmin && admins.Count <= 1)
            return (null, new AdminRefusal(AdminFailure.LastAdmin, "There has to be at least one active admin"));

        switch (action.Action)
        {
            case "verify":
                var verified = action.Verified ?? true;
                await admin.SetVerifiedAsync(userId, verified, scope, ct);
                await audit.RecordAsync(actor, verified ? "user.verify" : "user.unverify", "user", userId,
                    $"{(verified ? "Verified" : "Un-verified")} {user.Email}", scope: scope, ct: ct);
                break;

            case "suspend":
                // The watermark moves in the same write, and every refresh
                // token goes: the suspension bites on the user's very next
                // request rather than when a 30-day cookie expires (A15, D5).
                await admin.SuspendAsync(userId, action.Reason!.Trim(), now, scope, ct);
                await refreshTokens.RevokeAllForUserAsync(userId, now, scope, ct);
                await audit.RecordAsync(actor, "user.suspend", "user", userId, $"Suspended {user.Email}",
                    new { reason = action.Reason!.Trim() }, scope, ct);
                break;

            case "reactivate":
                if (user.Status == AccountStatus.Deleted)
                    return (null, new AdminRefusal(AdminFailure.Conflict, "A deleted account cannot be reactivated"));
                await admin.ReactivateAsync(userId, scope, ct);
                await audit.RecordAsync(actor, "user.reactivate", "user", userId, $"Reactivated {user.Email}", scope: scope, ct: ct);
                break;

            case "sign_out":
                await admin.BumpSessionsAsync(userId, now, scope, ct);
                await refreshTokens.RevokeAllForUserAsync(userId, now, scope, ct);
                await audit.RecordAsync(actor, "user.sign_out", "user", userId,
                    $"Signed {user.Email} out of every device", scope: scope, ct: ct);
                break;

            case "set_roles":
                var roles = action.Roles ?? [];
                await admin.SetRolesAsync(userId, roles, scope, ct);
                await audit.RecordAsync(actor, "user.roles_change", "user", userId,
                    $"Roles for {user.Email}: {List(user.Roles)} → {List(roles)}",
                    new { from = user.Roles, to = roles }, scope, ct);
                break;

            case "set_staff_roles":
                var staffRoles = action.StaffRoles ?? [];
                await admin.SetStaffRolesAsync(userId, staffRoles, scope, ct);
                await audit.RecordAsync(actor, "user.staff_roles_change", "user", userId,
                    $"Staff roles for {user.Email}: {List(user.StaffRoles)} → {List(staffRoles)}",
                    new { from = user.StaffRoles, to = staffRoles }, scope, ct);
                break;

            default:
                return (null, new AdminRefusal(AdminFailure.Conflict, $"Unknown action \"{action.Action}\""));
        }

        await scope.CommitAsync(ct);
        return ((await users.GetByIdAsync(userId, ct: ct))!.ToDto(), null);
    }

    public async Task<(UserDto? User, AdminRefusal? Refusal)> DeleteAsync(
        StaffActor actor, string userId, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Admin, ct) is { } refusal) return (null, refusal);
        if (userId == actor.UserId)
            return (null, new AdminRefusal(AdminFailure.SelfEdit, "You can't delete your own account from here"));

        var now = Ids.Now();
        await using var scope = await unitOfWork.BeginAsync(ct);

        var admins = await admin.LockActiveAdminsAsync(scope, ct);
        if (!admins.Contains(actor.UserId)) return (null, AdminRefusal.NeedsRole(StaffRoles.Admin));

        var user = await admin.GetUserAsync(userId, scope, ct);
        if (user is null) return (null, new AdminRefusal(AdminFailure.NotFound, "That user no longer exists"));
        if (admins.Contains(userId) && admins.Count <= 1)
            return (null, new AdminRefusal(AdminFailure.LastAdmin, "There has to be at least one active admin"));

        // Soft, never hard: orders, payments and other people's reviews keep a
        // row to point at, attributed to a scrubbed placeholder (A16).
        await admin.SoftDeleteAsync(userId, now, scope, ct);
        await refreshTokens.RevokeAllForUserAsync(userId, now, scope, ct);
        await audit.RecordAsync(actor, "user.delete", "user", userId,
            $"Deleted the account formerly at {user.Email}", scope: scope, ct: ct);

        await scope.CommitAsync(ct);
        return ((await users.GetByIdAsync(userId, ct: ct))!.ToDto(), null);
    }

    private static AdminUserSummaryDto Summary(AdminUserRow r) => new(
        r.Id, r.Name, r.Email, r.AvatarUrl, r.Roles, r.StaffRoles, r.Status, r.Verified,
        r.CreatedAt, r.LastLoginAt, r.AddressCity, r.AddressState, r.AuthMethods);

    private static string List(string[] values) => values.Length == 0 ? "none" : string.Join(", ", values);
}

/// <summary>See <see cref="IAdminProfessionalService"/>.</summary>
public sealed class AdminProfessionalService(
    IAdminRepository admin,
    IAuditLog audit,
    INotifier notifier,
    StaffGate gate,
    IUnitOfWork unitOfWork) : IAdminProfessionalService
{
    public async Task<(AdminProfessionalPage? Page, AdminRefusal? Refusal)> SearchAsync(
        string callerId, AdminProfessionalQuery query, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Support, ct) is { } refusal) return (null, refusal);

        var (rows, next, total, awaiting) = await admin.SearchProfessionalsAsync(query, Math.Clamp(query.Limit ?? 25, 1, 100), ct);

        return (new AdminProfessionalPage([.. rows.Select(r => new AdminProfessionalRowDto(
            r.Id, r.Kind, r.UserId, r.UserName, r.UserEmail, r.AvatarUrl, r.Status, r.Rating, r.ReviewCount,
            Detail(r)))], next, total, awaiting), null);
    }

    /// <summary>One line of whatever is worth checking for this kind of professional.</summary>
    private static string Detail(AdminProfessionalEntity r) => r.Kind switch
    {
        "caretaker" => $"{r.D1} service{(r.D1 == "1" ? "" : "s")} · {r.D2} certification{(r.D2 == "1" ? "" : "s")}",
        "vet" => $"{r.D1} · licence {Or(r.D2)} ({Or(r.D3)})",
        _ => $"{r.D1} · {r.D2.Replace('_', ' ')} · reg {Or(r.D3)}",
    };

    private static string Or(string value) => value.Length == 0 ? "—" : value;

    public async Task<AdminRefusal?> SetVerificationAsync(
        StaffActor actor, string profileId, AdminVerificationRequest request, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Support, ct) is { } refusal) return refusal;

        await using var scope = await unitOfWork.BeginAsync(ct);

        var owner = await admin.SetVerificationAsync(request.Kind, profileId, request.Status, scope, ct);
        if (owner is null) return new AdminRefusal(AdminFailure.NotFound, "No such profile");

        var targetType = $"{request.Kind}_profile";
        await audit.RecordAsync(actor, "professional.background_check", targetType, profileId,
            $"Marked {owner.Value.Email}'s {request.Kind} profile \"{request.Status}\"",
            new { status = request.Status, note = request.Note }, scope, ct);

        // Being verified is worth hearing about; being un-verified is a
        // conversation somebody should have with them directly, not a bell.
        if (request.Status == "verified")
        {
            await notifier.NotifyAsync(owner.Value.UserId, new NotifyInput(
                NotificationKinds.ProfileVerified,
                "Your profile has been verified",
                request.Kind switch
                {
                    "vet" => "Your licence has been checked. Clients will see the verified badge on your profile.",
                    "shelter" => "Your registration has been checked. Adopters will see the verified badge on your listings.",
                    _ => "Your background check has been approved. Owners will see the verified badge on your profile.",
                },
                request.Kind switch
                {
                    "vet" => "/dashboard/vet-profile",
                    "shelter" => "/dashboard/shelter-profile",
                    _ => "/dashboard/caretaker-profile",
                }), scope, ct);
        }

        await scope.CommitAsync(ct);
        return null;
    }
}

/// <summary>See <see cref="IAdminFinanceService"/>.</summary>
public sealed class AdminFinanceService(
    IAdminRepository admin,
    IPaymentRepository payments,
    IPaymentLedger ledger,
    ISubscriptionProvider subscriptionProvider,
    IAuditLog audit,
    INotifier notifier,
    StaffGate gate,
    IUnitOfWork unitOfWork) : IAdminFinanceService
{
    public async Task<(AdminPaymentPage? Page, AdminRefusal? Refusal)> SearchPaymentsAsync(
        string callerId, AdminPaymentQuery query, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Finance, ct) is { } refusal) return (null, refusal);

        var (rows, next, total, captured, refunded) = await admin.SearchPaymentsAsync(query, Math.Clamp(query.Limit ?? 25, 1, 100), ct);
        var refunds = (await admin.RefundsForAsync([.. rows.Select(r => r.Id)], ct)).ToLookup(r => r.PaymentId);

        return (new AdminPaymentPage([.. rows.Select(p => new AdminPaymentRowDto(
            p.Id, p.UserId, p.UserName, p.UserEmail, p.Kind, p.OrderId, p.Provider, p.ProviderRef, p.Status,
            p.AmountCents, p.AmountRefundedCents, p.Currency, p.MethodBrand, p.MethodLast4, p.FailureMessage,
            p.CreatedAt, p.SucceededAt,
            [.. refunds[p.Id].Select(r => new AdminRefundRowDto(
                r.Id, r.AmountCents, r.Status, r.Reason, r.InitiatedBy, r.CreatedAt, r.SettledAt))]))],
            next, total, captured, refunded), null);
    }

    public async Task<(AdminRefundResultDto? Result, AdminRefusal? Refusal)> RefundAsync(
        StaffActor actor, string paymentId, AdminRefundRequest request, CancellationToken ct = default)
    {
        // Moving money is finance, not support: reading an account to answer a
        // ticket and sending somebody money are different decisions.
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Finance, ct) is { } refusal) return (null, refusal);

        var payment = await payments.GetByIdAsync(paymentId, ct: ct);
        if (payment is null) return (null, new AdminRefusal(AdminFailure.NotFound, "No such payment"));

        var outcome = await ledger.RequestRefundAsync(new RefundRequest(
            PaymentId: paymentId,
            AmountCents: request.AmountCents,
            Reason: request.Reason ?? RefundReasons.RequestedByCustomer,
            InitiatedBy: actor.UserId,
            Note: request.Note), ct);

        // Refused before anything was owed: nothing to record.
        if (!outcome.Ok && outcome.Failure is not RefundFailure.ProviderUnavailable)
        {
            return (null, outcome.Failure switch
            {
                RefundFailure.ExceedsCaptured =>
                    new AdminRefusal(AdminFailure.Conflict, $"Only {outcome.RemainingCents} cents are still refundable"),
                RefundFailure.AlreadyRefunding =>
                    new AdminRefusal(AdminFailure.Conflict, "A refund on this payment is already in flight"),
                RefundFailure.NotRefundable =>
                    new AdminRefusal(AdminFailure.Conflict, $"A payment that is \"{outcome.PaymentStatus}\" cannot be refunded"),
                RefundFailure.ProviderFailed =>
                    new AdminRefusal(AdminFailure.ProviderFailed, outcome.Message ?? "The payment provider refused the refund"),
                _ => new AdminRefusal(AdminFailure.NotFound, "There is nothing to refund"),
            });
        }

        // Done, or owed and queued for retry — either way money is going back
        // on this person's say-so, and the log says so.
        var pending = outcome.Failure is RefundFailure.ProviderUnavailable;
        await audit.RecordAsync(actor, "payment.refund", "payment", paymentId,
            $"Refunded {outcome.AmountCents} cents{(pending ? " (queued for retry)" : "")} to {payment.UserId}",
            new { amountCents = outcome.AmountCents, orderId = payment.OrderId, reason = request.Reason, note = request.Note, pending },
            ct: ct);

        return (new AdminRefundResultDto(outcome.RefundId!, outcome.AmountCents, pending), null);
    }

    public async Task<(AdminSubscriptionPage? Page, AdminRefusal? Refusal)> SearchSubscriptionsAsync(
        string callerId, AdminSubscriptionQuery query, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Finance, ct) is { } refusal) return (null, refusal);

        var (rows, next, total, active, mrr) = await admin.SearchSubscriptionsAsync(query, Math.Clamp(query.Limit ?? 25, 1, 100), ct);

        return (new AdminSubscriptionPage([.. rows.Select(s => new AdminSubscriptionRowDto(
            s.Id, s.UserId, s.UserName, s.UserEmail, s.PlanName, s.PriceCents, s.Status, s.ProviderRef,
            s.CurrentPeriodEnd, s.CancelAtPeriodEnd, s.GraceEndsAt, s.CreatedAt))], next, total, active, mrr), null);
    }

    public async Task<AdminRefusal?> ApplySubscriptionActionAsync(
        StaffActor actor, string subscriptionId, AdminSubscriptionActionRequest request, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Finance, ct) is { } refusal) return refusal;

        // Read without a lock first: the provider call must not happen inside
        // a transaction. The decision is re-taken under the lock below.
        AdminSubscriptionEntity? sub;
        await using (var peek = await unitOfWork.BeginAsync(ct))
            sub = await admin.GetSubscriptionForUpdateAsync(subscriptionId, peek, ct);
        if (sub is null) return new AdminRefusal(AdminFailure.NotFound, "No such subscription");

        var live = SubscriptionStatuses.Live.Contains(sub.Status);
        var immediately = request.Immediately == true;

        var problem = request.Action switch
        {
            "cancel" when !live => "Only a live membership can be cancelled",
            "resume" when !live || !sub.CancelAtPeriodEnd => "There is no scheduled cancellation to undo",
            _ => null,
        };
        if (problem is not null) return new AdminRefusal(AdminFailure.Conflict, problem);

        try
        {
            switch (request.Action)
            {
                case "cancel" when immediately: await subscriptionProvider.CancelNowAsync(sub.ProviderRef, ct); break;
                case "cancel": await subscriptionProvider.SetCancelAtPeriodEndAsync(sub.ProviderRef, true, ct); break;
                case "resume": await subscriptionProvider.SetCancelAtPeriodEndAsync(sub.ProviderRef, false, ct); break;
            }
        }
        catch (PaymentProviderException e)
        {
            return new AdminRefusal(AdminFailure.ProviderFailed, e.Message);
        }

        var now = Ids.Now();
        await using var scope = await unitOfWork.BeginAsync(ct);
        sub = await admin.GetSubscriptionForUpdateAsync(subscriptionId, scope, ct);
        if (sub is null) return new AdminRefusal(AdminFailure.NotFound, "No such subscription");

        switch (request.Action)
        {
            case "cancel":
                // Ended now: lastEventAt moves too, so a provider event older
                // than this decision cannot quietly restore the membership.
                await admin.UpdateSubscriptionAsync(subscriptionId, true,
                    immediately ? SubscriptionStatuses.Canceled : sub.Status,
                    immediately ? now : sub.CanceledAt, immediately ? now : sub.EndedAt,
                    immediately ? null : sub.GraceEndsAt, now, immediately ? now : null, scope, ct);
                await notifier.NotifyAsync(sub.UserId,
                    immediately
                        ? Notices.ForMembership(sub.Status, SubscriptionStatuses.Canceled)!
                        : Notices.MembershipCancelled(sub.CurrentPeriodEnd), scope, ct);
                await audit.RecordAsync(actor, "subscription.cancel", "subscription", subscriptionId,
                    $"Cancelled {sub.UserEmail}'s membership{(immediately ? " immediately" : " at period end")}",
                    new { immediately }, scope, ct);
                break;

            case "resume":
                await admin.UpdateSubscriptionAsync(subscriptionId, false, sub.Status, sub.CanceledAt, sub.EndedAt,
                    sub.GraceEndsAt, now, null, scope, ct);
                await audit.RecordAsync(actor, "subscription.resume", "subscription", subscriptionId,
                    $"Resumed {sub.UserEmail}'s membership", scope: scope, ct: ct);
                break;

            case "extend_grace":
                var days = request.Days ?? 7;
                var from = sub.GraceEndsAt is { } g && g > now ? g : now;
                var graceEndsAt = from.AddDays(days);
                await admin.UpdateSubscriptionAsync(subscriptionId, sub.CancelAtPeriodEnd, sub.Status, sub.CanceledAt,
                    sub.EndedAt, graceEndsAt, now, null, scope, ct);
                await audit.RecordAsync(actor, "subscription.grace_extend", "subscription", subscriptionId,
                    $"Extended {sub.UserEmail}'s grace period by {days} days", new { graceEndsAt }, scope, ct);
                break;

            default:
                return new AdminRefusal(AdminFailure.Conflict, $"Unknown action \"{request.Action}\"");
        }

        await scope.CommitAsync(ct);
        return null;
    }
}

/// <summary>See <see cref="IAdminConsoleService"/>.</summary>
public sealed class AdminConsoleService(
    IAdminRepository admin,
    ISettingsService settings,
    ISettingsRepository settingsStore,
    IAuditLog audit,
    StaffGate gate,
    IUnitOfWork unitOfWork) : IAdminConsoleService
{
    public async Task<(AdminStatsDto? Stats, AdminRefusal? Refusal)> GetStatsAsync(
        string callerId, DateTimeOffset now, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, AdminRefusal.AnyStaff, ct) is { } refusal) return (null, refusal);
        return (await admin.StatsAsync(now, ct), null);
    }

    public async Task<(SystemSettings? Settings, AdminRefusal? Refusal)> GetSettingsAsync(
        string callerId, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(callerId, StaffRoles.Admin, ct) is { } refusal) return (null, refusal);
        return (await settings.GetAsync(ct), null);
    }

    public async Task<(SystemSettings? Settings, AdminRefusal? Refusal)> UpdateSettingsAsync(
        StaffActor actor, SettingsPatchRequest patch, CancellationToken ct = default)
    {
        if (await gate.RequireAsync(actor.UserId, StaffRoles.Admin, ct) is { } refusal) return (null, refusal);

        var before = await settings.GetAsync(ct);

        // Only what was sent, and of that only what actually changes.
        var changes = new SortedDictionary<string, object>(StringComparer.Ordinal);
        if (patch.SignupsOpen is { } signups && signups != before.SignupsOpen) changes["signupsOpen"] = signups;
        if (patch.MaintenanceBanner is { } banner && banner.Trim() != before.MaintenanceBanner) changes["maintenanceBanner"] = banner.Trim();
        if (patch.DemoLoginVisible is { } demo && demo != before.DemoLoginVisible) changes["demoLoginVisible"] = demo;
        if (patch.FreeShippingThresholdCents is { } threshold && threshold != before.FreeShippingThresholdCents)
            changes["freeShippingThresholdCents"] = threshold;

        if (changes.Count == 0) return (before, null);

        var now = Ids.Now();
        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            foreach (var (key, value) in changes)
                await settingsStore.UpsertAsync(key, JsonSerializer.Serialize(value), actor.UserId, now, scope, ct);

            await audit.RecordAsync(actor, "setting.update", "setting", string.Join(",", changes.Keys),
                $"Changed {string.Join(", ", changes.Keys)}", new { before, changes }, scope, ct);
            await scope.CommitAsync(ct);
        }

        return (await settings.GetAsync(ct), null);
    }
}
