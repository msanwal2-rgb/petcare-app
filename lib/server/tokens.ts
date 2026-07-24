/**
 * Single-use, expiring tokens for email verification and password reset.
 * Only the SHA-256 hash is stored; the raw token travels in the email link.
 */

import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "./ids";

export type TokenType = "verify_email" | "reset_password";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const TTL_MS: Record<TokenType, number> = {
  verify_email: 24 * 60 * 60 * 1000, // 24h
  reset_password: 60 * 60 * 1000, // 1h
};

/** Create a token for `identifier`, returning the raw token to email out. */
export async function createToken(
  identifier: string,
  type: TokenType,
  db: PrismaClient = defaultPrisma
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS[type]).toISOString();
  // Invalidate any prior tokens of this type for the same identifier.
  await db.verificationToken.deleteMany({ where: { identifier, type } });
  await db.verificationToken.create({
    data: {
      id: genId("tok"),
      identifier,
      tokenHash: hashToken(raw),
      type,
      expiresAt,
      createdAt: nowIso(),
    },
  });
  return raw;
}

/**
 * Validate and consume a token. Returns the identifier on success (deleting the
 * token so it can't be reused), or null if invalid/expired/wrong-type.
 */
export async function consumeToken(
  raw: string,
  type: TokenType,
  db: PrismaClient = defaultPrisma
): Promise<string | null> {
  const row = await db.verificationToken.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!row || row.type !== type) return null;
  await db.verificationToken.delete({ where: { id: row.id } });
  if (row.expiresAt < nowIso()) return null; // expired (still deleted)
  return row.identifier;
}
