/**
 * Edge-safe Auth.js base config. Contains NO database or bcrypt imports so it
 * can be loaded by the middleware (Edge runtime). The Credentials/Google
 * providers and their Node-only logic live in ./auth.ts.
 */

import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    // Used by the middleware. The matcher already scopes this to protected
    // routes, so any request reaching it must be authenticated.
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt({ token, user }) {
      // On sign-in, persist our own users.id (set in authorize / signIn).
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = token.uid as string;
      }
      // The JWT's own `iat`, carried through so requireUser() can refuse tokens
      // minted before a password reset or a suspension. Copying a claim keeps
      // this file free of the database import that proxy.ts could not load.
      if (typeof token.iat === "number" && session.user) {
        session.user.issuedAt = token.iat;
      }
      return session;
    },
  },
  providers: [], // real providers are added in ./auth.ts
} satisfies NextAuthConfig;
