/**
 * Small helpers shared by every route handler: JSON responses, standard error
 * shapes, and Zod-validated body parsing.
 */

import type { ZodIssue, ZodType } from "zod";

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data as unknown as object, { status });
}

export function error(message: string, status: number, extra?: object): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export const notFound = (message = "Not found") => error(message, 404);
export const unauthorized = (message = "You must be signed in") => error(message, 401);
export const forbidden = (message = "Not allowed") => error(message, 403);

export const badRequest = (message: string, extra?: object) =>
  error(message, 400, extra);

/** Turn a Zod failure into the standard 400 shape. */
function validationFailed(message: string, issues: ZodIssue[]): Response {
  return badRequest(message, {
    issues: issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/**
 * Parse and validate a JSON request body. Returns either the typed value or a
 * 400 Response describing what failed — the caller returns whichever it gets.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ data: T } | { response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: error("Invalid JSON body", 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { response: validationFailed("Validation failed", result.error.issues) };
  }
  return { data: result.data };
}

/** The same contract as `parseBody`, for query strings. */
export function parseQuery<T>(
  request: Request,
  schema: ZodType<T>
): { data: T } | { response: Response } {
  const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      response: validationFailed("Invalid search parameters", result.error.issues),
    };
  }
  return { data: result.data };
}
