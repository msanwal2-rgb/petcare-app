import { z } from "zod";
import { resetPassword } from "@/lib/server/email-flows";
import { error, ok, parseBody } from "@/lib/server/http";
import { RATE_LIMITS, clientKey, limit } from "@/lib/server/rate-limit";

// POST /api/reset-password { token, password } -> { ok } | 400 | 429
//
// Throttled because the token is the only thing standing between a caller and
// an account, and an unthrottled endpoint invites guessing at it.
export async function POST(request: Request) {
  const limited = await limit(RATE_LIMITS.emailSend, clientKey(request));
  if (limited) return limited;

  const parsed = await parseBody(
    request,
    z.object({ token: z.string().min(1), password: z.string().min(8) })
  );
  if ("response" in parsed) return parsed.response;
  const okReset = await resetPassword(parsed.data.token, parsed.data.password);
  if (!okReset) return error("This reset link is invalid or has expired", 400);
  return ok({ ok: true });
}
