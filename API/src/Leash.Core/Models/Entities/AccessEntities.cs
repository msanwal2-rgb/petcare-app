namespace Leash.Core.Models.Entities;

/// <summary>
/// The ownership boundary of one animal: who owns it, and since when.
///
/// Two columns rather than the whole <c>pets</c> row, because this is loaded on
/// the authorization path and the row it comes from carries medications,
/// allergies, behaviour notes and the household vet's phone number — the exact
/// payload <see cref="Services.Interfaces.IAccessService.CanViewPetAsync"/>
/// exists to keep from the wrong reader. A projection that cannot hold them
/// cannot leak them.
///
/// <see cref="OwnedSince"/> is an <b>authorization input, not a display
/// field</b> (REQUIREMENTS.md section 4). It is the instant the current owner
/// took the animal on, and every engagement-derived grant is required to
/// post-date it.
/// </summary>
public class PetOwnershipEntity
{
    public string OwnerId { get; set; } = "";
    public DateTimeOffset OwnedSince { get; set; }
}

/// <summary>
/// The two sides of a booking. <see cref="CaretakerId"/> is a
/// <c>caretaker_profiles</c> id, not a user id — resolving it to the user
/// behind the profile is a second lookup, and forgetting that is how a
/// participant check compares a profile id to a user id and silently answers
/// "no" to everyone.
/// </summary>
public class BookingParticipantsEntity
{
    public string OwnerId { get; set; } = "";
    public string CaretakerId { get; set; } = "";
}

/// <summary>
/// The two sides of a vet appointment. As with
/// <see cref="BookingParticipantsEntity"/>, <see cref="VetId"/> is a
/// <c>vet_profiles</c> id.
/// </summary>
public class AppointmentParticipantsEntity
{
    public string OwnerId { get; set; } = "";
    public string VetId { get; set; } = "";
}
