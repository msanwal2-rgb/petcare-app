import { z } from "zod";
import { requestPasswordReset } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { ok, parseBody } from "@/lib/server/http";

// POST /api/forgot-password { email } -> { ok: true } (always, to avoid leaking
// which emails exist). Includes devLink only when EMAIL_DEV_MODE is on.
export async function POST(request: Request) {
  const parsed = await parseBody(request, z.object({ email: z.string().email() }));
  if ("response" in parsed) return parsed.response;

  const origin = new URL(request.url).origin;
  const { link } = await requestPasswordReset(parsed.data.email, origin);
  return ok({ ok: true, ...(emailDevMode() && link ? { devLink: link } : {}) });
}
