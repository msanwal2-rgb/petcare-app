using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

public sealed class CaretakerService(
    ICaretakerRepository caretakers,
    IUserRepository users,
    IUnitOfWork unitOfWork) : ICaretakerService
{
    public async Task<CaretakerSearchPage> SearchAsync(
        CaretakerSearchQuery query, CancellationToken ct = default)
    {
        var (rows, next) = await caretakers.SearchAsync(
            new CaretakerSearchFilter(
                query.Lat, query.Lng, query.RadiusMiles, query.ServiceType,
                query.Species, query.StartDate, query.MinPrice, query.MaxPrice,
                query.Cursor, query.Limit),
            ct: ct);

        // The rate card and the calendar are fetched per row rather than joined
        // into the search: both are one-to-many, and joining them would multiply
        // the result set and break the LIMIT that makes the page a page.
        var items = new List<CaretakerWithUserDto>(rows.Count);
        foreach (var row in rows)
        {
            items.Add(await ToWithUserAsync(row.Profile, row.User, row.DistanceMiles, ct));
        }

        return new CaretakerSearchPage([.. items], next);
    }

    public async Task<CaretakerWithUserDto?> GetAsync(
        string caretakerId, CancellationToken ct = default)
    {
        var profile = await caretakers.GetByIdAsync(caretakerId, ct: ct);
        if (profile is null) return null;

        var user = await users.GetByIdAsync(profile.UserId, ct: ct);
        if (user is null) return null;

        return await ToWithUserAsync(profile, user, distanceMiles: null, ct);
    }

    public async Task<CaretakerProfileDto?> GetByUserAsync(
        string userId, CancellationToken ct = default)
    {
        var profile = await caretakers.GetByUserIdAsync(userId, ct: ct);
        if (profile is null) return null;

        var pricing = await caretakers.ListPricingAsync(profile.Id, ct: ct);
        var availability = await caretakers.ListAvailabilityAsync(profile.Id, ct: ct);

        return profile.ToDto(pricing, availability);
    }

    /// <summary>
    /// Create the caller's profile, or edit it.
    ///
    /// One method rather than a POST and a PATCH because there is exactly one
    /// caretaker profile per user — the column is unique — so "create" and
    /// "edit" are the same intention expressed at different times, and a client
    /// should not have to know which it is.
    ///
    /// The whole thing is one transaction: a patch that replaces the rate card
    /// and the calendar is three statements, and a profile that kept its old
    /// prices alongside its new availability would be quoting one thing and
    /// offering another.
    /// </summary>
    public async Task<(CaretakerProfileDto? Profile, CaretakerFailure? Failure)> UpsertAsync(
        string callerId, string userId, CaretakerPatchRequest patch,
        CancellationToken ct = default)
    {
        if (callerId != userId) return (null, CaretakerFailure.NotYours);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var profile = await caretakers.GetByUserIdAsync(userId, scope, ct);

        if (profile is null)
        {
            // Defaults for everything the patch does not mention. responseRatePct
            // starts at 100 for the reason in ReputationService: nobody has asked
            // yet, so nothing has gone unanswered.
            profile = await caretakers.CreateAsync(new CaretakerProfileEntity
            {
                Id = Ids.New("c"),
                UserId = userId,
                Bio = "",
                ServicesOffered = [],
                ServiceRadiusMiles = 10,
                AcceptedSpecies = [],
                FencedYard = false,
                HasOtherPets = false,
                SmokeFree = true,
                Certifications = [],
                BackgroundCheckStatus = BackgroundCheckStatuses.None,
                Rating = 0,
                ReviewCount = 0,
                ResponseRatePct = 100,
            }, scope, ct);
        }

        var updated = await caretakers.UpdateAsync(profile.Id, ToPatch(patch), scope, ct)
            ?? profile;

        if (patch.Pricing is not null)
        {
            await caretakers.ReplacePricingAsync(
                profile.Id,
                [.. patch.Pricing.Select(p => new PricingEntryEntity
                {
                    Id = Ids.New("pe"),
                    CaretakerId = profile.Id,
                    ServiceType = p.ServiceType,
                    Unit = p.Unit,
                    RateCents = (int)Math.Round(p.Rate * 100m, MidpointRounding.AwayFromZero),
                })],
                scope, ct);
        }

        if (patch.Availability is not null)
        {
            await caretakers.ReplaceAvailabilityAsync(
                profile.Id,
                [.. patch.Availability.Select(a => new AvailabilityDayEntity
                {
                    Id = Ids.New("ad"),
                    CaretakerId = profile.Id,
                    Date = a.Date,
                    Slots = a.Slots,
                })],
                scope, ct);
        }

        var pricing = await caretakers.ListPricingAsync(profile.Id, scope, ct);
        var availability = await caretakers.ListAvailabilityAsync(profile.Id, scope, ct);

        await scope.CommitAsync(ct);
        return (updated.ToDto(pricing, availability), null);
    }

    private async Task<CaretakerWithUserDto> ToWithUserAsync(
        CaretakerProfileEntity profile, UserEntity user, double? distanceMiles,
        CancellationToken ct)
    {
        var pricing = await caretakers.ListPricingAsync(profile.Id, ct: ct);
        var availability = await caretakers.ListAvailabilityAsync(profile.Id, ct: ct);

        var rates = pricing.Select(p => p.RateCents).ToArray();
        var range = rates.Length == 0
            ? new PriceRangeDto(0, 0)
            : new PriceRangeDto(rates.Min() / 100m, rates.Max() / 100m);

        return new CaretakerWithUserDto(
            profile.ToDto(pricing, availability),
            // The public projection, always. A search result carrying an email
            // address and home coordinates is the mistake M1 fixed on
            // GET /users/{id}, and it would come straight back here.
            user.ToPublicDto(),
            range,
            distanceMiles);
    }

    private static CaretakerPatch ToPatch(CaretakerPatchRequest p) => new(
        p.Bio, p.ServicesOffered, p.ServiceRadiusMiles, p.AcceptedSpecies,
        p.HomeEnvironment?.FencedYard, p.HomeEnvironment?.HasOtherPets,
        p.HomeEnvironment?.SmokeFree, p.Certifications, p.BackgroundCheckStatus);
}
