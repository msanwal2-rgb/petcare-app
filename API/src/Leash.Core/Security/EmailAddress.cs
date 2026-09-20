namespace Leash.Core.Security;

/// <summary>
/// The canonical form of an email address.
///
/// Its own type, rather than a static on the repository, because both the
/// repository and the services need it and a service has no business referencing
/// a concrete repository for a string helper.
///
/// Addresses are stored already normalised, so every lookup is a straight
/// equality match on the unique index — a <c>lower(email)</c> in the WHERE
/// clause could not use that index.
/// </summary>
public static class EmailAddress
{
    public static string Normalize(string email) => email.Trim().ToLowerInvariant();
}
