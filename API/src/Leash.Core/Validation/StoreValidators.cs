using FluentValidation;
using Leash.Core.Models.Dtos;
using Leash.Core.Models.Enums;

namespace Leash.Core.Validation;

/// <summary>
/// One cart line. Shape only — whether the product exists, is in stock, or
/// needs a prescription is the quote's job, and it answers with a structured
/// problem per line rather than a 400 the cart cannot act on.
/// </summary>
public sealed class CartLineValidator : AbstractValidator<CartLineInput>
{
    /// <summary>
    /// The cart client caps a line at 20; the server's bound is looser on
    /// purpose — a sanity limit against a request for ten thousand units, not a
    /// store policy.
    /// </summary>
    public const int MaxQuantity = 99;

    public CartLineValidator()
    {
        RuleFor(l => l.ProductId).NotEmpty();
        RuleFor(l => l.Quantity)
            .InclusiveBetween(1, MaxQuantity)
            .WithMessage($"Quantity is between 1 and {MaxQuantity}");
    }
}

/// <summary>The rules every basket shares, so a quote and an order cannot disagree about them.</summary>
public static class Basket
{
    /// <summary>A basket, not a warehouse order.</summary>
    public const int MaxLines = 50;

    public static bool Bounded(CartLineInput[] items) => items.Length <= MaxLines;

    /// <summary>
    /// Two lines for the same product would each pass the stock check alone and
    /// could together oversell it. One product, one line, one quantity.
    /// </summary>
    public static bool Distinct(CartLineInput[] items)
        => items.Select(i => i.ProductId).Distinct(StringComparer.Ordinal).Count() == items.Length;
}

public sealed class QuoteRequestValidator : AbstractValidator<QuoteRequest>
{
    public QuoteRequestValidator()
    {
        RuleFor(q => q.Items)
            .Cascade(CascadeMode.Stop)
            .NotNull()
            .Must(Basket.Bounded).WithMessage($"A basket holds at most {Basket.MaxLines} products")
            .Must(Basket.Distinct).WithMessage("The same product is listed twice");

        RuleForEach(q => q.Items).SetValidator(new CartLineValidator());
    }
}

/// <summary>
/// An order. <b>No rules about money, because there is no money on it</b>
/// (REQUIREMENTS.md S10) — the server re-prices from the catalogue and the type
/// has nowhere to put a client's figure.
/// </summary>
public sealed class CreateOrderValidator : AbstractValidator<CreateOrderRequest>
{
    public CreateOrderValidator()
    {
        // An empty basket is allowed through to the service on purpose: it
        // answers with its own "empty" refusal, which is what the reference's
        // suite and the cart both expect.
        RuleFor(o => o.Items)
            .Cascade(CascadeMode.Stop)
            .NotNull()
            .Must(Basket.Bounded).WithMessage($"A basket holds at most {Basket.MaxLines} products")
            .Must(Basket.Distinct).WithMessage("The same product is listed twice");

        RuleForEach(o => o.Items).SetValidator(new CartLineValidator());

        RuleFor(o => o.ShippingAddress).NotNull().WithMessage("Where should we send it?");

        RuleFor(o => o.ShippingAddress.Name)
            .NotEmpty().WithMessage("Who is it for?").MaximumLength(120)
            .When(o => o.ShippingAddress is not null);
        RuleFor(o => o.ShippingAddress.Line1)
            .NotEmpty().WithMessage("Add a street address").MaximumLength(200)
            .When(o => o.ShippingAddress is not null);
        RuleFor(o => o.ShippingAddress.City)
            .NotEmpty().WithMessage("Add a city").MaximumLength(120)
            .When(o => o.ShippingAddress is not null);
        RuleFor(o => o.ShippingAddress.State)
            .NotEmpty().WithMessage("Add a state").MaximumLength(64)
            .When(o => o.ShippingAddress is not null);
        RuleFor(o => o.ShippingAddress.PostalCode)
            .NotEmpty().WithMessage("Add a postal code").MaximumLength(20)
            .When(o => o.ShippingAddress is not null);

        RuleFor(o => o.DeliveryInstructions!).MaximumLength(500)
            .When(o => o.DeliveryInstructions is not null);
    }
}

public sealed class UpdateOrderStatusValidator : AbstractValidator<UpdateOrderStatusRequest>
{
    public UpdateOrderStatusValidator()
    {
        RuleFor(r => r.Status)
            .Must(OrderStatuses.IsValid)
            .WithMessage($"Status must be one of: {string.Join(", ", OrderStatuses.All)}");

        RuleFor(r => r.Location!).MaximumLength(200).When(r => r.Location is not null);
        RuleFor(r => r.Carrier!).MaximumLength(120).When(r => r.Carrier is not null);
        RuleFor(r => r.TrackingNumber!).MaximumLength(120).When(r => r.TrackingNumber is not null);
    }
}
