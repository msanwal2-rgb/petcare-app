namespace Leash.Core.Models.Enums;

/// <summary>What kind of organisation a shelter is (REQUIREMENTS.md R1).</summary>
public static class ShelterKinds
{
    public const string Municipal = "municipal";
    public const string Rescue = "rescue";
    public const string Sanctuary = "sanctuary";
    public const string FosterNetwork = "foster_network";

    public static readonly string[] All = [Municipal, Rescue, Sanctuary, FosterNetwork];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// An adoption listing's lifecycle (REQUIREMENTS.md R3). The transitions live in
/// <see cref="Services.AdoptionListingService"/>.
/// </summary>
public static class ListingStatuses
{
    public const string Draft = "draft";
    public const string Available = "available";

    /// <summary>An applicant is approved. Off the market, not yet adopted out.</summary>
    public const string Pending = "pending";

    public const string Adopted = "adopted";
    public const string Withdrawn = "withdrawn";

    public static readonly string[] All = [Draft, Available, Pending, Adopted, Withdrawn];

    public static bool IsValid(string value) => All.Contains(value);
}

/// <summary>
/// An adoption application's lifecycle (REQUIREMENTS.md R4). The transitions
/// live in <see cref="Services.AdoptionApplicationService"/>.
/// </summary>
public static class ApplicationStatuses
{
    public const string Submitted = "submitted";
    public const string UnderReview = "under_review";
    public const string Approved = "approved";

    /// <summary>Reached only by completing the adoption — never by a status write.</summary>
    public const string Completed = "completed";

    public const string Rejected = "rejected";
    public const string Withdrawn = "withdrawn";

    public static readonly string[] All =
        [Submitted, UnderReview, Approved, Completed, Rejected, Withdrawn];

    /// <summary>Still in somebody's queue: one per person per animal (see the service).</summary>
    public static readonly string[] Open = [Submitted, UnderReview, Approved];

    /// <summary>The statuses a status write may ask for. <c>completed</c> is not one.</summary>
    public static readonly string[] Writable = [UnderReview, Approved, Rejected, Withdrawn];
}

/// <summary>
/// <c>goodWithKids</c> and its siblings (REQUIREMENTS.md R2). <c>unknown</c> is
/// the honest answer for an animal nobody has tested, and a search filter asks
/// for a definite <c>yes</c>.
/// </summary>
public static class TriStates
{
    public const string Yes = "yes";
    public const string No = "no";
    public const string Unknown = "unknown";

    public static readonly string[] All = [Yes, No, Unknown];

    public static bool IsValid(string value) => All.Contains(value);
}

public static class EnergyLevels
{
    public const string Low = "low";
    public const string Moderate = "moderate";
    public const string High = "high";

    public static readonly string[] All = [Low, Moderate, High];

    public static bool IsValid(string value) => All.Contains(value);
}

public static class HomeTypes
{
    public static readonly string[] All = ["house", "apartment", "condo", "other"];

    public static bool IsValid(string value) => All.Contains(value);
}
