using System.Security.Cryptography;
using System.Text;

namespace Leash.Core.Security;

/// <summary>
/// The default avatar for a new account.
///
/// Ported from the reference project's <c>lib/media/photos.ts</c>, which picked
/// from a fixed set of Unsplash headshots. The selection there was
/// <c>HEADSHOTS[userCount % length]</c> — a <c>SELECT count(*)</c> on every
/// signup, and a value that changes meaning as the table grows.
///
/// Keyed on the email address instead: same distribution, no query, and stable
/// — the same account gets the same face if this ever has to be recomputed.
/// </summary>
public static class Avatars
{
    private const string Base = "https://images.unsplash.com";

    /// <summary>Fixed w/h so there is no layout shift when it loads.</summary>
    public static string Unsplash(string id, int w, int h, string crop = "entropy")
        => $"{Base}/{id}?w={w}&h={h}&fit=crop&crop={crop}&auto=format&q=75";

    private static readonly string[] Headshots =
    [
        "photo-1494790108377-be9c29b29330",
        "photo-1500648767791-00dcc994a43e",
        "photo-1438761681033-6461ffad8d80",
        "photo-1507003211169-0a1dd7228f2d",
        "photo-1544005313-94ddf0286df2",
        "photo-1552058544-f2b08422138a",
        "photo-1534528741775-53994a69daeb",
        "photo-1506794778202-cad84cf45f1d",
        "photo-1573497019940-1c28c88b4f3e",
        "photo-1580489944761-15a19d654956",
        "photo-1519085360753-af0119f7cbe7",
        "photo-1607746882042-944635dfe10e",
        "photo-1508214751196-bcfd4ca60f91",
        "photo-1531123897727-8f129e1688ce",
        "photo-1487412720507-e7ab37603c6f",
    ];

    public static string ForNewAccount(string email)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(email));
        var index = digest[0] % Headshots.Length;
        return Unsplash(Headshots[index], 240, 240, "faces");
    }
}
