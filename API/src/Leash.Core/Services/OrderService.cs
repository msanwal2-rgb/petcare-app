using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Payments;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Checkout and order history. See <see cref="IOrderService"/> for the
/// contract, and for where REQUIREMENTS.md S9 — the one High-severity defect in
/// the reference implementation — is closed.
///
/// Three rules drive the design, inherited from the reference and kept:
///
///  1. <b>The client's prices are display-only.</b> <see cref="QuoteAsync"/>
///     re-reads every product, and that quote is what gets charged. The order
///     request has no price field at all.
///  2. <b>Stock is taken with a conditional update inside the transaction</b>,
///     so two people buying the last bag cannot both succeed.
///  3. <b>Line items snapshot the product</b> — a later catalogue edit never
///     rewrites what a customer was charged or shipped.
/// </summary>
public sealed class OrderService(
    IOrderRepository orders,
    ICatalogRepository catalog,
    IPaymentRepository payments,
    IMedicalRecordRepository records,
    IPetRepository pets,
    IAccessService access,
    ISettingsService settings,
    IPaymentProvider provider,
    IOrderLifecycle lifecycle,
    IUnitOfWork unitOfWork) : IOrderService
{
    /// <summary>The demo provider and the seeded ledger are both USD.</summary>
    private const string Currency = "usd";

    public async Task<(CartQuoteDto? Quote, OrderFailure? Failure)> QuoteAsync(
        string callerId, QuoteRequest input, CancellationToken ct = default)
    {
        // Ownership before the pet is used for anything. The prescription check
        // and the allergen warnings below both read this pet's medical record;
        // a quote for somebody else's pet is a probe of it.
        if (input.PetId is not null && !await access.OwnsPetAsync(callerId, input.PetId, ct: ct))
            return (null, OrderFailure.NotYourPet);

        return (await PriceAsync(input.Items, input.PetId, scope: null, ct), null);
    }

    /// <summary>
    /// Place an order.
    ///
    /// The order of operations is the whole design, and it is the reference
    /// implementation's corrected one:
    ///
    /// <code>
    ///   [tx: check pet → reclaim abandoned holds → re-quote → take stock
    ///        → create order @ pending_payment]
    ///   → create intent → payment row → settle (if the provider is synchronous)
    /// </code>
    ///
    /// The order exists <i>before</i> any money moves. The version this
    /// replaces captured first and wrote the row second, so a crash between the
    /// two left a real charge with no order and no trace. Now a failure after
    /// the commit leaves an unpaid order holding its stock, which the customer
    /// can retry and the reaper will eventually release — no money has moved,
    /// so there is nothing to compensate.
    ///
    /// <b>Stock is reserved here, not at settlement.</b> Deferring it to the
    /// payment would let two customers both be told "order placed" for the last
    /// unit, and refunding a successful charge for goods that do not exist is
    /// worse for everyone than a fifteen-minute hold.
    ///
    /// <b>The re-quote is inside the transaction</b>, after abandoned holds are
    /// reclaimed — so stock that an expired checkout was sitting on counts as
    /// available, and the prescription that authorised an Rx line is read in
    /// the same world as the INSERT that relies on it.
    /// </summary>
    public async Task<CreateOrderOutcome> CreateAsync(
        string callerId, CreateOrderRequest input, CancellationToken ct = default)
    {
        if (input.Items.Length == 0) return new(null, OrderFailure.Empty);

        var orderId = Ids.New("o");
        var placedAt = Ids.Now();
        CartQuoteDto quote;

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            // REQUIREMENTS.md S9. Re-checked here, on the write, even though the
            // client quoted first — authorization is never inferred from a
            // previous request.
            if (input.PetId is not null
                && !await access.OwnsPetAsync(callerId, input.PetId, scope, ct))
                return new(null, OrderFailure.NotYourPet);

            var productIds = input.Items.Select(i => i.ProductId).Distinct().ToArray();
            await lifecycle.ReleaseExpiredAsync(productIds, placedAt, scope, ct);

            quote = await PriceAsync(input.Items, input.PetId, scope, ct);
            if (quote.Problems.Length > 0 || quote.Lines.Length == 0)
                return new(null, OrderFailure.Unavailable, Quote: quote);

            // The race guard. If somebody took the last unit between the quote
            // and here, this matches nothing, and disposing the scope rolls back
            // every decrement already made for this basket.
            foreach (var line in quote.Lines)
            {
                if (!await catalog.TryTakeStockAsync(line.ProductId, line.Quantity, scope, ct))
                    return new(null, OrderFailure.StockRace, ProductId: line.ProductId);
            }

            // P9: spend the refills, in this transaction, alongside the stock
            // (STATUS.md §5). Locked and re-counted here rather than trusting the
            // quote above, because another checkout may have spent the last one
            // since. After the stock rather than before, so every checkout takes
            // its locks in the same order — products, then records — and two of
            // them cannot deadlock on each other.
            var rxLines = quote.Lines.Where(l => l.RequiresPrescription).ToList();
            if (rxLines.Count > 0)
            {
                var spent = await SpendRefillsAsync(input.PetId!, rxLines, placedAt, quote, scope, ct);
                if (spent is not null) return spent;
            }

            var products = (await catalog.GetByIdsAsync(productIds, scope, ct))
                .ToDictionary(p => p.Id);

            var order = new OrderEntity
            {
                Id = orderId,
                UserId = callerId,
                Status = OrderStatuses.PendingPayment,
                PaymentStatus = PaymentStatuses.Unpaid,
                PaymentRef = null,
                SubtotalCents = quote.SubtotalCents,
                ShippingCents = quote.ShippingCents,
                TaxCents = quote.TaxCents,
                TotalCents = quote.TotalCents,
                ShipName = input.ShippingAddress.Name,
                ShipLine1 = input.ShippingAddress.Line1,
                ShipLine2 = input.ShippingAddress.Line2 ?? "",
                ShipCity = input.ShippingAddress.City,
                ShipState = input.ShippingAddress.State,
                ShipPostalCode = input.ShippingAddress.PostalCode,
                ShipCountry = string.IsNullOrWhiteSpace(input.ShippingAddress.Country)
                    ? "US" : input.ShippingAddress.Country,
                ShipPhone = input.ShippingAddress.Phone ?? "",
                DeliveryInstructions = input.DeliveryInstructions ?? "",
                PlacedAt = placedAt,
                EstimatedDeliveryAt = Delivery.EstimatedDelivery(placedAt),
                ReservationExpiresAt = placedAt + Delivery.ReservationTtl,

                // Snapshotted: a membership that lapses next month must not
                // rewrite what this order cost. M7 is what puts anything here.
                BenefitsApplied = quote.ShippingWaivedByMembership ? ["free_shipping"] : [],
            };

            // S11: name, brand, image, slug and price as they are *now*, copied.
            var items = quote.Lines.Select(line =>
            {
                var p = products[line.ProductId];
                return new OrderItemEntity
                {
                    Id = Ids.New("oi"),
                    OrderId = orderId,
                    ProductId = p.Id,
                    Name = p.Name,
                    Brand = p.Brand,
                    ImageUrl = p.ImageUrl,
                    Slug = p.Slug,
                    UnitPriceCents = line.UnitPriceCents,
                    Quantity = line.Quantity,
                    LineTotalCents = line.LineTotalCents,
                };
            }).ToList();

            await orders.CreateAsync(
                order, items,
                OrderLifecycle.EventFor(orderId, OrderStatuses.PendingPayment, placedAt),
                scope, ct);

            await scope.CommitAsync(ct);
        }

        // From here the order exists. A failure below leaves it unpaid and
        // holding stock; the client retries the payment step, not the cart.
        var handoff = await StartPaymentAsync(callerId, orderId, quote.TotalCents, ct);
        if (handoff is null)
            return new(null, OrderFailure.PaymentSetupFailed, OrderId: orderId);

        var placed = await lifecycle.LoadAsync(orderId, ct: ct);
        return new(new PlacedOrderDto(placed!, handoff), null);
    }

    public async Task<OrderPage> ListMineAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default)
    {
        var (rows, next) = await orders.ListByUserAsync(callerId, cursor, limit, ct: ct);
        return new OrderPage(await lifecycle.LoadManyAsync(rows, ct), next);
    }

    public async Task<(OrderDto? Order, OrderFailure? Failure)> GetAsync(
        string callerId, string orderId, CancellationToken ct = default)
    {
        var order = await orders.GetByIdAsync(orderId, ct: ct);

        // The customer, or store operations. Anyone else gets the same answer
        // as for an order that does not exist — ids are sequential.
        if (order is null) return (null, OrderFailure.NotFound);
        if (order.UserId != callerId && !await IsOpsAsync(callerId, ct))
            return (null, OrderFailure.NotFound);

        return (await lifecycle.LoadAsync(orderId, ct: ct), null);
    }

    public async Task<(OrderDto? Order, OrderFailure? Failure)> CancelAsync(
        string callerId, string orderId, CancellationToken ct = default)
    {
        var order = await orders.GetByIdAsync(orderId, ct: ct);
        if (order is null || order.UserId != callerId) return (null, OrderFailure.NotFound);

        // The window (REQUIREMENTS.md S15). Narrower than the transition table:
        // staff can still refund a shipped order, but a customer's button stops
        // once the parcel is with the carrier.
        if (!Delivery.CanCustomerCancel(order.Status)) return (null, OrderFailure.NotCancellable);

        return await lifecycle.MoveAsync(orderId, OrderStatuses.Cancelled, ct: ct);
    }

    /// <summary>
    /// A staff move. <b>Authority is checked before the order is read</b> —
    /// unlike bookings and appointments, where legality comes first. There the
    /// caller is a party to the thing and may already know its status; here a
    /// customer is not entitled to learn anything about an order's state from
    /// this route, including whether a move from it would be legal.
    /// </summary>
    public async Task<(OrderDto? Order, OrderFailure? Failure)> UpdateStatusAsync(
        string callerId, string orderId, UpdateOrderStatusRequest input,
        CancellationToken ct = default)
    {
        if (!await IsOpsAsync(callerId, ct)) return (null, OrderFailure.NotOps);

        return await lifecycle.MoveAsync(
            orderId, input.Status,
            new OrderMove(input.Location, input.Carrier, input.TrackingNumber),
            ct);
    }

    public async Task<OrderPage?> ListForFulfilmentAsync(
        string callerId, string? cursor, int limit, CancellationToken ct = default)
    {
        if (!await IsOpsAsync(callerId, ct)) return null;

        var (rows, next) = await orders.ListForFulfilmentAsync(cursor, limit, ct: ct);
        return new OrderPage(await lifecycle.LoadManyAsync(rows, ct), next);
    }

    public async Task<(PlacedOrderDto? Placed, OrderFailure? Failure)> SyncPaymentAsync(
        string callerId, string orderId, CancellationToken ct = default)
    {
        var order = await orders.GetByIdAsync(orderId, ct: ct);
        if (order is null || order.UserId != callerId) return (null, OrderFailure.NotFound);

        var payment = await payments.GetCurrentForOrderAsync(orderId, ct: ct);
        PaymentHandoffDto? handoff;

        if (payment is null)
        {
            // The 502 retry path: the order was committed but the intent never
            // was. Only an order still waiting to be paid gets a new one — a
            // cancelled checkout is not resurrected by a stale retry.
            if (order.Status != OrderStatuses.PendingPayment)
                return (null, OrderFailure.InvalidTransition);

            handoff = await StartPaymentAsync(callerId, orderId, order.TotalCents, ct);
            if (handoff is null) return (null, OrderFailure.PaymentSetupFailed);
        }
        else
        {
            var intent = await provider.GetIntentAsync(payment.ProviderRef, ct);
            if (intent.Status == IntentStatuses.Succeeded
                && order.Status == OrderStatuses.PendingPayment)
            {
                await lifecycle.SettleAsync(orderId, ct);
            }

            handoff = new PaymentHandoffDto(payment.ProviderRef, null, payment.Provider);
        }

        return (new PlacedOrderDto((await lifecycle.LoadAsync(orderId, ct: ct))!, handoff), null);
    }

    // ── Pricing ──────────────────────────────────────────────────────────

    /// <summary>
    /// Re-price a cart against the live catalogue (REQUIREMENTS.md S4). The
    /// caller has already established that <paramref name="petId"/>, if any, is
    /// theirs.
    ///
    /// Problems are checked in a fixed order — gone, withdrawn, sold out, short,
    /// then the prescription — so the message a customer sees is the most
    /// fundamental one. Telling somebody they need a prescription for a product
    /// that is sold out anyway sends them to their vet for nothing.
    /// </summary>
    private async Task<CartQuoteDto> PriceAsync(
        IReadOnlyList<CartLineInput> lines, string? petId,
        ITransactionScope? scope, CancellationToken ct)
    {
        var products = (await catalog.GetByIdsAsync(
                [.. lines.Select(l => l.ProductId).Distinct()], scope, ct))
            .ToDictionary(p => p.Id);

        // The one definition of "is this prescription active?" (P8). The store
        // gate reads it rather than restating it, and PrescriptionCover counts
        // the refills on what it returns.
        var cover = new PrescriptionCover(petId is null
            ? []
            : await records.ListActivePrescriptionsAsync(petId, Ids.Now(), scope, ct));

        var petAllergens = petId is null
            ? []
            : ((await pets.GetByIdAsync(petId, scope, ct))?.Allergies ?? [])
                .Select(a => a.Trim().ToLowerInvariant())
                .Where(a => a.Length > 0)
                .ToArray();

        var problems = new List<CartProblemDto>();
        var quoted = new List<QuotedLineDto>();
        var warnings = new List<AllergenWarningDto>();

        foreach (var line in lines)
        {
            if (!products.TryGetValue(line.ProductId, out var p))
            {
                problems.Add(new(line.ProductId, CartProblemCodes.NotFound,
                    "This product no longer exists."));
                continue;
            }

            if (!p.Active)
            {
                problems.Add(new(p.Id, CartProblemCodes.Inactive, $"{p.Name} is no longer sold."));
                continue;
            }

            if (p.StockQty == 0)
            {
                problems.Add(new(p.Id, CartProblemCodes.OutOfStock, $"{p.Name} is sold out."));
                continue;
            }

            if (p.StockQty < line.Quantity)
            {
                problems.Add(new(p.Id, CartProblemCodes.InsufficientStock,
                    $"Only {p.StockQty} left of {p.Name}."));
                continue;
            }

            // S7 and P9. With no pet named there are no prescriptions and every
            // Rx line is refused — there is no animal for one to belong to. With
            // a pet, the prescriptions must cover the *quantity*, one refill per
            // unit; see PrescriptionCover.
            if (p.RequiresPrescription)
            {
                var covered = cover.Cover(p.Slug, line.Quantity);
                if (covered.Outcome != PrescriptionCover.Outcome.Covered)
                {
                    problems.Add(new(p.Id, CartProblemCodes.PrescriptionRequired,
                        PrescriptionCover.Message(covered, p.Name, line.Quantity)));
                    continue;
                }
            }

            quoted.Add(new QuotedLineDto(
                p.Id, p.Slug, p.Name, p.PriceCents, line.Quantity,
                p.PriceCents * line.Quantity, InStock: true, p.RequiresPrescription));

            var matching = CatalogService.MatchingAllergens(p.Allergens, petAllergens);
            if (matching.Count > 0) warnings.Add(new(p.Id, [.. matching]));
        }

        var subtotal = quoted.Sum(l => l.LineTotalCents);
        var threshold = (await settings.GetAsync(ct)).FreeShippingThresholdCents;

        // M7 reads Leash Plus here. Until then nobody is a member — the safe
        // direction, charging shipping rather than waiving it for a non-member.
        const bool freeShipping = false;

        // Nothing in the basket costs nothing to ship. Without this an empty
        // cart — or one whose every line was refused — quotes $5.99.
        var empty = quoted.Count == 0;
        var shipping = empty ? 0 : StorePricing.ShippingFor(subtotal, threshold, freeShipping);
        var tax = empty ? 0 : StorePricing.TaxFor(subtotal);
        var withoutMembership = empty ? 0 : StorePricing.ShippingFor(subtotal, threshold);

        return new CartQuoteDto(
            [.. quoted],
            subtotal,
            shipping,
            tax,
            subtotal + shipping + tax,
            [.. problems],
            [.. warnings],
            new QuoteMembershipDto(Active: false, PlanKey: null),
            ShippingWaivedByMembership: freeShipping && withoutMembership > 0,
            MembershipSavingsCents: Math.Max(0, withoutMembership - shipping),
            AmountToFreeShippingCents: empty
                ? 0
                : StorePricing.AmountToFreeShipping(subtotal, threshold, freeShipping));
    }

    /// <summary>
    /// Lock the pet's active prescriptions, cover every Rx line from them, and
    /// decrement what that uses. Null on success; a refusal otherwise, which
    /// the caller returns — disposing the scope then rolls back the stock it
    /// took as well.
    ///
    /// A refusal here means the quote was right a moment ago and is not now:
    /// somebody else's checkout used the refills in between. The quote handed
    /// back carries the line's problem, so the cart can say exactly that.
    /// </summary>
    private async Task<CreateOrderOutcome?> SpendRefillsAsync(
        string petId, IReadOnlyList<QuotedLineDto> rxLines, DateTimeOffset now,
        CartQuoteDto quote, ITransactionScope scope, CancellationToken ct)
    {
        var cover = new PrescriptionCover(
            await records.LockActivePrescriptionsAsync(petId, now, scope, ct));

        foreach (var line in rxLines)
        {
            var covered = cover.Cover(line.Slug, line.Quantity);

            var spentAll = covered.Outcome == PrescriptionCover.Outcome.Covered;
            foreach (var use in covered.Uses)
            {
                if (!spentAll) break;
                spentAll = await records.TryUseRefillsAsync(use.RecordId, use.Count, scope, ct);
            }

            if (!spentAll)
            {
                var problem = new CartProblemDto(
                    line.ProductId, CartProblemCodes.PrescriptionRequired,
                    PrescriptionCover.Message(covered, line.Name, line.Quantity));

                return new(null, OrderFailure.Unavailable, Quote: quote with
                {
                    Lines = [.. quote.Lines.Where(l => l.ProductId != line.ProductId)],
                    Problems = [problem],
                });
            }
        }

        return null;
    }

    // ── Payment ──────────────────────────────────────────────────────────

    /// <summary>
    /// Create the intent, record it in the ledger, and settle inline if the
    /// provider is synchronous. Null when the provider could not start a
    /// payment — the order stays at <c>pending_payment</c>, holding its stock.
    ///
    /// A synchronous provider settles through exactly the same path an
    /// asynchronous one's webhook will in M7, so the demo cannot quietly diverge
    /// from production.
    /// </summary>
    private async Task<PaymentHandoffDto?> StartPaymentAsync(
        string userId, string orderId, int totalCents, CancellationToken ct)
    {
        PaymentIntent intent;
        try
        {
            intent = await provider.CreateIntentAsync(
                totalCents, Currency, orderId, userId, idempotencyKey: orderId, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return null;
        }

        var now = Ids.Now();

        await using (var scope = await unitOfWork.BeginAsync(ct))
        {
            await payments.CreateAsync(new PaymentEntity
            {
                Id = Ids.New("pay"),
                UserId = userId,
                Kind = "order",
                OrderId = orderId,
                Provider = provider.Name,
                ProviderRef = intent.Ref,
                Status = PaymentStatuses.Unpaid,
                AmountCents = totalCents,
                AmountRefundedCents = 0,
                Currency = intent.Currency,
                CreatedAt = now,
                UpdatedAt = now,
                SucceededAt = null,
            }, scope, ct);

            await orders.SetPaymentAsync(
                orderId, PaymentStatuses.Unpaid, intent.Ref, releaseHold: false, scope, ct);

            await scope.CommitAsync(ct);
        }

        if (!provider.Asynchronous && intent.Status == IntentStatuses.Succeeded)
            await lifecycle.SettleAsync(orderId, ct);

        return new PaymentHandoffDto(intent.Ref, intent.ClientSecret, provider.Name);
    }

    /// <summary><c>admin</c> passes too — see <see cref="IAccessService.HasStaffRoleAsync"/>.</summary>
    private Task<bool> IsOpsAsync(string callerId, CancellationToken ct)
        => access.HasStaffRoleAsync(callerId, StaffRoles.Ops, ct: ct);
}
