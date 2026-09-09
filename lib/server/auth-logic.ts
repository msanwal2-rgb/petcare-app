/**
 * Server-side authentication logic, decoupled from Auth.js so it can be unit
 * tested directly against a Prisma client. Handles password hashing, credential
 * verification, email/password registration, and OAuth user provisioning.
 */

import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toUser } from "./serialize";
import { genId, nowIso } from "./ids";
import { HEADSHOTS, unsplash } from "@/lib/media/photos";
import type { UserRole } from "@/types";

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export class EmailTakenError extends Error {
  constructor() {
    super("An account with that email already exists");
    this.name = "EmailTakenError";
  }
}

/**
 * Verify an email/password pair. Returns the user (API shape) on success, or
 * null on any failure (unknown email, no password set, wrong password) — the
 * caller must not distinguish these to avoid leaking which emails exist.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  db: PrismaClient = defaultPrisma
) {
  const row = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!row || !row.passwordHash) return null;
  const okPassword = await verifyPassword(password, row.passwordHash);
  return okPassword ? toUser(row) : null;
}

/** Create a new email/password account. Throws EmailTakenError on a dup email. */
export async function registerUser(
  input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    roles?: UserRole[];
  },
  db: PrismaClient = defaultPrisma
) {
  const email = input.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new EmailTakenError();

  const count = await db.user.count();
  const row = await db.user.create({
    data: {
      id: genId("u"),
      name: input.name,
      email,
      phone: input.phone ?? "",
      avatarUrl: unsplash(HEADSHOTS[count % HEADSHOTS.length], 240, 240, "faces"),
      roles: input.roles ?? [],
      addressCity: "Austin",
      addressState: "TX",
      lat: 30.2672,
      lng: -97.7431,
      verified: false,
      createdAt: nowIso(),
      passwordHash: await hashPassword(input.password),
    },
  });
  return toUser(row);
}

export type OAuthSignInResult =
  | { ok: true; user: ReturnType<typeof toUser>; created: boolean }
  | { ok: false; reason: "email_unverified" | "account_exists" };

/**
 * Resolve a Google sign-in to one of our users: link it, or create one.
 *
 * The version this replaces looked up the address and returned whatever it
 * found, with `allowDangerousEmailAccountLinking: true` on the provider. That
 * combination is account pre-hijacking: register a password account at
 * victim@gmail.com before they ever visit, wait, and when the real owner of
 * that Gmail address signs in with Google they land inside the account you
 * control — with your password still on it.
 *
 * So an existing row is only ever *linked* when linking cannot hand someone
 * else's session over:
 *
 *  - already linked to this Google id  → sign in, the unambiguous case;
 *  - no password on the account        → link, because nobody can reach it by
 *                                        password, so there is no second owner
 *                                        to displace;
 *  - a password is set                 → refuse. The safe order is to sign in
 *                                        with the password you already have and
 *                                        link Google from account settings,
 *                                        where the person doing the linking has
 *                                        proved they hold the account.
 *
 * `emailVerified` is Google's own claim and is checked rather than assumed. An
 * unverified Google address is not proof of anything: Workspace accounts can be
 * created with an address the holder never confirmed.
 */
export async function linkOrCreateOAuthUser(
  input: {
    email: string;
    emailVerified: boolean;
    googleId: string;
    name?: string | null;
    image?: string | null;
  },
  db: PrismaClient = defaultPrisma
): Promise<OAuthSignInResult> {
  if (!input.emailVerified) return { ok: false, reason: "email_unverified" };

  const email = input.email.toLowerCase().trim();

  const linked = await db.user.findUnique({ where: { googleId: input.googleId } });
  if (linked) return { ok: true, user: toUser(linked), created: false };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.passwordHash) return { ok: false, reason: "account_exists" };
    const adopted = await db.user.update({
      where: { id: existing.id },
      data: { googleId: input.googleId, verified: true },
    });
    return { ok: true, user: toUser(adopted), created: false };
  }

  const count = await db.user.count();
  const row = await db.user.create({
    data: {
      id: genId("u"),
      name: input.name || email.split("@")[0],
      email,
      phone: "",
      avatarUrl:
        input.image ||
        unsplash(HEADSHOTS[count % HEADSHOTS.length], 240, 240, "faces"),
      roles: [],
      addressCity: "Austin",
      addressState: "TX",
      lat: 30.2672,
      lng: -97.7431,
      // Google told us it verified this address, and we checked that it said so.
      verified: true,
      googleId: input.googleId,
      createdAt: nowIso(),
    },
  });
  return { ok: true, user: toUser(row), created: true };
}

/**
 * Link Google to the account already signed in. This is the safe direction: the
 * caller has proved they hold the account before the link is made.
 */
export async function linkGoogleToUser(
  uid: string,
  googleId: string,
  db: PrismaClient = defaultPrisma
): Promise<{ ok: true } | { ok: false; reason: "taken" }> {
  const claimed = await db.user.findUnique({ where: { googleId } });
  if (claimed && claimed.id !== uid) return { ok: false, reason: "taken" };
  await db.user.update({ where: { id: uid }, data: { googleId } });
  return { ok: true };
}
