using Leash.Core.Configuration;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Logging;

namespace Leash.Core.Services;

/// <summary>See <see cref="IEntitlementService"/>.</summary>
public sealed class EntitlementService(ISubscriptionRepository subscriptions) : IEntitlementService
{
    public async Task<MembershipDto> GetMembershipAsync(
        string userId, DateTimeOffset? now = null, ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var at = now ?? Ids.Now();
        var sub = await subscriptions.GetLiveForUserAsync(userId, scope, ct);
        if (sub is null) return MembershipDto.None;

        var inGrace = sub.Status == SubscriptionStatuses.PastDue;

        // Past due keeps its benefits until the grace window closes; anything
        // else keeps them until the end of the period it was paid for — which is
        // also how a cancelled-at-period-end member keeps the month they bought.
        var stillGood = inGrace
            ? sub.GraceEndsAt is { } grace && at < grace
            : at < sub.CurrentPeriodEnd;

        if (!stillGood) return MembershipDto.None;

        return new MembershipDto(
            Active: true,
            sub.PlanKey,
            sub.PlanName,
            sub.Status,
            sub.CurrentPeriodEnd,
            sub.CancelAtPeriodEnd,
            inGrace,
            sub.PlanEntitlements,
            sub.PlanConsultDiscountPct);
    }

    public async Task<bool> HasEntitlementAsync(
        string userId, string entitlement, DateTimeOffset? now = null, ITransactionScope? scope = null,
        CancellationToken ct = default)
        => (await GetMembershipAsync(userId, now, scope, ct)).Entitlements.Contains(entitlement);

    public async Task<LeadTimeWindow> LeadTimeWindowAsync(string userId, DateTimeOffset now, CancellationToken ct = default)
    {
        var member = await HasEntitlementAsync(userId, Entitlements.PriorityBooking, now, ct: ct);
        return new LeadTimeWindow(
            member, LeadTime.HoursFor(member),
            LeadTime.EarliestStart(now, member), LeadTime.EarliestStart(now, member: true));
    }
}

/// <summary>See <see cref="ISubscriptionReconciler"/>.</summary>
public sealed class SubscriptionReconciler(
    ISubscriptionRepository subscriptions,
    IPaymentRepository payments,
    INotifier notifier,
    IUnitOfWork unitOfWork) : ISubscriptionReconciler
{
    public async Task<SnapshotResult> ApplyAsync(
        SubscriptionSnapshot snapshot, DateTimeOffset eventAt, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var existing = await subscriptions.GetByProviderRefForUpdateAsync(snapshot.ProviderRef, scope, ct);

        if (existing?.LastEventAt is { } last && eventAt < last)
            return new SnapshotResult(false, false, existing.Id, SnapshotFailure.Stale);

        var plan = await subscriptions.GetPlanByIdAsync(snapshot.PlanId, scope, ct);
        if (plan is null) return new SnapshotResult(false, false, null, SnapshotFailure.UnknownPlan);

        var now = Ids.Now();
        var status = SubscriptionStatuses.Normalise(snapshot.Status);

        // Set when dunning starts and kept while it lasts; cleared when it
        // stops. Benefits survive until it passes (M12).
        DateTimeOffset? grace = status == SubscriptionStatuses.PastDue
            ? existing?.GraceEndsAt ?? now.AddDays(Entitlements.DunningGraceDays)
            : null;

        var row = new SubscriptionEntity
        {
            Id = existing?.Id ?? Ids.New("sub"),
            UserId = snapshot.UserId,
            PlanId = plan.Id,
            Provider = existing?.Provider ?? snapshot.Provider,
            ProviderRef = snapshot.ProviderRef,
            ProviderCustomerId = snapshot.ProviderCustomerId,
            Status = status,
            CurrentPeriodStart = snapshot.CurrentPeriodStart,
            CurrentPeriodEnd = snapshot.CurrentPeriodEnd,
            CancelAtPeriodEnd = snapshot.CancelAtPeriodEnd,
            CanceledAt = snapshot.CanceledAt,
            EndedAt = snapshot.EndedAt,
            GraceEndsAt = grace,
            LatestInvoiceRef = snapshot.LatestInvoiceRef,
            LastEventAt = eventAt,
            CreatedAt = existing?.CreatedAt ?? now,
            UpdatedAt = now,
        };

        if (existing is null) await subscriptions.InsertAsync(row, scope, ct);
        else await subscriptions.UpdateAsync(row, scope, ct);

        await AnnounceAsync(existing?.Status, status, snapshot.UserId, scope, ct);

        await scope.CommitAsync(ct);
        return new SnapshotResult(true, existing?.Status != status, row.Id);
    }

    private async Task AnnounceAsync(
        string? from, string to, string userId, ITransactionScope scope, CancellationToken ct)
    {
        if (Notices.ForMembership(from, to) is { } notice)
            await notifier.NotifyAsync(userId, notice, scope, ct);
    }

    public async Task<bool> RecordInvoiceAsync(
        string userId, string provider, string invoiceRef, string customerRef,
        int amountCents, string currency, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        // Once per invoice: a redelivered invoice.paid finds its row.
        if (await payments.GetByProviderRefAsync(invoiceRef, scope, ct) is not null) return false;

        var now = Ids.Now();
        await payments.CreateAsync(new PaymentEntity
        {
            Id = Ids.New("pay"),
            UserId = userId,
            Kind = PaymentKinds.SubscriptionInvoice,
            Provider = provider,
            ProviderRef = invoiceRef,
            ProviderCustomerId = customerRef,
            Status = PaymentStatuses.Paid,
            AmountCents = amountCents,
            Currency = currency,
            LastEventAt = now,
            CreatedAt = now,
            UpdatedAt = now,
            SucceededAt = now,
        }, scope, ct);

        await scope.CommitAsync(ct);
        return true;
    }

    public Task<string?> FindUserForCustomerAsync(string customerRef, CancellationToken ct = default)
        => subscriptions.FindUserByCustomerIdAsync(customerRef, ct: ct);

    public Task<PlanEntity?> PlanForPriceAsync(string priceId, CancellationToken ct = default)
        => subscriptions.GetPlanByPriceIdAsync(priceId, ct: ct);

    public Task LinkCustomerAsync(string userId, string customerRef, CancellationToken ct = default)
        => subscriptions.SetCustomerIdAsync(userId, customerRef, ct: ct);
}

/// <summary>See <see cref="IMembershipService"/>.</summary>
public sealed class MembershipService(
    IEntitlementService entitlements,
    ISubscriptionRepository subscriptions,
    ISubscriptionReconciler reconciler,
    ISubscriptionProvider provider,
    IUserRepository users,
    INotifier notifier,
    AppOrigin origin,
    IUnitOfWork unitOfWork,
    ILogger<MembershipService> log) : IMembershipService
{
    /// <summary>The one plan this app sells.</summary>
    public const string PlanKey = "leash_plus";

    public async Task<MembershipViewDto> GetViewAsync(string callerId, CancellationToken ct = default)
    {
        var membership = await entitlements.GetMembershipAsync(callerId, ct: ct);
        var plan = await subscriptions.GetPlanByKeyAsync(PlanKey, ct: ct);

        // A plan the provider cannot sell is shown as such before anyone
        // presses a button that would 503.
        return new MembershipViewDto(membership, plan?.ToDto(purchasable: provider.CanSell(plan)));
    }

    public async Task<(RedirectDto? Redirect, MembershipFailure? Failure)> CheckoutAsync(
        string callerId, CancellationToken ct = default)
    {
        var plan = await subscriptions.GetPlanByKeyAsync(PlanKey, ct: ct);

        // M14: fails closed rather than signing somebody up to nothing.
        if (plan is null || !provider.CanSell(plan)) return (null, MembershipFailure.NotAvailable);

        if ((await entitlements.GetMembershipAsync(callerId, ct: ct)).Active)
            return (null, MembershipFailure.AlreadyMember);

        var user = await users.GetByIdAsync(callerId, ct: ct);
        if (user is null) return (null, MembershipFailure.NotAvailable);

        try
        {
            // M15: the stored customer first, so a returning member is not
            // billed as a stranger.
            var customerRef = await subscriptions.GetCustomerIdAsync(callerId, ct: ct);
            if (customerRef is null)
            {
                customerRef = await provider.EnsureCustomerAsync(callerId, user.Email, user.Name, ct);
                if (customerRef is not null)
                    await subscriptions.SetCustomerIdAsync(callerId, customerRef, ct: ct);
            }

            var checkout = await provider.StartCheckoutAsync(new SubscriptionCheckoutRequest(
                customerRef, plan, callerId,
                // The redirect back is not the truth — the webhook is. The page
                // it lands on polls sync until the subscription row appears.
                SuccessUrl: origin.Url("/account/membership?checkout=success"),
                CancelUrl: origin.Url("/plus?checkout=cancelled")), ct);

            // A synchronous provider settled already: apply what it settled
            // through the webhook's own two steps.
            if (checkout.Settled is { } settled)
            {
                await reconciler.ApplyAsync(Snapshot(settled, plan.Id, callerId), Ids.Now(), ct);
                if (checkout.Invoice is { } invoice)
                {
                    await reconciler.RecordInvoiceAsync(
                        callerId, provider.Name, invoice.Ref, settled.CustomerRef,
                        invoice.AmountCents, invoice.Currency, ct);
                }
            }

            return (new RedirectDto(checkout.Url), null);
        }
        catch (PaymentProviderException e)
        {
            log.LogError(e, "Membership checkout failed for {UserId}", callerId);
            return (null, MembershipFailure.ProviderFailed);
        }
    }

    public async Task<(MembershipCancelledDto? Cancelled, MembershipFailure? Failure)> CancelAsync(
        string callerId, CancellationToken ct = default)
    {
        var sub = await subscriptions.GetLatestForUserAsync(callerId, ct: ct);
        if (sub is null || !SubscriptionStatuses.Live.Contains(sub.Status))
            return (null, MembershipFailure.NoMembership);

        try
        {
            await provider.SetCancelAtPeriodEndAsync(sub.ProviderRef, true, ct);
        }
        catch (PaymentProviderException e)
        {
            log.LogError(e, "Cancelling {SubscriptionId} failed", sub.Id);
            return (null, MembershipFailure.ProviderFailed);
        }

        // Set locally too. The webhook will confirm it, but the member pressed
        // cancel and should see it without waiting for a round trip.
        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            await subscriptions.SetCancelAtPeriodEndAsync(sub.Id, true, Ids.Now(), scope, ct);
            await notifier.NotifyAsync(callerId, Notices.MembershipCancelled(sub.CurrentPeriodEnd), scope, ct);
            await scope.CommitAsync(ct);
        }

        return (new MembershipCancelledDto(true, sub.CurrentPeriodEnd), null);
    }

    public async Task<MembershipFailure?> ResumeAsync(string callerId, CancellationToken ct = default)
    {
        var sub = await subscriptions.GetLatestForUserAsync(callerId, ct: ct);
        if (sub is null || !sub.CancelAtPeriodEnd || !SubscriptionStatuses.Live.Contains(sub.Status))
            return MembershipFailure.NothingToResume;

        try
        {
            await provider.SetCancelAtPeriodEndAsync(sub.ProviderRef, false, ct);
        }
        catch (PaymentProviderException e)
        {
            log.LogError(e, "Resuming {SubscriptionId} failed", sub.Id);
            return MembershipFailure.ProviderFailed;
        }

        await subscriptions.SetCancelAtPeriodEndAsync(sub.Id, false, Ids.Now(), ct: ct);
        return null;
    }

    public async Task<(RedirectDto? Redirect, MembershipFailure? Failure)> PortalAsync(
        string callerId, CancellationToken ct = default)
    {
        var customerRef = await subscriptions.GetCustomerIdAsync(callerId, ct: ct);

        // Not pretended: the portal is the provider's, and the demo has none.
        if (!provider.HasBillingPortal) return (null, MembershipFailure.NotAvailable);
        if (customerRef is null) return (null, MembershipFailure.NoBillingHistory);

        try
        {
            var url = await provider.PortalUrlAsync(customerRef, origin.Url("/account/membership"), ct);
            return url is null ? (null, MembershipFailure.NotAvailable) : (new RedirectDto(url), null);
        }
        catch (PaymentProviderException e)
        {
            log.LogError(e, "Opening the billing portal failed for {UserId}", callerId);
            return (null, MembershipFailure.ProviderFailed);
        }
    }

    public async Task<(MembershipDto? Membership, MembershipFailure? Failure)> SyncAsync(
        string callerId, CancellationToken ct = default)
    {
        var sub = await subscriptions.GetLatestForUserAsync(callerId, ct: ct);

        if (sub is not null)
        {
            try
            {
                var current = await provider.GetSubscriptionAsync(sub.ProviderRef, ct);
                var plan = current is null
                    ? null
                    : current.PlanId is { } planId
                        ? await subscriptions.GetPlanByIdAsync(planId, ct: ct)
                        : await subscriptions.GetPlanByPriceIdAsync(current.PriceId, ct: ct);

                if (current is not null && plan is not null)
                    await reconciler.ApplyAsync(Snapshot(current, plan.Id, callerId), Ids.Now(), ct);
            }
            catch (PaymentProviderException e)
            {
                log.LogWarning(e, "Membership sync failed for {UserId}", callerId);
                return (null, MembershipFailure.ProviderFailed);
            }
        }

        return (await entitlements.GetMembershipAsync(callerId, ct: ct), null);
    }

    private SubscriptionSnapshot Snapshot(ProviderSubscription s, string planId, string userId) => new(
        s.Ref, provider.Name, s.CustomerRef, s.Status, s.CurrentPeriodStart, s.CurrentPeriodEnd,
        s.CancelAtPeriodEnd, CanceledAt: null, EndedAt: null, LatestInvoiceRef: "", planId, userId);
}
