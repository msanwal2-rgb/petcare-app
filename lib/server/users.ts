/**
 * Users domain — server logic. Called by the route handlers under
 * /app/api/users. Returns API-shaped values via the serializers.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toUser } from "./serialize";
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
