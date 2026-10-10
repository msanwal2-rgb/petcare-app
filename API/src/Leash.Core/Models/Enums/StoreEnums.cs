namespace Leash.Core.Models.Enums;

/// <summary>The catalogue's shelves (REQUIREMENTS.md S1).</summary>
public static class ProductCategories
{
    public const string DryFood = "dry_food";
    public const string WetFood = "wet_food";
    public const string Treats = "treats";
    public const string Supplements = "supplements";
    public const string PrescriptionDiet = "prescription_diet";
    public const string Dental = "dental";
    public const string Accessories = "accessories";

    public static readonly string[] All =
        [DryFood, WetFood, Treats, Supplements, PrescriptionDiet, Dental, Accessories];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// How the catalogue grid may be ordered (REQUIREMENTS.md S2).
///
/// Each one is a keyset in <see cref="Repositories.CatalogRepository"/>, so
/// adding a sort is adding a key and a direction there — not a string here
/// that the SQL silently ignores.
/// </summary>
public static class ProductSorts
{
    /// <summary>Well reviewed first. What the grid leads with.</summary>
    public const string Featured = "featured";
    public const string PriceAsc = "price_asc";
    public const string PriceDesc = "price_desc";
    public const string Rating = "rating";
    public const string Newest = "newest";

    public static readonly string[] All = [Featured, PriceAsc, PriceDesc, Rating, Newest];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// The order lifecycle (REQUIREMENTS.md §11.3).
///
/// The transition table lives in <see cref="Services.OrderService"/>, not here,
/// because it is a rule. This is only the vocabulary.
/// </summary>
public static class OrderStatuses
{
    public const string PendingPayment = "pending_payment";
    public const string Paid = "paid";
    public const string Processing = "processing";
    public const string Packed = "packed";
    public const string Shipped = "shipped";
    public const string OutForDelivery = "out_for_delivery";
    public const string Delivered = "delivered";
    public const string Cancelled = "cancelled";
    public const string Refunded = "refunded";

    public static readonly string[] All =
    [
        PendingPayment, Paid, Processing, Packed, Shipped, OutForDelivery,
        Delivered, Cancelled, Refunded,
    ];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// Where a payment stands. The full vocabulary the web contract declares —
/// M6 writes only <c>unpaid</c>, <c>paid</c> and <c>refunded</c>, because the
/// demo provider settles synchronously and refunds in full. The other seven are
/// states a real card payment passes through, and M7 is where they get written
/// and where the transition table between them is enforced.
/// </summary>
public static class PaymentStatuses
{
    public const string Unpaid = "unpaid";
    public const string Pending = "pending";
    public const string RequiresAction = "requires_action";
    public const string Processing = "processing";
    public const string Authorized = "authorized";
    public const string Paid = "paid";
    public const string PartiallyRefunded = "partially_refunded";
    public const string Refunded = "refunded";
    public const string Failed = "failed";
    public const string Disputed = "disputed";
}

/// <summary>Why a cart line could not be priced. The client keys its copy on these.</summary>
public static class CartProblemCodes
{
    public const string NotFound = "not_found";
    public const string Inactive = "inactive";
    public const string OutOfStock = "out_of_stock";
    public const string InsufficientStock = "insufficient_stock";
    public const string PrescriptionRequired = "prescription_required";
}
