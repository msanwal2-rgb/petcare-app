using System.Globalization;
using System.Text;

namespace Leash.Core.Persistence;

/// <summary>
/// The keyset cursor every paginated list shares.
///
/// A cursor is the sort key of the last row on the page, encoded so that it
/// reads as one opaque token. Opaque by intent: a client that took it apart
/// would be coupled to a sort order that changes with the filter, and the
/// caretaker search changes its sort depending on whether a location was given.
///
/// <b>Keyset, not offset.</b> <c>OFFSET 200</c> makes the database find and
/// discard two hundred rows to return twenty, and it repeats or skips rows when
/// the underlying set shifts between pages — which it does, because reputations
/// move and appointments get booked. Comparing against the last row's key has
/// neither problem.
///
/// ── Anything unparseable means "start from the beginning" ──
///
/// A cursor is not a credential: it names a position in a result set the caller
/// is already entitled to. Rejecting a garbled one with a 400 gives a caller a
/// way to probe and gives an honest client a dead end when a bookmark ages out.
/// </summary>
public static class Cursor
{
    /// <summary>A timestamp key — <c>(createdAt, id)</c>, <c>(startDateTime, id)</c>.</summary>
    public static string Encode(DateTimeOffset sort, string id)
        => Pack($"{sort.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)}|{id}");

    /// <summary>A numeric key — a distance, or a rating.</summary>
    public static string Encode(double sort, string id)
        => Pack($"{sort.ToString("R", CultureInfo.InvariantCulture)}|{id}");

    public static (DateTimeOffset? Sort, string? Id) DecodeTimestamp(string? cursor)
    {
        var (raw, id) = Unpack(cursor);
        if (raw is null) return (null, null);

        return DateTimeOffset.TryParse(
            raw, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
            out var sort)
            ? (sort, id)
            : (null, null);
    }

    public static (double? Sort, string? Id) DecodeNumber(string? cursor)
    {
        var (raw, id) = Unpack(cursor);
        if (raw is null) return (null, null);

        return double.TryParse(
            raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var sort)
            ? (sort, id)
            : (null, null);
    }

    /// <summary>
    /// A composite key: any number of parts, each already rendered invariant.
    /// The catalogue uses this, because its "featured" ordering is two numbers
    /// deep and because it puts the <i>sort name</i> first — so a cursor minted
    /// under one sort and replayed under another decodes as "start again"
    /// rather than as a position in a different ordering.
    /// </summary>
    public static string EncodeParts(params string[] parts) => Pack(string.Join('|', parts));

    /// <summary>
    /// The parts, or null when the token is malformed or has the wrong number of
    /// them. Ids never contain <c>|</c>, so the split is unambiguous.
    /// </summary>
    public static string[]? DecodeParts(string? cursor, int expected)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return null;

        try
        {
            var padded = cursor.Replace('-', '+').Replace('_', '/')
                .PadRight((cursor.Length + 3) / 4 * 4, '=');
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(padded)).Split('|');
            return parts.Length == expected ? parts : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    /// <summary>
    /// base64url, so the token survives a query string without escaping. The
    /// padding is stripped on the way out and restored on the way in.
    /// </summary>
    private static string Pack(string raw)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(raw))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static (string? Sort, string? Id) Unpack(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return (null, null);

        try
        {
            var padded = cursor.Replace('-', '+').Replace('_', '/')
                .PadRight((cursor.Length + 3) / 4 * 4, '=');
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(padded));

            var split = raw.IndexOf('|');
            return split <= 0 ? (null, null) : (raw[..split], raw[(split + 1)..]);
        }
        catch (FormatException)
        {
            return (null, null);
        }
    }
}
