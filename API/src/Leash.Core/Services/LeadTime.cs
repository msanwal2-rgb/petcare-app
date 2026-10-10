namespace Leash.Core.Services;

/// <summary>
/// The minimum notice before an engagement may start (REQUIREMENTS.md C13).
///
/// Same-day and next-morning slots are a Leash Plus benefit: a member may book
/// two hours out, everybody else a day. It is enforced rather than decorated,
/// which took choosing a mechanic with teeth — a badge on a card is not a
/// benefit, and neither is a sort order nobody can see.
///
/// ── One definition, both marketplaces ──
///
/// A caretaker booking and a vet appointment share this rule, so they share
/// this file. It was a static on <c>BookingService</c> until M5 needed the same
/// numbers, and two copies of "24" that M7 has to find are exactly the kind of
/// drift the reference implementation had elsewhere.
///
/// <b>The member arm is not wired up yet</b> — entitlements arrive with M7 — so
/// every caller currently passes <c>member: false</c>. This is the one place M7
/// changes: when entitlements exist, the two services ask whether the caller
/// holds <c>priority_booking</c> and pass the answer in. Until then everybody
/// gets the standard window, which is the safe direction: it refuses bookings a
/// member would be allowed to make rather than allowing ones nobody should.
/// </summary>
public static class LeadTime
{
    public const int StandardHours = 24;
    public const int MemberHours = 2;

    /// <summary>The minimum notice this customer must give, in hours.</summary>
    public static int HoursFor(bool member) => member ? MemberHours : StandardHours;

    /// <summary>
    /// The earliest start time this customer may request, measured from
    /// <paramref name="now"/>. Passed in rather than read here so that the two
    /// services take their clock from <c>Ids.Now()</c> like everything else.
    /// </summary>
    public static DateTimeOffset EarliestStart(DateTimeOffset now, bool member)
        => now.AddHours(HoursFor(member));

    public static bool IsMet(DateTimeOffset start, DateTimeOffset now, bool member)
        => start >= EarliestStart(now, member);
}
