namespace Leash.Core.Models.Dtos;

/// <summary>
/// The household's own vet, as the client reads it. Nested in
/// <see cref="PetDto"/> rather than flattened to <c>vetName</c>/<c>vetPhone</c>
/// because that is the shape <c>web/src/types/index.ts</c> already declares, and
/// the columns are flat only because Prisma emitted them that way.
/// </summary>
public sealed record VetContactDto(string Name, string Phone);

/// <summary>
/// One animal, as every screen that shows one reads it.
///
/// Note what is <b>not</b> here: <c>ownedSince</c>. It is an authorization
/// input, not a display field (REQUIREMENTS.md section 4) — the predicates in
/// <see cref="Services.Interfaces.IAccessService"/> read it, no client has a use
/// for it, and putting it on the wire invites somebody to send it back.
/// </summary>
public sealed record PetDto(
    string Id,
    string OwnerId,
    string Name,
    string Species,
    string Breed,
    string Sex,
    DateOnly Dob,
    int WeightLbs,
    string PhotoUrl,
    bool Vaccinated,
    string[] Allergies,
    string[] Medications,
    string BehaviorNotes,
    string FeedingInstructions,
    VetContactDto VetContact);

/// <summary>
/// A new pet. <b>No <c>ownerId</c>, by construction</b> — the route owns it.
///
/// The reference implementation had a transfer backdoor here worth remembering:
/// its patch schema accepted <c>ownerId</c>, the update wrote it, and the route
/// checked only that the caller was the <i>outgoing</i> owner. Any user could
/// hand an animal to any user id — no consent from the recipient, no audit, no
/// notification — and the edit form spread <c>ownerId</c> into every payload, so
/// a stale prop could do it by accident.
///
/// Ownership moves in exactly one place: an adoption transfer (M10), which moves
/// <c>ownedSince</c> with it in the same write.
/// </summary>
public sealed record PetInputRequest(
    string Name,
    string Species,
    string Breed,
    string Sex,
    DateOnly Dob,
    int WeightLbs,
    string PhotoUrl,
    bool Vaccinated,
    string[] Allergies,
    string[] Medications,
    string BehaviorNotes,
    string FeedingInstructions,
    VetContactDto VetContact);

/// <summary>
/// A partial edit. Every property is nullable and only the ones present are
/// written, so <c>{ "weightLbs": 70 }</c> leaves the other thirteen alone.
///
/// Mirrors <see cref="PetInputRequest"/> field for field and carries no
/// <c>ownerId</c> for the same reason. An unknown property is rejected rather
/// than ignored — see <c>Validation/PetValidators.cs</c>.
/// </summary>
public sealed record PetPatchRequest(
    string? Name,
    string? Species,
    string? Breed,
    string? Sex,
    DateOnly? Dob,
    int? WeightLbs,
    string? PhotoUrl,
    bool? Vaccinated,
    string[]? Allergies,
    string[]? Medications,
    string? BehaviorNotes,
    string? FeedingInstructions,
    VetContactDto? VetContact);
