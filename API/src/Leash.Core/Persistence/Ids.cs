namespace Leash.Core.Persistence;

/// <summary>
/// Readable ids for records created at runtime, and the one place the clock is
/// read.
///
/// The prefix is inherited from the reference project's seed data (u1, p3,
/// b12…) and kept on purpose: the demo fixtures carry those ids, every screen
/// shows them in URLs, and an id you can read is worth a few bytes when you
/// are reading a log at 2am. The suffix is a UUID rather than a counter
/// because nothing here holds shared state.
///
/// PostgreSQL 18 has <c>uuidv7()</c>, which would be a better scheme for a
/// greenfield schema — time-ordered, index-friendly. It is deliberately not
/// adopted: the ids are application-generated strings the fixtures already
/// contain, so switching would mean rewriting the fixtures for no gain.
/// See BUILD_PLAN.md §3.
/// </summary>
public static class Ids
{
    public static string New(string prefix) => $"{prefix}_{Guid.NewGuid()}";

    /// <summary>
    /// Now, to the millisecond, in UTC.
    ///
    /// Truncated deliberately. <see cref="DateTimeOffset.UtcNow"/> carries
    /// 100-nanosecond ticks, PostgreSQL <c>timestamptz</c> stores microseconds,
    /// and the JSON contract emits three fractional digits — so a value that
    /// goes out over HTTP and comes back from the database is not the value
    /// that went in, and a test comparing them fails for no reason anyone can
    /// see. Truncating at the source makes all three agree.
    /// </summary>
    public static DateTimeOffset Now()
    {
        var now = DateTimeOffset.UtcNow;
        return new DateTimeOffset(
            now.Ticks - (now.Ticks % TimeSpan.TicksPerMillisecond), TimeSpan.Zero);
    }
}
