using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// The authorization predicates: "may this user touch this record?"
///
/// A port of the reference project's <c>lib/server/access.ts</c>, kept
/// case-for-case with it and with <c>tests/access.test.ts</c>. Read
/// <see cref="IAccessService"/> for the contract; this file is about the two
/// rules that are easy to get subtly wrong.
///
/// ── Rule one: a profile id is not a user id ──
///
/// <c>bookings."caretakerId"</c> is a <c>caretaker_profiles</c> id and
/// <c>vet_appointments."vetId"</c> is a <c>vet_profiles</c> id. Every predicate
/// that compares a caller against one of them resolves the profile to its user
/// first. The failure mode of forgetting is a check that answers "no" to
/// everybody, which reads as a permissions bug rather than as what it is.
///
/// ── Rule two: <c>pets."ownedSince"</c> is an authorization input ──
///
/// It is not a display field. It is the instant the <i>current</i> owner took
/// the animal on, and it is what makes a caretaker's or a vet's derived access
/// <b>end</b> when a pet changes hands. Both engagement-based predicates
/// require the engagement granting access to have been created <b>at or
/// after</b> it.
///
/// It was chosen over the more obvious rule — match the engagement's
/// <c>ownerId</c> to the pet's current <c>ownerId</c> — because that version
/// depends on a <i>mutable</i> column. Somebody reasonably backfilling
/// <c>bookings."ownerId"</c> after a transfer would silently restore every
/// grant this exists to end, and nothing would fail. <c>createdAt</c> is
/// written once and never touched.
///
/// Without it, adopting an animal hands every caretaker and vet who ever dealt
/// with it at the shelter a permanent key to the adopter's household: the
/// medications, the behaviour notes, the household vet's phone number, and —
/// through <see cref="CanAccessPetRecordsAsync"/>, which gates <i>write</i>
/// access to the health record — the ability to keep writing prescriptions,
/// which is what unlocks Rx-only products in the store.
///
/// <b>Known limitation, carried forward deliberately (REQUIREMENTS.md section
/// 4):</b> this ends access that outlives <i>ownership</i>, not access that
/// outlives <i>time</i>. Under a single owner, a vet who saw a pet once years
/// ago keeps record access indefinitely. A trailing window on
/// <see cref="CanAccessPetRecordsAsync"/> is the fix if it is ever prioritised.
/// Do not regress the ownership bound while reaching for it.
/// </summary>
public sealed class AccessService(IUserRepository users, IAccessRepository access)
    : IAccessService
{
    /// <summary>
    /// The statuses that void an engagement for authorization purposes.
    ///
    /// A declined booking was never accepted and a cancelled one was called
    /// off, so neither is a reason to be reading an animal's file. Every other
    /// status counts — including <c>requested</c>, which is how the seeded
    /// demo's pending booking still lets a sitter read the feeding instructions
    /// they are being asked to follow, and <c>completed</c>, which is how a vet
    /// keeps the history of a pet they treated.
    ///
    /// Here rather than in the SQL because which statuses void an engagement is
    /// a rule, and rules live in the service (ARCHITECTURE.md section 1). The
    /// repository takes it as an argument.
    /// </summary>
    public static readonly string[] DisqualifyingStatuses =
        [EngagementStatus.Declined, EngagementStatus.Cancelled];

    /// <summary>
    /// Whether the caller holds a staff role.
    ///
    /// <c>admin</c> satisfies every staff check (REQUIREMENTS.md A12), so a
    /// caller with <c>admin</c> passes a test for <c>finance</c>. That is the
    /// rule rather than an accident: there is no privilege an administrator is
    /// meant to lack, and the alternative — granting an admin every role
    /// explicitly — makes the seed data the source of truth for something that
    /// should be a rule.
    ///
    /// A suspended administrator is not an administrator, so status is part of
    /// the check rather than assumed to have been handled upstream.
    /// </summary>
    public async Task<bool> HasStaffRoleAsync(
        string userId, string role,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var user = await users.GetByIdAsync(userId, scope, ct);
        if (user is null || user.Status != AccountStatus.Active) return false;

        return user.StaffRoles.Contains(role) || user.StaffRoles.Contains(StaffRoles.Admin);
    }

    public async Task<bool> OwnsPetAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var pet = await access.GetPetOwnershipAsync(petId, scope, ct);
        return pet is not null && pet.OwnerId == userId;
    }

    /// <summary>
    /// Owner, caretaker with a qualifying booking, or vet with a qualifying
    /// appointment.
    ///
    /// It exists because the reference project's <c>GET /api/pets/:id</c> was
    /// once entirely public, on the reasoning that a caretaker needs to read
    /// it. So does anyone who can count: the ids are sequential, and the
    /// response carries medications, allergies, behaviour notes and the
    /// household vet's phone number.
    ///
    /// The two derived routes are checked in sequence and <b>both</b> are
    /// reachable — one account may hold a caretaker profile and a vet profile
    /// at once, so failing the caretaker branch must not end the question. The
    /// vet branch is exactly <see cref="CanAccessPetRecordsAsync"/>, reused
    /// rather than restated, so record access always implies view access and
    /// the two cannot drift apart.
    /// </summary>
    public async Task<bool> CanViewPetAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var pet = await access.GetPetOwnershipAsync(petId, scope, ct);
        if (pet is null) return false;
        if (pet.OwnerId == userId) return true;

        var caretakerId = await access.GetCaretakerProfileIdForUserAsync(userId, scope, ct);
        if (caretakerId is not null)
        {
            var booked = await access.HasQualifyingBookingAsync(
                caretakerId, petId, pet.OwnedSince, DisqualifyingStatuses, scope, ct);

            if (booked) return true;
        }

        var records = await RecordAccessForAsync(userId, petId, pet, scope, ct);
        return records.Allowed;
    }

    public async Task<RecordAccess> CanAccessPetRecordsAsync(
        string userId, string petId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var pet = await access.GetPetOwnershipAsync(petId, scope, ct);
        if (pet is null) return RecordAccess.Denied;

        return await RecordAccessForAsync(userId, petId, pet, scope, ct);
    }

    /// <summary>
    /// The body of <see cref="CanAccessPetRecordsAsync"/>, with the pet's
    /// ownership already loaded so <see cref="CanViewPetAsync"/> can reuse it
    /// rather than reading the same row a second time.
    /// </summary>
    private async Task<RecordAccess> RecordAccessForAsync(
        string userId, string petId, PetOwnershipEntity pet,
        ITransactionScope? scope, CancellationToken ct)
    {
        if (pet.OwnerId == userId) return RecordAccess.AsOwner;

        var vetId = await access.GetVetProfileIdForUserAsync(userId, scope, ct);
        if (vetId is null) return RecordAccess.Denied;

        var treating = await access.HasQualifyingAppointmentAsync(
            vetId, petId, pet.OwnedSince, DisqualifyingStatuses, scope, ct);

        return treating ? RecordAccess.AsVet(vetId) : RecordAccess.Denied;
    }

    public async Task<bool> IsBookingParticipantAsync(
        string userId, string bookingId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var booking = await access.GetBookingParticipantsAsync(bookingId, scope, ct);
        if (booking is null) return false;
        if (booking.OwnerId == userId) return true;

        // caretakerId is a profile id, so this is a second lookup rather than a
        // second comparison. See the class docstring, rule one.
        return await OwnsCaretakerProfileAsync(userId, booking.CaretakerId, scope, ct);
    }

    public async Task<bool> IsAppointmentParticipantAsync(
        string userId, string appointmentId,
        ITransactionScope? scope = null, CancellationToken ct = default)
    {
        var appointment = await access.GetAppointmentParticipantsAsync(appointmentId, scope, ct);
        if (appointment is null) return false;
        if (appointment.OwnerId == userId) return true;

        return await OwnsVetProfileAsync(userId, appointment.VetId, scope, ct);
    }

    public async Task<bool> OwnsCaretakerProfileAsync(
        string userId, string caretakerId,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => IsSameUser(
            await access.GetCaretakerProfileUserIdAsync(caretakerId, scope, ct), userId);

    public async Task<bool> OwnsVetProfileAsync(
        string userId, string vetId,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => IsSameUser(
            await access.GetVetProfileUserIdAsync(vetId, scope, ct), userId);

    public async Task<bool> OwnsShelterProfileAsync(
        string userId, string shelterId,
        ITransactionScope? scope = null, CancellationToken ct = default)
        => IsSameUser(
            await access.GetShelterProfileUserIdAsync(shelterId, scope, ct), userId);

    /// <summary>
    /// Is the profile's owner the caller? Refuses when either side is absent.
    ///
    /// The guard is not decoration. The lookups above return null for a profile
    /// that does not exist, so a plain <c>==</c> against a caller id that was
    /// also null would answer <b>true</b>: a nonexistent user granted ownership
    /// of a nonexistent profile. The reference implementation has the same
    /// shape and the same hole — <c>undefined === undefined</c> — and it is
    /// unreachable in both only because every call site gets its id from an
    /// authenticated principal. Authorization code should not depend on that
    /// staying true as the call sites multiply through M3 to M10.
    ///
    /// Ordinal comparison, which is what <c>==</c> on strings does and what is
    /// wanted: these are opaque identifiers, and a culture-aware or
    /// case-insensitive comparison here would be a hole rather than a kindness.
    /// </summary>
    private static bool IsSameUser(string? profileUserId, string? callerId)
        => !string.IsNullOrEmpty(profileUserId)
           && !string.IsNullOrEmpty(callerId)
           && profileUserId == callerId;
}
