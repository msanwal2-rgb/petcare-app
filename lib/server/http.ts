/**
 * Small helpers shared by every route handler: JSON responses, standard error
 * shapes, and Zod-validated body parsing.
 */

import type { ZodType } from "zod";

export function ok<T>(data: T, status = 200): Response {
  return Response.json(data as unknown as object, { status });
}

export function error(message: string, status: number, extra?: object): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export const notFound = (message = "Not found") => error(message, 404);

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
    return {
      response: error("Validation failed", 400, {
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }),
    };
  }
  return { data: result.data };
}
