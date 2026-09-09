/**
 * Full Auth.js config (Node runtime). Adds the Credentials provider (email +
 * password, verified against our Postgres users table via bcrypt) and — only
 * when configured — the Google OAuth provider. Sessions are JWT; we own the
 * user records ourselves (no database adapter), keying everything on users.id.
 */

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { linkOrCreateOAuthUser, verifyCredentials } from "@/lib/server/auth-logic";
import { RATE_LIMITS, consume, clear, subjectKey } from "@/lib/server/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { nowIso } from "@/lib/server/ids";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Google is added only when its credentials are present, so the app stays
 * healthy before the OAuth app exists.
 *
 * To switch it on: create a client at
 * https://console.cloud.google.com/apis/credentials (Web application), add
 * `<origin>/api/auth/callback/google` as an authorised redirect URI for both
 * production and localhost, then set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.
 * Full walkthrough in docs/going-live.md. No code change is needed — the
 * button on /login and /signup asks getProviders() whether to render.
 */
const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
);

/**
 * Auth.js turns a thrown CredentialsSignin into `?error=<code>` on the sign-in
 * page without saying which account it applied to, which is what we want: the
 * user sees "too many attempts", an attacker learns nothing about whether the
 * address exists.
 */
class TooManyAttempts extends CredentialsSignin {
  code = "RateLimited";
}

const providers = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;

      // Per address, so one account cannot be ground down by guessing. The
      // matching per-client limit lives in the /login route's own guard: a
      // provider callback has no access to the request headers here.
      const key = subjectKey(parsed.data.email);
      const verdict = await consume(RATE_LIMITS.signinEmail, key);
      if (!verdict.allowed) throw new TooManyAttempts();

      const user = await verifyCredentials(parsed.data.email, parsed.data.password);
      if (!user) return null;

      // A correct password clears the counter, so someone who mistypes twice
      // and then gets it right starts fresh. An attacker never reaches here.
      await clear(RATE_LIMITS.signinEmail, key);
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: nowIso() },
      });

      return { id: user.id, name: user.name, email: user.email, image: user.avatarUrl };
    },
  }),
  // Google is added only when its credentials are present, so the app stays
  // healthy before the OAuth app is set up. Reads AUTH_GOOGLE_ID/SECRET.
  //
  // Note the absence of `allowDangerousEmailAccountLinking`. It used to be set
  // here, and combined with a lookup by email it let a Google sign-in assume any
  // pre-existing password account at the same address. Linking rules now live in
  // `linkOrCreateOAuthUser`, which refuses exactly that case.
  ...(googleEnabled ? [Google({ allowDangerousEmailAccountLinking: false })] : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      // `sub` is Google's stable identifier for the account. The email can
      // change; this cannot, which is why it is what we store the link against.
      const googleId = profile?.sub ?? account.providerAccountId;
      if (!user.email || !googleId) return "/login?error=OAuthAccountNotLinked";

      const result = await linkOrCreateOAuthUser({
        email: user.email,
        // Google sends this as a boolean, but has historically sent the string
        // "true" through some paths; treat anything else as unverified.
        emailVerified: profile?.email_verified === true,
        googleId,
        name: user.name,
        image: user.image,
      });

      if (!result.ok) {
        // Returning a path sends the user there instead of signing them in.
        return result.reason === "account_exists"
          ? "/login?error=AccountExists"
          : "/login?error=EmailUnverified";
      }

      // Swap in our own id so the jwt callback stores it, not Google's.
      user.id = result.user.id;
      await prisma.user.update({
        where: { id: result.user.id },
        data: { lastLoginAt: nowIso() },
      });
      return true;
    },
  },
});
