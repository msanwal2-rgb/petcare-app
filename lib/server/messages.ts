/**
 * Messaging domain — booking-scoped chat between the owner and caretaker.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toMessage } from "./serialize";
import { genId, nowIso } from "./ids";

export async function getMessagesForBooking(
  bookingId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.message.findMany({
    where: { bookingId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toMessage);
}

export async function createMessage(
  bookingId: string,
  fromUserId: string,
  body: string,
  db: PrismaClient = defaultPrisma
) {
  const row = await db.message.create({
    data: {
      id: genId("m"),
      bookingId,
      fromUserId,
      body,
      createdAt: nowIso(),
      readAt: null,
    },
  });
  return toMessage(row);
}

/** Mark every message on a booking that the given user did NOT send as read. */
export async function markMessagesRead(
  bookingId: string,
  readerId: string,
  db: PrismaClient = defaultPrisma
) {
  await db.message.updateMany({
    where: { bookingId, fromUserId: { not: readerId }, readAt: null },
    data: { readAt: nowIso() },
  });
}
