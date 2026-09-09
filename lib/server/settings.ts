/**
 * Runtime settings an admin can change without a deploy.
 *
 * Deliberately a short list. A setting earns a row here only if someone would
 * genuinely need to change it at 2am without shipping code; everything else is
 * an environment variable, where it can't be flipped by whoever compromises an
 * admin account. `ASSISTANT_ENABLED` in particular stays an env kill switch
 * rather than being mirrored here — two switches for one behaviour is the
 * ambiguity this module exists to avoid.
 *
 * Reads are defaulted, never throwing on a missing row, so a fresh database and
 * a seeded one behave identically.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { nowIso } from "./ids";

export interface SystemSettings {
  /** When false, POST /api/signup refuses new accounts. */
  signupsOpen: boolean;
  /** Non-empty text shows a site-wide banner. */
  maintenanceBanner: string;
  /**
   * Whether /login offers the one-tap demo accounts and prints their shared
   * password. Defaults to false in production: a published password on a seeded
   * database is a working login for anyone who reads the page.
   */
  demoLoginVisible: boolean;
  /** Order subtotal at or above which shipping is free, in integer cents. */
  freeShippingThresholdCents: number;
}

export const SETTING_KEYS = [
  "signupsOpen",
  "maintenanceBanner",
  "demoLoginVisible",
  "freeShippingThresholdCents",
] as const satisfies readonly (keyof SystemSettings)[];

export type SettingKey = keyof SystemSettings;

function defaults(): SystemSettings {
  return {
    signupsOpen: true,
    maintenanceBanner: "",
    demoLoginVisible: process.env.NODE_ENV !== "production",
    freeShippingThresholdCents: 4900,
  };
}

/** Narrow a stored JSON value to the declared type, falling back to the default. */
function coerce<K extends SettingKey>(
  key: K,
  raw: unknown,
  fallback: SystemSettings[K],
): SystemSettings[K] {
  if (typeof fallback === "boolean") {
    return (typeof raw === "boolean" ? raw : fallback) as SystemSettings[K];
  }
  if (typeof fallback === "number") {
    return (
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : fallback
    ) as SystemSettings[K];
  }
  return (typeof raw === "string" ? raw : fallback) as SystemSettings[K];
}

export async function getSettings(
  db: PrismaClient = defaultPrisma,
): Promise<SystemSettings> {
  const base = defaults();
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...SETTING_KEYS] } },
  });
  const out = { ...base };
  for (const row of rows) {
    const key = row.key as SettingKey;
    if (!(key in base)) continue;
    // @ts-expect-error — key is a valid SettingKey; the generic pairing is
    // established by `coerce`, which reads the default to pick the shape.
    out[key] = coerce(key, row.value, base[key]);
  }
  return out;
}

export async function getSetting<K extends SettingKey>(
  key: K,
  db: PrismaClient = defaultPrisma,
): Promise<SystemSettings[K]> {
  const all = await getSettings(db);
  return all[key];
}

/**
 * Write settings. Returns the full resolved set so a caller never has to guess
 * what the unwritten keys are now.
 */
export async function updateSettings(
  patch: Partial<SystemSettings>,
  updatedBy: string,
  db: PrismaClient = defaultPrisma,
): Promise<SystemSettings> {
  const now = nowIso();
  const entries = Object.entries(patch).filter(([k]) =>
    (SETTING_KEYS as readonly string[]).includes(k),
  );

  await db.$transaction(
    entries.map(([key, value]) =>
      db.systemSetting.upsert({
        where: { key },
        create: { key, value: value as never, updatedAt: now, updatedBy },
        update: { value: value as never, updatedAt: now, updatedBy },
      }),
    ),
  );

  return getSettings(db);
}
