using Leash.Core.Models.Dtos;

namespace Leash.Core.Models.Entities;

/// <summary>
/// The <c>orders</c> row.
///
/// Every money column is integer cents and every one is <b>computed by the
/// server</b> — there is no request type with a field that reaches any of them
/// (REQUIREMENTS.md S10).
/// </summary>
public class OrderEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Status { get; set; } = "";
    public string PaymentStatus { get; set; } = "";
    public string? PaymentRef { get; set; }
    public int SubtotalCents { get; set; }
    public int ShippingCents { get; set; }
    public int TaxCents { get; set; }
    public int TotalCents { get; set; }
    public string ShipName { get; set; } = "";
    public string ShipLine1 { get; set; } = "";
    public string ShipLine2 { get; set; } = "";
    public string ShipCity { get; set; } = "";
    public string ShipState { get; set; } = "";
    public string ShipPostalCode { get; set; } = "";
    public string ShipCountry { get; set; } = "";
    public string ShipPhone { get; set; } = "";
    public string DeliveryInstructions { get; set; } = "";
    public string? Carrier { get; set; }
    public string? TrackingNumber { get; set; }
    public DateTimeOffset PlacedAt { get; set; }
    public DateTimeOffset? EstimatedDeliveryAt { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }

    /// <summary>
    /// When an unpaid order's stock hold lapses. <b>Null means the hold is
    /// over</b> — either the order was paid (the goods are sold) or the stock
    /// was already given back. Clearing it is what stops a second reclaim of the
    /// same order returning the stock twice.
    /// </summary>
    public DateTimeOffset? ReservationExpiresAt { get; set; }

    /// <summary>
    /// Membership benefits that priced this order, snapshotted — a membership
    /// that lapses next month must not rewrite what this order cost. Always
    /// empty until M7.
    /// </summary>
    public string[] BenefitsApplied { get; set; } = [];

    public OrderDto ToDto(
        IReadOnlyList<OrderItemEntity> items, IReadOnlyList<OrderEventEntity> events) => new(
        Id, UserId, Status, PaymentStatus, PaymentRef,
        SubtotalCents, ShippingCents, TaxCents, TotalCents,
        new ShippingAddressDto(
            ShipName, ShipLine1, ShipLine2, ShipCity, ShipState,
            ShipPostalCode, ShipCountry, ShipPhone),
        DeliveryInstructions, Carrier, TrackingNumber,
        PlacedAt, EstimatedDeliveryAt, DeliveredAt,
        [.. items.Select(i => i.ToDto())],
        [.. events.Select(e => e.ToDto())]);
}

/// <summary>
/// One line of an order — <b>a snapshot at purchase</b> (REQUIREMENTS.md S11).
///
/// Name, brand, image, slug and unit price are copied from the product as it
/// was, not joined to it as it is. A later catalogue edit must never change
/// what a customer was charged or what their order history says they bought.
/// </summary>
public class OrderItemEntity
{
    public string Id { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string ProductId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Brand { get; set; } = "";
    public string ImageUrl { get; set; } = "";
    public string Slug { get; set; } = "";
    public int UnitPriceCents { get; set; }
    public int Quantity { get; set; }
    public int LineTotalCents { get; set; }

    public OrderItemDto ToDto() => new(
        Id, OrderId, ProductId, Name, Brand, ImageUrl, Slug,
        UnitPriceCents, Quantity, LineTotalCents);
}

/// <summary>
/// One customer-visible step in an order's journey (REQUIREMENTS.md S14).
/// Every status change writes one, so the tracking page is an honest log rather
/// than a status with a guess at how it got there.
/// </summary>
public class OrderEventEntity
{
    public string Id { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string Status { get; set; } = "";
    public string Label { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Location { get; set; }
    public DateTimeOffset OccurredAt { get; set; }

    public OrderEventDto ToDto() => new(Id, OrderId, Status, Label, Description, Location, OccurredAt);
}

/// <summary>
/// The <c>payments</c> row — the ledger (REQUIREMENTS.md M4). One per
/// attempt to take money: an order's intent, a membership invoice, an adoption
/// fee. Its status is written only by <c>PaymentLedger</c>, through the
/// transition table. The client secret is never a column (M5).
/// </summary>
public class PaymentEntity
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? OrderId { get; set; }
    public string? SubscriptionId { get; set; }
    public string? AdoptionApplicationId { get; set; }
    public string ProviderCustomerId { get; set; } = "";
    public string MethodBrand { get; set; } = "";
    public string MethodLast4 { get; set; } = "";
    public string FailureCode { get; set; } = "";
    public string FailureMessage { get; set; } = "";
    public DateTimeOffset? LastEventAt { get; set; }
    public string Provider { get; set; } = "";
    public string ProviderRef { get; set; } = "";
    public string Status { get; set; } = "";
    public int AmountCents { get; set; }
    public int AmountRefundedCents { get; set; }
    public string Currency { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? SucceededAt { get; set; }
}
