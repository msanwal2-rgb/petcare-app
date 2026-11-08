using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Security;
using Leash.Core.Services.Interfaces;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Leash.Core.Services;

/// <summary>
/// Booking as a guest (STATUS §3-G). See <see cref="IGuestBookingService"/>.
///
/// ── What a guest is ──
///
/// A booking needs an owner and a pet needs an owner, so a guest is a user
/// row: <c>guest</c>, or <c>pending</c> if they asked to keep their details.
/// Neither has a password, so neither can sign in — the login refuses a
/// missing hash, and the session validator refuses any status but active.
///
/// ── What is never trusted ──
///
/// Nothing proves the person typing owns the email until they use a link we
/// sent to it. So a reused guest row keeps the name and phone it has, and an
/// unclaimed guest's pets are never reused — each booking brings a new pet
/// record. Reusing one by name would let anyone who knows a guest's email and
/// pet's name book a vet for that animal and hand the vet its health record
/// (the owner's decision, 2026-11-08). Once the account is claimed, the email
/// is an account's and the guest route refuses it: they sign in and choose
/// their pet like anybody else.
/// </summary>
public sealed class GuestBookingService(
    IUserRepository users,
    IPetRepository pets,
    ICaretakerRepository caretakers,
    IVetRepository vets,
    IBookingService bookings,
    IAppointmentService appointments,
    INotifier notifier,
    IEmailFlowService emails,
    IUnitOfWork unitOfWork,
    ILogger<GuestBookingService> log) : IGuestBookingService
{
    private const string EmailIndex = "users_email_key";

    public async Task<GuestBookingOutcome> BookCaretakerAsync(
        GuestBookingRequest request, CancellationToken ct = default)
    {
        var d = request.Booking;
        var run = await RunAsync<BookingDto, BookingFailure>(
            request.Guest, request.Pet, request.SaveAccount,
            async (ownerId, petId, petName, scope) =>
            {
                var (booking, failure) = await bookings.CreateInAsync(ownerId,
                    new CreateBookingRequest(d.CaretakerId, [petId], d.ServiceType,
                        d.StartDateTime, d.EndDateTime, d.Notes, d.UtcOffsetMinutes),
                    scope, ct);
                if (failure is not null) return (null, failure);

                var profile = await caretakers.GetByIdAsync(booking!.CaretakerId, scope, ct);
                var name = (await users.GetByIdAsync(profile!.UserId, scope, ct))?.Name ?? "your caretaker";
                return (new Booked<BookingDto>(booking, name,
                    Notices.GuestBookingRequested(booking.Id, name, petName)), null);
            },
            ct);

        return run.Failure is { } guest ? new GuestBookingOutcome(null, guest, null)
            : run.Refused is { } refused ? new GuestBookingOutcome(null, null, refused)
            : new GuestBookingOutcome(
                new GuestBookingResult(run.Booked!.Value, run.Booked.ProviderName, run.PetName!, run.Sent, run.Link),
                null, null);
    }

    public async Task<GuestAppointmentOutcome> BookVetAsync(
        GuestAppointmentRequest request, CancellationToken ct = default)
    {
        var d = request.Appointment;
        var run = await RunAsync<AppointmentTimelineDto, AppointmentFailure>(
            request.Guest, request.Pet, request.SaveAccount,
            async (ownerId, petId, petName, scope) =>
            {
                var (appointment, failure) = await appointments.CreateInAsync(ownerId,
                    new CreateAppointmentRequest(d.VetId, petId, d.Mode, d.Reason, d.Symptoms,
                        d.StartDateTime, d.EndDateTime, d.Notes, d.UtcOffsetMinutes),
                    scope, ct);
                if (failure is not null) return (null, failure);

                var profile = await vets.GetByIdAsync(appointment!.VetId, scope, ct);
                var name = (await users.GetByIdAsync(profile!.UserId, scope, ct))?.Name ?? "your vet";
                return (new Booked<AppointmentTimelineDto>(appointment, name,
                    Notices.GuestAppointmentRequested(appointment.Id, name, petName, appointment.Reason)), null);
            },
            ct);

        return run.Failure is { } guest ? new GuestAppointmentOutcome(null, guest, null)
            : run.Refused is { } refused ? new GuestAppointmentOutcome(null, null, refused)
            : new GuestAppointmentOutcome(
                new GuestAppointmentResult(run.Booked!.Value, run.Booked.ProviderName, run.PetName!, run.Sent, run.Link),
                null, null);
    }

    // ── The shared transaction ───────────────────────────────────────────

    private sealed record Booked<T>(T Value, string ProviderName, NotifyInput Notice);

    private sealed record Run<T, TFailure>(
        Booked<T>? Booked, string? PetName, GuestFailure? Failure, TFailure? Refused, bool Sent, string? Link)
        where TFailure : struct;

    private delegate Task<(Booked<T>? Booked, TFailure? Failure)> BookStep<T, TFailure>(
        string ownerId, string petId, string petName, ITransactionScope scope) where TFailure : struct;

    /// <summary>
    /// The guest, their pet, the booking and the notice in one transaction;
    /// the set-password email after it commits.
    ///
    /// Two first bookings at one new email both read "no such user" and both
    /// insert; the unique index refuses one, whose transaction is then dead,
    /// so it starts again once and finds the other's row.
    /// </summary>
    private async Task<Run<T, TFailure>> RunAsync<T, TFailure>(
        GuestContactRequest contact, GuestPetRequest petInput, bool saveAccount,
        BookStep<T, TFailure> book, CancellationToken ct) where TFailure : struct
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await AttemptAsync(contact, petInput, saveAccount, book, ct);
            }
            catch (PostgresException e) when (
                e.SqlState == PostgresErrorCodes.UniqueViolation && e.ConstraintName == EmailIndex && attempt == 0)
            {
                // Lost the race for the guest row; the winner has committed it.
            }
        }
    }

    private async Task<Run<T, TFailure>> AttemptAsync<T, TFailure>(
        GuestContactRequest contact, GuestPetRequest petInput, bool saveAccount,
        BookStep<T, TFailure> book, CancellationToken ct) where TFailure : struct
    {
        var email = EmailAddress.Normalize(contact.Email);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var user = await users.GetByEmailAsync(email, scope, ct);
        if (user is not null && !AccountStatus.IsUnclaimed(user.Status))
            return new Run<T, TFailure>(null, null, GuestFailure.AccountExists, null, false, null);

        string status;
        if (user is null)
        {
            status = saveAccount ? AccountStatus.Pending : AccountStatus.Guest;
            user = await users.CreateAsync(NewGuest(contact, email, status), passwordHash: null, googleId: null, scope, ct);
        }
        else
        {
            // Never overwritten from the form: nothing proves who typed it.
            status = user.Status;
            if (saveAccount && status == AccountStatus.Guest)
            {
                await users.PromoteGuestToPendingAsync(user.Id, scope, ct);
                status = AccountStatus.Pending;
            }
        }

        // Always a new pet for an unclaimed guest — see the class summary.
        var pet = await pets.CreateAsync(NewPet(user.Id, petInput), scope, ct);

        var (booked, refused) = await book(user.Id, pet.Id, pet.Name, scope);
        if (refused is not null)
            return new Run<T, TFailure>(null, null, null, refused, false, null);   // rolls back the guest and the pet

        await notifier.NotifyAsync(user.Id, booked!.Notice, scope, ct);

        // A pending account gets a fresh link with every booking: the token
        // commits with the booking, and replaces any earlier one.
        var raw = status == AccountStatus.Pending
            ? await emails.IssueSetPasswordTokenAsync(user.Id, scope, ct)
            : null;

        await scope.CommitAsync(ct);

        var (sent, link) = raw is null ? (false, null) : await SendSetupAsync(user, raw, pet.Name, ct);
        return new Run<T, TFailure>(booked, pet.Name, null, null, sent, link);
    }

    /// <summary>
    /// After the commit, and best-effort: a mail outage must not undo a booking
    /// somebody just made. Forgot-password sends a new link.
    /// </summary>
    private async Task<(bool Sent, string? Link)> SendSetupAsync(
        UserEntity user, string raw, string petName, CancellationToken ct)
    {
        try
        {
            var link = await emails.SendAccountSetupAsync(user.Email, user.Name, raw, $"your request for {petName}", ct);
            return (true, link);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            log.LogError(e, "Set-password email failed for guest {UserId}", user.Id);
            return (false, null);
        }
    }

    private static UserEntity NewGuest(GuestContactRequest contact, string email, string status) => new()
    {
        Id = Ids.New("u"),
        Name = contact.Name.Trim(),
        Email = email,
        Phone = contact.Phone.Trim(),
        AvatarUrl = Avatars.ForNewAccount(email),
        Roles = [UserRoles.Owner],

        // Sign-up's default, for the same reason: no address is asked for, and
        // nothing about a booking reads the owner's.
        AddressCity = "Austin",
        AddressState = "TX",
        Lat = 30.2672,
        Lng = -97.7431,

        Verified = false,
        CreatedAt = Ids.Now(),
        StaffRoles = [],
        Status = status,
    };

    private static PetEntity NewPet(string ownerId, GuestPetRequest input) => new()
    {
        Id = Ids.New("p"),
        OwnerId = ownerId,
        OwnedSince = Ids.Now(),
        Name = input.Name.Trim(),
        Species = input.Species,
        Breed = input.Breed.Trim(),
        Sex = input.Sex,
        Dob = input.Dob,
        WeightLbs = input.WeightLbs,
        PhotoUrl = StockPhoto(input.Species),
        Vaccinated = false,
        Allergies = [.. (input.Allergies ?? []).Select(a => a.Trim()).Where(a => a.Length > 0).Distinct()],
        Medications = [],
        BehaviorNotes = input.BehaviorNotes?.Trim() ?? "",
        FeedingInstructions = "",
        VetName = "",
        VetPhone = "",
    };

    /// <summary>The add-pet form's first stock photo for the species (web/src/lib/photos.ts).</summary>
    private static string StockPhoto(string species) => Avatars.Unsplash(species switch
    {
        Species.Cat => "photo-1514888286974-6c03e2ca1dba",
        Species.Other => "photo-1425082661705-1834bfd09dca",
        _ => "photo-1517849845537-4d257902454a",
    }, 900, 700);
}
