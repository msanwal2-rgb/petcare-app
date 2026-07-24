/**
 * Full Auth.js config (Node runtime). Adds the Credentials provider (email +
 * password, verified against our Postgres users table via bcrypt) and — only
 * when configured — the Google OAuth provider. Sessions are JWT; we own the
 * user records ourselves (no database adapter), keying everything on users.id.
 */

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { authConfig } from "./auth.config";
import { findOrCreateOAuthUser, verifyCredentials } from "@/lib/server/auth-logic";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
);

const providers = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const user = await verifyCredentials(parsed.data.email, parsed.data.password);
      if (!user) return null;
      return { id: user.id, name: user.name, email: user.email, image: user.avatarUrl };
    },
  }),
  // Google is added only when its credentials are present, so the app stays
  // healthy before the OAuth app is set up. Reads AUTH_GOOGLE_ID/SECRET.
  ...(googleEnabled ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
];

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // For OAuth, make sure a row exists in our users table and swap in our id
      // so the jwt callback stores it (not the provider's account id).
      if (account?.provider === "google" && user.email) {
        const dbUser = await findOrCreateOAuthUser({
          email: user.email,
          name: user.name,
          image: user.image,
        });
        user.id = dbUser.id;
      }
      return true;
    },
  },
});
