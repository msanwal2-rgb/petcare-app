/**
 * Readable, collision-free ids for records created at runtime. Serverless
 * instances are stateless, so we can't use a shared counter like the mock did;
 * a UUID suffix keeps ids unique across instances while the prefix preserves
 * the "u…/p…/b…/r…" readability from the seed data.
 */
export function genId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

/** Server timestamp for newly created records. */
export function nowIso(): string {
  return new Date().toISOString();
}
