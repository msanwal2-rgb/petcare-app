using Dapper;
using Leash.Api.Tests.Infrastructure;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;
using Leash.Core.Services;
using Leash.Core.Services.Interfaces;
using Npgsql;

namespace Leash.Api.Tests;

/// <summary>
/// The port of <c>tests/entitlements.test.ts</c> (REQUIREMENTS.md M11, M12):
/// who counts as a member, and the three benefits enforced where they are
/// used — free shipping in the quote, the consultation discount when an
/// appointment is booked, and the shorter lead time on both marketplaces.
///
/// ── Departures ──
///
///  1. <b>The seeded members are dated from the moment the seed runs</b>
///     (D001), so these tests read the real clock. With fixed dates the active
///     member lapsed on 2026-10-16 and every "member" case would have tested a
///     non-member.
///  2. <b>There is no anonymous quote.</b> <c>POST /orders/quote</c> needs a
///     session here; the "spoofed" case is a user id that does not exist.
///  3. <b>Priority booking is checked on caretaker bookings too</b> (C13 covers
///     both marketplaces; the reference only tested appointments).
/// </summary>
[Collection(DatabaseCollection.Name)]
public sealed class EntitlementTests(DatabaseFixture db) : IAsyncLifetime
{
    private const string Member = "u5";      // active
    private const string Dunning = "u6";     // past_due, inside its grace window
    private const string Lapsed = "u8";      // canceled
    private const string NonMember = "u2";

    private CoreHost _core = null!;
    private IEntitlementService _entitlements = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();

        // Open both providers all day: these cases are about lead time and
        // discounts, not the calendar (STATUS §3-G).
        await Calendars.OpenVetAsync(db.ConnectionString, "v1");
        await Calendars.OpenCaretakerAsync(db.ConnectionString, "c1");

        _core = new CoreHost(db.ConnectionString);
        _entitlements = _core.Get<IEntitlementService>();
    }

    public async Task DisposeAsync() => await _core.DisposeAsync();

    private async Task<T> One<T>(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        return await conn.QuerySingleAsync<T>(sql, args);
    }

    private async Task Exec(string sql, object? args = null)
    {
        await using var conn = new NpgsqlConnection(db.ConnectionString);
        await conn.ExecuteAsync(sql, args);
    }

    /// <summary>A copy of Biscuit (p1) for <paramref name="ownerId"/> to bring in.</summary>
    private async Task<string> PetForAsync(string ownerId, string id)
    {
        await Exec(
            $"""
             CREATE TEMP TABLE pet_copy AS SELECT * FROM pets WHERE id = 'p1';
             UPDATE pet_copy SET id = '{id}', "ownerId" = '{ownerId}';
             INSERT INTO pets SELECT * FROM pet_copy;
             DROP TABLE pet_copy;
             """);
        return id;
    }

    // ── Who counts as a member ───────────────────────────────────────────

    [Fact]
    public async Task Recognises_an_active_subscription()
    {
        var m = await _entitlements.GetMembershipAsync(Member);

        Assert.True(m.Active);
        Assert.Equal("leash_plus", m.PlanKey);
        Assert.Contains(Entitlements.FreeShipping, m.Entitlements);
        Assert.Equal(20, m.ConsultDiscountPct);
    }

    [Fact]
    public async Task Gives_no_membership_to_somebody_who_never_had_one()
    {
        var m = await _entitlements.GetMembershipAsync(NonMember);

        Assert.False(m.Active);
        Assert.Empty(m.Entitlements);
    }

    [Fact]
    public async Task Gives_no_membership_to_somebody_whose_subscription_ended()
        => Assert.False((await _entitlements.GetMembershipAsync(Lapsed)).Active);

    [Fact]
    public async Task Keeps_benefits_during_dunning_while_the_retries_are_still_running()
    {
        // A card expiring should not strip somebody's free shipping mid-order
        // while the provider is still retrying the charge (M12).
        var m = await _entitlements.GetMembershipAsync(Dunning);

        Assert.True(m.Active);
        Assert.True(m.InGrace);
        Assert.Equal("past_due", m.Status);
    }

    [Fact]
    public async Task Stops_benefits_once_the_grace_window_closes()
    {
        var grace = await One<DateTimeOffset>(
            "SELECT \"graceEndsAt\" FROM subscriptions WHERE id = 'sub_seed_past_due'");

        Assert.False((await _entitlements.GetMembershipAsync(Dunning, grace.AddMinutes(1))).Active);
    }

    [Fact]
    public async Task Stops_benefits_when_the_paid_for_period_has_run_out()
    {
        var end = await One<DateTimeOffset>(
            "SELECT \"currentPeriodEnd\" FROM subscriptions WHERE id = 'sub_seed_active'");

        Assert.False((await _entitlements.GetMembershipAsync(Member, end.AddMinutes(1))).Active);
    }

    [Fact]
    public async Task Keeps_benefits_to_the_end_of_a_period_somebody_has_cancelled()
    {
        await Exec("UPDATE subscriptions SET \"cancelAtPeriodEnd\" = true WHERE id = 'sub_seed_active'");

        var m = await _entitlements.GetMembershipAsync(Member);

        // They paid for the month; they keep the month.
        Assert.True(m.Active);
        Assert.True(m.CancelAtPeriodEnd);
    }

    [Fact]
    public async Task Answers_a_single_entitlement_question()
    {
        Assert.True(await _entitlements.HasEntitlementAsync(Member, Entitlements.FreeShipping));
        Assert.False(await _entitlements.HasEntitlementAsync(NonMember, Entitlements.FreeShipping));
    }

    [Fact]
    public void Has_a_grace_window_long_enough_to_be_worth_having()
        => Assert.True(Entitlements.DunningGraceDays >= 3);

    // ── Free shipping ────────────────────────────────────────────────────

    /// <summary>Something below the free-shipping threshold, so shipping is charged.</summary>
    private Task<CartQuoteDto> QuoteAsync(string userId, int quantity = 1)
        => _core.Get<IOrderService>()
            .QuoteAsync(userId, new QuoteRequest([new CartLineInput("prod13", quantity)], null))
            .ContinueWith(t => t.Result.Quote!);

    [Fact]
    public async Task Is_waived_for_a_member_on_a_basket_that_would_otherwise_pay()
    {
        var nonMember = await QuoteAsync(NonMember);
        var member = await QuoteAsync(Member);

        Assert.True(nonMember.ShippingCents > 0);
        Assert.Equal(0, member.ShippingCents);
        Assert.True(member.ShippingWaivedByMembership);
        Assert.Equal(nonMember.ShippingCents, member.MembershipSavingsCents);
        Assert.Equal(new QuoteMembershipDto(true, "leash_plus"), member.Membership);
    }

    [Fact]
    public async Task Does_not_claim_credit_when_the_basket_earned_free_shipping_anyway()
    {
        var member = await QuoteAsync(Member, quantity: 12);

        Assert.Equal(0, member.ShippingCents);
        // The membership did nothing here, and should not say it did.
        Assert.False(member.ShippingWaivedByMembership);
        Assert.Equal(0, member.MembershipSavingsCents);
    }

    [Fact]
    public async Task Cannot_be_claimed_by_a_caller_who_is_not_a_member()
    {
        // There is no membership field on the quote request to lie in; the id
        // comes from the session. An unknown user gets nothing.
        var spoofed = await QuoteAsync("ghost");

        Assert.Equal(StorePricing.FlatShippingCents, spoofed.ShippingCents);
        Assert.False(spoofed.Membership.Active);
    }

    [Fact]
    public async Task Never_nags_a_member_to_spend_more()
    {
        // S6.
        Assert.Equal(0, (await QuoteAsync(Member)).AmountToFreeShippingCents);
        Assert.True((await QuoteAsync(NonMember)).AmountToFreeShippingCents > 0);
    }

    [Fact]
    public async Task A_member_is_charged_no_shipping_at_checkout_and_the_order_says_why()
    {
        var pet = await PetForAsync(Member, "p_member_shop");
        var outcome = await _core.Get<IOrderService>().CreateAsync(Member, new CreateOrderRequest(
            [new CartLineInput("prod13", 1)],
            new ShippingAddressDto("Member", "1 Road", null, "Austin", "TX", "78704", "US", null),
            null, pet));

        Assert.Null(outcome.Failure);
        Assert.Equal(0, outcome.Placed!.Order.ShippingCents);
        Assert.Contains(Entitlements.FreeShipping, await One<string[]>(
            "SELECT \"benefitsApplied\" FROM orders WHERE id = @id", new { id = outcome.Placed.Order.Id }));
    }

    [Fact]
    public void Is_a_pure_boolean_at_the_arithmetic_layer()
    {
        Assert.Equal(0, StorePricing.ShippingFor(100, StorePricing.DefaultFreeShippingThresholdCents, freeShipping: true));
        Assert.Equal(StorePricing.FlatShippingCents,
            StorePricing.ShippingFor(100, StorePricing.DefaultFreeShippingThresholdCents));
    }

    // ── The vet consultation discount ────────────────────────────────────

    private static CreateAppointmentRequest Visit(string petId, double hoursFromNow = 48) => new(
        VetId: "v1", PetId: petId, Mode: ConsultModes.InClinic, Reason: "Check-up", Symptoms: [],
        StartDateTime: DateTimeOffset.UtcNow.AddHours(hoursFromNow),
        EndDateTime: DateTimeOffset.UtcNow.AddHours(hoursFromNow + 0.5),
        Notes: "");

    private Task<(int BaseFee, int DiscountPct, int Fee, bool Priority)> AppointmentRow(string id)
        => One<(int, int, int, bool)>(
            "SELECT \"baseFeeCents\", \"discountPct\", \"feeCents\", priority FROM vet_appointments WHERE id = @id", new { id });

    [Fact]
    public void Does_the_arithmetic_without_floating_point_crumbs()
        => Assert.Equal((8950, 20, 7160), AppointmentService.ConsultFee(8950, 20));

    [Fact]
    public void Clamps_a_nonsense_discount()
    {
        Assert.Equal(0, AppointmentService.ConsultFee(10000, 500).FeeCents);
        Assert.Equal(10000, AppointmentService.ConsultFee(10000, -20).FeeCents);
    }

    [Fact]
    public async Task Snapshots_the_full_fee_for_a_non_member()
    {
        // p1 belongs to u1, who is not a member.
        var (created, failure) = await _core.Get<IAppointmentService>().CreateAsync("u1", Visit("p1"));
        Assert.Null(failure);

        var row = await AppointmentRow(created!.Id);
        Assert.Equal(0, row.DiscountPct);
        Assert.Equal(row.BaseFee, row.Fee);
    }

    [Fact]
    public async Task Snapshots_the_discounted_fee_for_a_member()
    {
        var pet = await PetForAsync(Member, "p_member");

        var (created, failure) = await _core.Get<IAppointmentService>().CreateAsync(Member, Visit(pet));
        Assert.Null(failure);

        var row = await AppointmentRow(created!.Id);
        Assert.Equal(20, row.DiscountPct);
        Assert.True(row.BaseFee > row.Fee);
        Assert.Equal(AppointmentService.ConsultFee(row.BaseFee, 20).FeeCents, row.Fee);
    }

    [Fact]
    public async Task Does_not_rewrite_an_existing_appointment_when_a_membership_changes()
    {
        var (created, _) = await _core.Get<IAppointmentService>().CreateAsync("u1", Visit("p1"));
        var before = await AppointmentRow(created!.Id);

        // u1 joins afterwards. History is history.
        await Exec(
            """
            INSERT INTO subscriptions (id, "userId", "planId", provider, "providerRef", status,
              "currentPeriodStart", "currentPeriodEnd", "createdAt", "updatedAt")
            VALUES ('sub_late', 'u1', 'plan_leash_plus', 'demo', 'demo_sub_late', 'active',
              now(), now() + interval '30 days', now(), now())
            """);

        Assert.Equal(before, await AppointmentRow(created.Id));
    }

    // ── Priority booking ─────────────────────────────────────────────────

    [Fact]
    public void Lets_a_member_ask_sooner_than_everyone_else()
    {
        var now = DateTimeOffset.UtcNow;

        Assert.True(LeadTime.MemberHours < LeadTime.StandardHours);
        Assert.True(LeadTime.IsMet(now.AddHours(3), now, member: true));
        Assert.False(LeadTime.IsMet(now.AddHours(3), now, member: false));
    }

    [Fact]
    public async Task Refuses_a_non_members_same_day_request()
    {
        var (_, failure) = await _core.Get<IAppointmentService>().CreateAsync("u1", Visit("p1", hoursFromNow: 3));

        Assert.Equal(AppointmentFailure.LeadTime, failure);
    }

    [Fact]
    public async Task Marks_a_members_request_as_priority()
    {
        var pet = await PetForAsync(Member, "p_member2");

        var (created, failure) = await _core.Get<IAppointmentService>().CreateAsync(Member, Visit(pet, hoursFromNow: 3));

        Assert.Null(failure);
        Assert.True((await AppointmentRow(created!.Id)).Priority);
    }

    [Fact]
    public async Task A_member_in_dunning_keeps_priority_booking()
    {
        var pet = await PetForAsync(Dunning, "p_dunning");

        var (_, failure) = await _core.Get<IAppointmentService>().CreateAsync(Dunning, Visit(pet, hoursFromNow: 3));

        Assert.Null(failure);
    }

    [Fact]
    public async Task Priority_booking_applies_to_caretakers_as_well()
    {
        var pet = await PetForAsync(Member, "p_member3");
        var soon = DateTimeOffset.UtcNow.AddHours(3);
        var request = new CreateBookingRequest("c1", [pet], ServiceTypes.Walking, soon, soon.AddHours(1), null);

        var (_, memberFailure) = await _core.Get<IBookingService>().CreateAsync(Member, request);
        var (_, otherFailure) = await _core.Get<IBookingService>().CreateAsync("u1",
            request with { PetIds = ["p1"] });

        Assert.Null(memberFailure);
        Assert.Equal(BookingFailure.LeadTime, otherFailure);
    }

    [Fact]
    public async Task Tells_a_refused_caller_when_they_could_book_and_when_a_member_could()
    {
        // The UI offers the upgrade rather than only refusing.
        var now = DateTimeOffset.UtcNow;
        var window = await _entitlements.LeadTimeWindowAsync("u1", now);

        Assert.False(window.IsMember);
        Assert.Equal(LeadTime.EarliestStart(now, member: false), window.EarliestAt);
        Assert.Equal(LeadTime.EarliestStart(now, member: true), window.MemberEarliestAt);
    }
}
