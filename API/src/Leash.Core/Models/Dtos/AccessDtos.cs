namespace Leash.Core.Models.Dtos;

/// <summary>
/// The answer to "may this caller read this pet's health record?", plus the vet
/// profile id when the answer is yes <i>because</i> of a vet engagement.
///
/// The id comes back rather than being looked up again because the write
/// endpoints that follow this check stamp the record they create with it
/// (<c>medical_records."vetId"</c>). Returning it makes the stamp use the same
/// profile the check passed on; a second lookup is a second chance to stamp a
/// record with a profile that was never authorised.
///
/// <see cref="AsVetId"/> is null when access came from ownership — an owner
/// writing their own pet's record is not writing it as a vet.
/// </summary>
public sealed record RecordAccess(bool Allowed, string? AsVetId)
{
    /// <summary>No access, from any route. The only shape a refusal ever takes.</summary>
    public static RecordAccess Denied { get; } = new(false, null);

    /// <summary>Access as the owner of the animal.</summary>
    public static RecordAccess AsOwner { get; } = new(true, null);

    /// <summary>Access earned by a qualifying appointment, as <paramref name="vetId"/>.</summary>
    public static RecordAccess AsVet(string vetId) => new(true, vetId);
}
