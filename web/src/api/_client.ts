/**
 * Shared fetch helper for the API client layer.
 *
 * Every function in src/api goes through here. Ported from the reference
 * project's lib/api/_client.ts with one change: the base URL.
 *
 * ── Where the API is ─────────────────────────────────────────────────
 *
 * public/config.js (`apiBaseUrl`) — in development and when deployed alike.
 * It is a plain file next to index.html, so a deployed copy can be edited on
 * the server without a rebuild. VITE_API_BASE_URL is the build-time fallback;
 * empty means "same origin as this page" (the API serving the SPA itself).
 *
 * The API must list this site in Cors:Origins. Different ports on one host
 * are same-site, so the Lax session cookie still travels; on different
 * domains, set Auth:CrossSiteCookie on the API as well — see deploy/README.md.
 */

declare global {
  interface Window {
    LEASH_CONFIG?: { apiBaseUrl?: string; stripePublishableKey?: string };
  }
}

export const BASE = (
  window.LEASH_CONFIG?.apiBaseUrl ||
  import.meta.env.VITE_API_BASE_URL ||
  ""
).replace(/\/$/, "");

/** Every endpoint lives under /api/v1 — see BUILD_PLAN.md §8a. */
export const API_PREFIX = "/api/v1";

/**
 * A failed request, carrying the server's own message and status.
 *
 * `issues` is populated on a 400 from the validation filter; `details` carries
 * the structured extras some endpoints attach to a 409 or 502 (the re-quoted
 * cart, the product that sold out, the order whose payment could not start).
 * Both are part of the error envelope contract — see REQUIREMENTS.md §2.1.
 */
export class ApiError extends Error {
  status: number;
  issues?: { path: string; message: string }[];
  details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    issues?: { path: string; message: string }[],
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
    this.details = details;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${API_PREFIX}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    // Sends the session cookie when the API is on another address. On the
    // same address it behaves exactly like the default.
    credentials: "include",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let issues: { path: string; message: string }[] | undefined;
    let details: Record<string, unknown> | undefined;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
      if (Array.isArray(data?.issues)) issues = data.issues;
      // Anything beyond error/issues is an endpoint-specific extra.
      const { error: _e, issues: _i, ...rest } = data ?? {};
      if (Object.keys(rest).length > 0) details = rest;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, issues, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** GET returning the parsed body (whatever it is, including null). */
export function getJson<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

/** GET that maps a 404 to `null` (for "detail or null" endpoints). */
export async function getJsonOrNull<T>(path: string): Promise<T | null> {
  try {
    return await request<T>("GET", path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function patchJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

/** DELETE, for endpoints that answer 204. */
export function deleteJson(path: string): Promise<void> {
  return request<void>("DELETE", path);
}

/** Build a query string from defined params only. */
export function qs(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}
