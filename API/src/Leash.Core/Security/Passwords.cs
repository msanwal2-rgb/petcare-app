namespace Leash.Core.Security;

/// <summary>
/// Password hashing.
///
/// bcrypt, at cost 10, matching the reference project exactly — because the
/// seeded and demo accounts carry hashes it produced and those must keep
/// verifying. BCrypt.Net-Next reads the <c>$2a$</c> and <c>$2b$</c> prefixes
/// bcryptjs wrote without any migration step, which is the whole reason the
/// database could be lifted across unchanged.
///
/// Not Argon2id or ASP.NET's PBKDF2 identity hasher, both of which would be
/// defensible for a greenfield build: either one would invalidate every
/// existing hash, and "everyone must reset their password" is a migration, not
/// a code change. If it is ever worth moving, the move is to re-hash on next
/// successful sign-in rather than to switch the verifier.
/// </summary>
public static class Passwords
{
    private const int WorkFactor = 10;

    public static string Hash(string plain)
        => BCrypt.Net.BCrypt.HashPassword(plain, WorkFactor);

    /// <summary>
    /// Verify a password against a stored hash.
    ///
    /// Returns false rather than throwing on a malformed hash. A row whose hash
    /// cannot be parsed is a data problem, and the right behaviour for a sign-in
    /// attempt against it is the same as for a wrong password — not a 500 that
    /// tells the caller this account is unusual.
    /// </summary>
    public static bool Verify(string plain, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(plain, hash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            return false;
        }
    }
}
