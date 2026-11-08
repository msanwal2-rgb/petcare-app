using Leash.Core.Models.Dtos;
using Leash.Core.Models.Entities;
using Leash.Core.Models.Enums;
using Leash.Core.Persistence;
using Leash.Core.Repositories.Interfaces;
using Leash.Core.Security;
using Leash.Core.Services.Interfaces;

namespace Leash.Core.Services;

public sealed class AuthService(
    IUserRepository users,
    IUnitOfWork unitOfWork) : IAuthService
{
    public async Task<UserEntity?> VerifyCredentialsAsync(
        string email, string password, CancellationToken ct = default)
    {
        var row = await users.GetCredentialByEmailAsync(email, ct: ct);

        // Three failures, one answer: unknown address, no password set, wrong
        // password. See IAuthService for why they must stay indistinguishable.
        if (row?.PasswordHash is null) return null;
        if (!Passwords.Verify(password, row.PasswordHash)) return null;

        return row;
    }

    public Task TouchLastLoginAsync(string userId, CancellationToken ct = default)
        => users.TouchLastLoginAsync(userId, Ids.Now(), ct: ct);

    /// <summary>
    /// Create an email and password account.
    ///
    /// The duplicate check and the insert share a transaction. Without it two
    /// simultaneous signups at one address both read "no such user" and the
    /// second fails on the unique index — a 500 where a 409 was meant. The index
    /// is still what guarantees uniqueness; the transaction is what makes the
    /// error correct.
    /// </summary>
    public async Task<UserDto?> RegisterAsync(
        SignupRequest request, CancellationToken ct = default)
    {
        var email = EmailAddress.Normalize(request.Email);

        await using var scope = await unitOfWork.BeginAsync(ct);

        if (await users.GetByEmailAsync(email, scope, ct) is not null) return null;

        var created = await users.CreateAsync(
            new UserEntity
            {
                Id = Ids.New("u"),
                Name = request.Name.Trim(),
                Email = email,
                Phone = request.Phone?.Trim() ?? string.Empty,
                AvatarUrl = Avatars.ForNewAccount(email),
                Roles = request.Roles ?? [],

                // Austin, matching the seed data's centre of gravity, so a new
                // account sees populated search results rather than an empty map
                // before it has set an address. Replaced the moment onboarding
                // writes a real one.
                AddressCity = "Austin",
                AddressState = "TX",
                Lat = 30.2672,
                Lng = -97.7431,

                Verified = false,
                CreatedAt = Ids.Now(),
                StaffRoles = [],
                Status = AccountStatus.Active,
            },
            Passwords.Hash(request.Password),
            googleId: null,
            scope, ct);

        await scope.CommitAsync(ct);
        return created.ToDto();
    }

    /// <summary>
    /// Resolve a Google sign-in to one of our users: link it, or create one.
    ///
    /// The naive version — look up the address, return whatever you find — is
    /// account pre-hijacking. Register a password account at victim@gmail.com
    /// before they ever visit, wait, and when the real owner of that Gmail
    /// address signs in with Google they land inside the account you control,
    /// with your password still on it.
    ///
    /// So an existing row is only ever linked when linking cannot hand someone
    /// else's session over:
    ///
    ///  - already linked to this Google id → sign in, the unambiguous case;
    ///  - no password on the account → link, because nobody can reach it by
    ///    password, so there is no second owner to displace;
    ///  - a password is set → <b>refuse</b> (REQUIREMENTS.md A7). The safe order
    ///    is to sign in with the password you already have and link Google from
    ///    account settings, where the person doing the linking has proved they
    ///    hold the account.
    ///
    /// <c>EmailVerified</c> is Google's own claim and is checked rather than
    /// assumed: Workspace accounts can be created with an address the holder
    /// never confirmed, so an unverified Google address proves nothing about who
    /// reads it.
    ///
    /// All three branches run in one transaction, because each is a
    /// read-then-write on an address that a concurrent signup could be claiming.
    /// </summary>
    public async Task<OAuthResult> LinkOrCreateOAuthUserAsync(
        OAuthIdentity identity, CancellationToken ct = default)
    {
        if (!identity.EmailVerified)
            return new OAuthResult(null, false, OAuthFailure.EmailUnverified);

        var email = EmailAddress.Normalize(identity.Email);

        await using var scope = await unitOfWork.BeginAsync(ct);

        var linked = await users.GetByGoogleIdAsync(identity.GoogleId, scope, ct);
        if (linked is not null)
        {
            await scope.CommitAsync(ct);
            return new OAuthResult(linked.ToDto(), false, null);
        }

        var existing = await users.GetCredentialByEmailAsync(email, scope, ct);
        if (existing is not null)
        {
            if (existing.PasswordHash is not null)
                return new OAuthResult(null, false, OAuthFailure.AccountExists);

            // A guest has no password either (STATUS §3-G), but is not an
            // account Google can be linked to: it cannot hold a session until
            // its owner has set a password from the emailed link.
            if (AccountStatus.IsUnclaimed(existing.Status))
                return new OAuthResult(null, false, OAuthFailure.FinishSetup);

            var adopted = await users.AdoptGoogleIdAsync(existing.Id, identity.GoogleId, scope, ct);
            await scope.CommitAsync(ct);
            return new OAuthResult(adopted!.ToDto(), false, null);
        }

        var created = await users.CreateAsync(
            new UserEntity
            {
                Id = Ids.New("u"),
                Name = string.IsNullOrWhiteSpace(identity.Name)
                    ? email.Split('@')[0]
                    : identity.Name.Trim(),
                Email = email,
                Phone = string.Empty,
                AvatarUrl = string.IsNullOrWhiteSpace(identity.PictureUrl)
                    ? Avatars.ForNewAccount(email)
                    : identity.PictureUrl,
                Roles = [],
                AddressCity = "Austin",
                AddressState = "TX",
                Lat = 30.2672,
                Lng = -97.7431,

                // Google told us it verified this address, and we checked that it
                // said so — so there is nothing left for our own verification
                // email to establish.
                Verified = true,
                CreatedAt = Ids.Now(),
                StaffRoles = [],
                Status = AccountStatus.Active,
            },
            passwordHash: null,
            identity.GoogleId,
            scope, ct);

        await scope.CommitAsync(ct);
        return new OAuthResult(created.ToDto(), true, null);
    }

    public async Task<bool> LinkGoogleToUserAsync(
        string userId, string googleId, CancellationToken ct = default)
    {
        await using var scope = await unitOfWork.BeginAsync(ct);

        var ok = await users.LinkGoogleAsync(userId, googleId, scope, ct);
        if (ok) await scope.CommitAsync(ct);

        return ok;
    }
}
