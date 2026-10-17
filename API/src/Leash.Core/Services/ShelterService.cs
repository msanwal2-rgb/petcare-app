using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

/// <summary>
/// Shelter profiles. See <see cref="IShelterService"/>. The mirror of
/// <see cref="VetService"/>, as the reference's <c>shelters.ts</c> mirrors
/// <c>vets.ts</c>.
/// </summary>
public sealed class ShelterService(
    IShelterRepository shelters,
    IUnitOfWork unitOfWork) : IShelterService
{
    public async Task<ShelterSearchPage> SearchAsync(ShelterSearchQuery query, CancellationToken ct = default)
    {
        var (rows, next) = await shelters.SearchAsync(query, ct: ct);
        return new ShelterSearchPage([.. rows.Select(r => r.ToDto())], next);
    }

    public async Task<ShelterWithUserDto?> GetAsync(string shelterId, CancellationToken ct = default)
        => (await shelters.GetRowAsync(shelterId, ct: ct))?.ToDto();

    public async Task<ShelterProfileDto?> GetByUserAsync(string userId, CancellationToken ct = default)
        => (await shelters.GetByUserIdAsync(userId, ct: ct))?.ToDto();

    public async Task<(ShelterProfileDto? Profile, AdoptionRefusal? Refusal)> UpsertAsync(
        string callerId, string userId, ShelterPatchRequest patch, CancellationToken ct = default)
    {
        if (callerId != userId) return (null, AdoptionFailure.NotYours);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var profile = await shelters.GetByUserIdAsync(userId, scope, ct)
            ?? await shelters.CreateAsync(new ShelterProfileEntity
            {
                // Blank but coherent: a shelter that saves a half-filled form
                // gets a row, not a constraint violation. Unverified until staff
                // say otherwise (V11), and 100% until anybody has applied.
                Id = Ids.New("sh"),
                UserId = userId,
                Name = "",
                Bio = "",
                Kind = ShelterKinds.Rescue,
                RegistrationNumber = "",
                RegistrationState = "",
                VerificationStatus = BackgroundCheckStatuses.None,
                AcceptedSpecies = [],
                WebsiteUrl = "",
                Phone = "",
                Email = "",
                AddressLine = "",
                City = "",
                State = "",
                Lat = 0,
                Lng = 0,
                AdoptionPolicy = "",
                ResponseRatePct = 100,
                CreatedAt = Ids.Now(),
            }, scope, ct);

        var a = patch.Address;
        var updated = await shelters.UpdateAsync(profile.Id, new ShelterPatch(
            patch.Name?.Trim(), patch.Bio, patch.Kind, patch.RegistrationNumber,
            patch.RegistrationState, patch.AcceptedSpecies, patch.WebsiteUrl, patch.Phone?.Trim(),
            patch.Email?.Trim(), a?.Line, a?.City, a?.State, a?.Lat, a?.Lng, patch.AdoptionPolicy),
            scope, ct) ?? profile;

        await scope.CommitAsync(ct);
        return (updated.ToDto(), null);
    }
}
