import { z } from "zod";
import { resetPassword } from "@/lib/server/email-flows";
import { error, ok, parseBody } from "@/lib/server/http";

// POST /api/reset-password { token, password } -> { ok } | 400
export async function POST(request: Request) {
  const parsed = await parseBody(
    request,
    z.object({ token: z.string().min(1), password: z.string().min(6) })
  );
  if ("response" in parsed) return parsed.response;
  const okReset = await resetPassword(parsed.data.token, parsed.data.password);
  if (!okReset) return error("This reset link is invalid or has expired", 400);
  return ok({ ok: true });
}
