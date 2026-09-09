/**
 * Users domain — server logic. Called by the route handlers under
 * /app/api/users. Returns API-shaped values via the serializers.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toPublicUser, toUser } from "./serialize";
import type { UpdateUserBody } from "@/lib/validation/schemas";

export async function getUserById(id: string, db: PrismaClient = defaultPrisma) {
  const u = await db.user.findUnique({ where: { id } });
  return u ? toUser(u) : null;
}

export async function getUsersByIds(ids: string[], db: PrismaClient = defaultPrisma) {
  if (ids.length === 0) return [];
  const rows = await db.user.findMany({ where: { id: { in: ids } } });
  return rows.map(toUser);
}

/* ── Public projections ───────────────────────────────────────────
 *
 * What anyone may see about someone else: enough to render a review byline or
 * a caretaker card. `getUserById` above returns the email, the phone number and
 * the home coordinates, which is right for /api/me and for an admin reading one
 * account, and wrong for a public profile behind a guessable id.
 */

export async function getPublicUserById(
  id: string,
  db: PrismaClient = defaultPrisma
) {
  const u = await db.user.findUnique({ where: { id } });
  // A deleted account is scrubbed, not hidden — but there is no reason to serve
  // its husk to a profile page.
  if (!u || u.status === "deleted") return null;
  return toPublicUser(u);
}

export async function getPublicUsersByIds(
  ids: string[],
  db: PrismaClient = defaultPrisma
) {
  if (ids.length === 0) return [];
  const rows = await db.user.findMany({
    where: { id: { in: ids }, status: { not: "deleted" } },
  });
  return rows.map(toPublicUser);
}

export async function listUsers(db: PrismaClient = defaultPrisma) {
  const rows = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toUser);
}

/** Returns null when the user doesn't exist (handler maps to 404). */
export async function updateUser(
  id: string,
  patch: UpdateUserBody,
  db: PrismaClient = defaultPrisma
) {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return null;

  const { address, ...rest } = patch;
  const u = await db.user.update({
    where: { id },
    data: {
      ...rest,
      ...(address
        ? {
            addressCity: address.city,
            addressState: address.state,
            lat: address.lat,
            lng: address.lng,
          }
        : {}),
    },
  });
  return toUser(u);
}
