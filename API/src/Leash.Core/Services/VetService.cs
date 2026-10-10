using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Vet profiles. See <see cref="IVetService"/> for the contract.
///
/// Deliberately the mirror of <see cref="CaretakerService"/>, because the two
/// are the same kind of thing and reading one should teach you the other.
/// </summary>
public sealed class VetService(
    IVetRepository vets,
    IUserRepository users,
    IUnitOfWork unitOfWork) : IVetService
{
    public async Task<VetSearchPage> SearchAsync(
        VetSearchQuery query, CancellationToken ct = default)
    {
        var (rows, next) = await vets.SearchAsync(
            new VetSearchFilter(
                query.Lat, query.Lng, query.RadiusMiles, query.Specialty,
                query.Species, query.Mode, query.EmergencyOnly,
                query.Cursor, query.Limit),
            ct: ct);

        // The calendar is fetched per row rather than joined into the search:
        // it is one-to-many, and joining it would multiply the result set and
        // break the LIMIT that makes the page a page.
        var items = new List<VetWithUserDto>(rows.Count);
        foreach (var row in rows)
        {
            items.Add(await ToWithUserAsync(row.Profile, row.User, row.DistanceMiles, ct));
        }

        return new VetSearchPage([.. items], next);
    }

    public async Task<VetWithUserDto?> GetAsync(string vetId, CancellationToken ct = default)
    {
        var profile = await vets.GetByIdAsync(vetId, ct: ct);
        if (profile is null) return null;

        var user = await users.GetByIdAsync(profile.UserId, ct: ct);
        if (user is null) return null;

        return await ToWithUserAsync(profile, user, distanceMiles: null, ct);
    }

    public async Task<VetProfileDto?> GetByUserAsync(
        string userId, CancellationToken ct = default)
    {
        var profile = await vets.GetByUserIdAsync(userId, ct: ct);
        if (profile is null) return null;

        return profile.ToDto(await vets.ListAvailabilityAsync(profile.Id, ct: ct));
    }

    /// <summary>
    /// Create the caller's profile, or edit it.
    ///
    /// One method rather than a POST and a PATCH because there is exactly one
    /// vet profile per user — the column is unique — so "create" and "edit" are
    /// the same intention expressed at different times.
    ///
    /// A brand-new profile starts <b>unverified</b>, with an empty licence
    /// number and no specialties. That is the honest default: the profile is a
    /// claim until somebody checks it, and nothing about signing up should make
    /// it look otherwise.
    /// </summary>
    public async Task<(VetProfileDto? Profile, VetFailure? Failure)> UpsertAsync(
        string callerId, string userId, VetPatchRequest patch,
        CancellationToken ct = default)
    {
        if (callerId != userId) return (null, VetFailure.NotYours);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var profile = await vets.GetByUserIdAsync(userId, scope, ct);

        if (profile is null)
        {
            // responseRatePct starts at 100 for the reason in ReputationService:
            // nobody has asked yet, so nothing has gone unanswered.
            profile = await vets.CreateAsync(new VetProfileEntity
            {
                Id = Ids.New("v"),
                UserId = userId,
                ClinicName = "",
                Bio = "",
                Specialties = [],
                LicenseNumber = "",
                LicenseState = "",
                VerificationStatus = BackgroundCheckStatuses.None,
                YearsExperience = 0,
                AcceptedSpecies = [],
                ConsultModes = [],
                ConsultFeeCents = 0,
                EmergencyAvailable = false,
                ClinicCity = "",
                ClinicState = "",
                Lat = 0,
                Lng = 0,
                Rating = 0,
                ReviewCount = 0,
                ResponseRatePct = 100,
            }, scope, ct);
        }

        var updated = await vets.UpdateAsync(profile.Id, ToPatch(patch), scope, ct) ?? profile;

        if (patch.Availability is not null)
        {
            await vets.ReplaceAvailabilityAsync(
                profile.Id,
                [.. patch.Availability.Select(a => new VetAvailabilityDayEntity
                {
                    Id = Ids.New("vad"),
                    VetId = profile.Id,
                    Date = a.Date,
                    Slots = a.Slots,
                })],
                scope, ct);
        }

        var availability = await vets.ListAvailabilityAsync(profile.Id, scope, ct);

        await scope.CommitAsync(ct);
        return (updated.ToDto(availability), null);
    }

    private async Task<VetWithUserDto> ToWithUserAsync(
        VetProfileEntity profile, UserEntity user, double? distanceMiles,
        CancellationToken ct)
    {
        var availability = await vets.ListAvailabilityAsync(profile.Id, ct: ct);

        return new VetWithUserDto(
            profile.ToDto(availability),
            // The public projection, always. A search result carrying an email
            // address and home coordinates is the mistake M1 fixed on
            // GET /users/{id}, and it would come straight back here.
            user.ToPublicDto(),
            distanceMiles);
    }

    /// <summary>
    /// The wire shape flattened to the column shape.
    ///
    /// <c>clinic</c> is one nested object on the request and five columns in the
    /// table; a patch that omits it must leave all five alone, which is what the
    /// null-propagating member access gives. <c>consultFee</c> crosses from USD
    /// to integer cents here, once.
    /// </summary>
    private static VetPatch ToPatch(VetPatchRequest p) => new(
        p.Bio, p.Specialties, p.LicenseNumber, p.LicenseState, p.YearsExperience,
        p.AcceptedSpecies, p.ConsultModes,
        p.ConsultFee is null
            ? null
            : (int)Math.Round(p.ConsultFee.Value * 100m, MidpointRounding.AwayFromZero),
        p.EmergencyAvailable,
        p.Clinic?.Name, p.Clinic?.City, p.Clinic?.State, p.Clinic?.Lat, p.Clinic?.Lng);
}
