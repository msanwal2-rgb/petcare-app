using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Leash.Api.Infrastructure.Json;

/// <summary>
/// Serialises timestamps exactly the way JavaScript's <c>toISOString()</c> does:
/// <c>2026-07-11T09:00:00.000Z</c> — UTC, three fractional digits, a literal Z.
///
/// This is not cosmetic. <see cref="DateTimeOffset"/>'s round-trip format ("O")
/// emits seven fractional digits and <c>+00:00</c>; the ported frontend compares
/// these values as strings in several places, because the reference project
/// stored them as ISO-8601 text and relied on the fact that ISO-8601 sorts
/// lexicographically. A mismatch here does not throw — it silently changes
/// sort order and equality checks.
///
/// Reading is deliberately permissive: anything DateTimeOffset.Parse accepts,
/// normalised to UTC.
/// </summary>
public sealed class IsoDateTimeConverter : JsonConverter<DateTimeOffset>
{
    private const string Format = "yyyy-MM-ddTHH:mm:ss.fffZ";

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type _, JsonSerializerOptions __)
    {
        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw))
            throw new JsonException("Expected an ISO-8601 timestamp, got an empty value.");

        return DateTimeOffset.Parse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal);
    }

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions _)
        => writer.WriteStringValue(value.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture));
}

/// <summary>The nullable arm. Registered separately; the two do not share a converter.</summary>
public sealed class NullableIsoDateTimeConverter : JsonConverter<DateTimeOffset?>
{
    private const string Format = "yyyy-MM-ddTHH:mm:ss.fffZ";

    public override DateTimeOffset? Read(ref Utf8JsonReader reader, Type _, JsonSerializerOptions __)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        var raw = reader.GetString();
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return DateTimeOffset.Parse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal);
    }

    public override void Write(Utf8JsonWriter writer, DateTimeOffset? value, JsonSerializerOptions _)
    {
        if (value is null) writer.WriteNullValue();
        else writer.WriteStringValue(value.Value.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture));
    }
}
