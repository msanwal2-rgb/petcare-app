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
import { HEADSHOTS, unsplash } from "@/lib/mock-data/photos";
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

/**
 * Find (by email) or create a user for an OAuth sign-in. OAuth users get no
 * passwordHash; they can only ever sign in through the provider.
 */
export async function findOrCreateOAuthUser(
  input: { email: string; name?: string | null; image?: string | null },
  db: PrismaClient = defaultPrisma
) {
  const email = input.email.toLowerCase().trim();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return toUser(existing);

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
      verified: true, // email verified by the OAuth provider
      createdAt: nowIso(),
    },
  });
  return toUser(row);
}
