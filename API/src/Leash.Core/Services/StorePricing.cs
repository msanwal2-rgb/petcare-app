namespace Leash.Core.Services;

/// <summary>
/// Store pricing rules (REQUIREMENTS.md S5, S6). All amounts integer cents.
///
/// One definition. The cart page shows an estimate from the same numbers —
/// mirrored in <c>web/src/lib/pricing.ts</c> — but the figure that gets charged
/// is computed here, by <see cref="OrderService.QuoteAsync"/>, from the live
/// catalogue. If the two ever disagree the cart is wrong.
///
/// <c>freeShipping</c> is a plain boolean rather than a membership on purpose:
/// whoever calls this decides whether the customer has earned it. M7 is where
/// the quote starts reading Leash Plus entitlements and passing <c>true</c>;
/// until then nobody is a member, which is the safe direction — it charges
/// shipping a member would have been spared rather than waiving it for
/// somebody who is not one.
/// </summary>
public static class StorePricing
{
    /// <summary>The default. The live value is <c>system_settings</c>, read through <c>ISettingsService</c>.</summary>
    public const int DefaultFreeShippingThresholdCents = 4900;

    public const int FlatShippingCents = 599;

    /// <summary>
    /// 8.25%, as basis points so the arithmetic stays in integers. A single
    /// blended rate; a real store resolves tax per destination, and that is a
    /// tax-provider integration rather than a constant.
    /// </summary>
    public const int TaxRateBasisPoints = 825;

    public static int ShippingFor(int subtotalCents, int thresholdCents, bool freeShipping = false)
    {
        if (freeShipping) return 0;
        return subtotalCents >= thresholdCents ? 0 : FlatShippingCents;
    }

    /// <summary>
    /// Whole cents, rounded half away from zero — the same as JavaScript's
    /// <c>Math.round</c> for the positive amounts a basket produces, so the
    /// cart's estimate and the charge agree to the cent.
    /// </summary>
    public static int TaxFor(int subtotalCents)
        => (int)Math.Round(
            subtotalCents * (decimal)TaxRateBasisPoints / 10_000m,
            MidpointRounding.AwayFromZero);

    /// <summary>
    /// How much more to spend to cross the free-shipping line, or 0 if already
    /// there — <b>including when the customer is a member</b> (REQUIREMENTS.md
    /// S6). A member told to "spend $12 more for free delivery" is the detail
    /// that makes a membership feel fake.
    /// </summary>
    public static int AmountToFreeShipping(int subtotalCents, int thresholdCents, bool freeShipping = false)
        => freeShipping ? 0 : Math.Max(0, thresholdCents - subtotalCents);
}
