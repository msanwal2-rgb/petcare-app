namespace Leash.Core.Models.Dtos;

/// <summary>
/// A page of the catalogue plus the cursor for the next one.
///
/// <b>A departure from the reference contract</b>, which was
/// <c>{ items, total, limit, offset }</c>. Offset paging repeats or skips rows
/// when the set shifts between pages — and this one does, because stock moves
/// and ratings move — and the <c>total</c> doubles the cost of every page with
/// a <c>COUNT(*)</c>. STATUS.md §5 makes cursor pagination the rule for every
/// list endpoint, so the store follows caretakers and vets.
/// </summary>
public sealed record ProductPage(ProductDto[] Items, string? NextCursor);

/// <summary>What the client sends for one cart line: an id and a quantity. Nothing about money.</summary>
public sealed record CartLineInput(string ProductId, int Quantity);

/// <summary>
/// A request to price a cart.
///
/// <see cref="PetId"/> is what enables the prescription check, and it is
/// checked against the caller before anything else happens — see
/// <see cref="Services.Interfaces.IOrderService"/>.
/// </summary>
public sealed record QuoteRequest(CartLineInput[] Items, string? PetId);

public sealed record QuotedLineDto(
    string ProductId,
    string Slug,
    string Name,
    int UnitPriceCents,
    int Quantity,
    int LineTotalCents,
    bool InStock,
    bool RequiresPrescription);

/// <summary>A line the server would not price, and why. <c>Code</c> is one of <see cref="Enums.CartProblemCodes"/>.</summary>
public sealed record CartProblemDto(string ProductId, string Code, string Message);

/// <summary>
/// A product in the basket containing something the selected pet reacts to
/// (REQUIREMENTS.md S8).
///
/// <b>A warning, not a refusal.</b> An owner may know their dog tolerates a
/// trace of something the allergy list records, or be buying for another
/// animal. What they must not be is <i>unaware</i>. Computed by
/// <see cref="Services.CatalogService.MatchingAllergens"/> — the one allergen
/// match in the codebase (S18); the reference had three, and the client-side
/// copy was the one this replaces.
/// </summary>
public sealed record AllergenWarningDto(string ProductId, string[] Allergens);

/// <summary>Whether the customer pricing this cart is a member. Always inactive until M7.</summary>
public sealed record QuoteMembershipDto(bool Active, string? PlanKey);

/// <summary>
/// The server's price for a cart. <b>This is the authority</b>; the cart's own
/// totals are display-only (REQUIREMENTS.md S3, S4).
/// </summary>
public sealed record CartQuoteDto(
    QuotedLineDto[] Lines,
    int SubtotalCents,
    int ShippingCents,
    int TaxCents,
    int TotalCents,
    CartProblemDto[] Problems,
    AllergenWarningDto[] AllergenWarnings,
    QuoteMembershipDto Membership,
    bool ShippingWaivedByMembership,
    int MembershipSavingsCents,
    /// <summary>
    /// How much more to spend for free shipping; 0 when already there or a
    /// member (S6). On the quote so the cart never has to recompute a
    /// threshold the server reads from settings.
    /// </summary>
    int AmountToFreeShippingCents);

public sealed record ShippingAddressDto(
    string Name,
    string Line1,
    string Line2,
    string City,
    string State,
    string PostalCode,
    string Country,
    string Phone);

/// <summary>
/// Place an order.
///
/// <b>No price field, by construction</b> (REQUIREMENTS.md S10). There is
/// nothing here for a tampered client to set: no total, no unit price, no
/// shipping, no "is a member" flag. The server re-quotes from the live
/// catalogue and charges its own figure.
/// </summary>
public sealed record CreateOrderRequest(
    CartLineInput[] Items,
    ShippingAddressDto ShippingAddress,
    string? DeliveryInstructions,
    string? PetId);

public sealed record OrderItemDto(
    string Id,
    string OrderId,
    string ProductId,
    string Name,
    string Brand,
    string ImageUrl,
    string Slug,
    int UnitPriceCents,
    int Quantity,
    int LineTotalCents);

public sealed record OrderEventDto(
    string Id,
    string OrderId,
    string Status,
    string Label,
    string Description,
    string? Location,
    DateTimeOffset OccurredAt);

public sealed record OrderDto(
    string Id,
    string UserId,
    string Status,
    string PaymentStatus,
    string? PaymentRef,
    int SubtotalCents,
    int ShippingCents,
    int TaxCents,
    int TotalCents,
    ShippingAddressDto ShippingAddress,
    string DeliveryInstructions,
    string? Carrier,
    string? TrackingNumber,
    DateTimeOffset PlacedAt,
    DateTimeOffset? EstimatedDeliveryAt,
    DateTimeOffset? DeliveredAt,
    OrderItemDto[] Items,
    OrderEventDto[] Events);

/// <summary>
/// What the browser needs to finish paying. <see cref="ClientSecret"/> is null
/// for the demo provider, which has already settled; for a real card it
/// authorises confirming this one payment and reaches exactly one response.
/// </summary>
public sealed record PaymentHandoffDto(string Ref, string? ClientSecret, string Provider);

/// <summary>A freshly placed order and its payment handoff.</summary>
public sealed record PlacedOrderDto(OrderDto Order, PaymentHandoffDto Payment);

/// <summary>A page of orders plus the cursor for the next one.</summary>
public sealed record OrderPage(OrderDto[] Items, string? NextCursor);

/// <summary>
/// A staff move of an order. Carrier and tracking number ride along on the move
/// to <c>shipped</c>; location is copied onto the timeline event.
/// </summary>
public sealed record UpdateOrderStatusRequest(
    string Status,
    string? Location,
    string? Carrier,
    string? TrackingNumber);
