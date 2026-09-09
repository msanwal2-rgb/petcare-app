import { z } from "zod";
import { requestPasswordReset } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { appOrigin } from "@/lib/server/origin";
import { ok, parseBody } from "@/lib/server/http";
import { RATE_LIMITS, clientKey, limit } from "@/lib/server/rate-limit";

// POST /api/forgot-password { email } -> { ok: true } (always, to avoid leaking
// which emails exist). Includes devLink only outside production, when
// EMAIL_DEV_MODE is on.
//
// Throttled per client rather than per address: the abuse here is using this
// endpoint to flood someone else's inbox, and the address in the body is
// exactly the thing the attacker varies.
export async function POST(request: Request) {
  const limited = await limit(RATE_LIMITS.emailSend, clientKey(request));
  if (limited) return limited;

  const parsed = await parseBody(request, z.object({ email: z.string().email() }));
  if ("response" in parsed) return parsed.response;

  const { link } = await requestPasswordReset(parsed.data.email, appOrigin());
  return ok({ ok: true, ...(emailDevMode() && link ? { devLink: link } : {}) });
}
