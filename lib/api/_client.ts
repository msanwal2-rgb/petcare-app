/**
 * Shared fetch helper for the API client layer.
 *
 * Every function in /lib/api goes through here. All current callers are client
 * components, so relative URLs work; the server-side base fallback is cheap
 * insurance in case a function is ever called during SSR.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function base(): string {
  if (typeof window !== "undefined") return ""; // browser → relative
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
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
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of entries) sp.set(k, String(v));
  return `?${sp.toString()}`;
}
