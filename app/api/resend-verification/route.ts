import { getUserById } from "@/lib/server/users";
import { requestEmailVerification } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { appOrigin } from "@/lib/server/origin";
import { ok } from "@/lib/server/http";
import { requireUser, unauthorized } from "@/lib/server/session";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";

// POST /api/resend-verification -> { ok, devLink? } — for the signed-in user
//
// Keyed on the user id: being signed in is not a licence to make this app send
// unlimited mail to the address on the account.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.emailSend, `uid:${auth.uid}`);
  if (limited) return limited;

  const user = await getUserById(auth.uid);
  if (!user) return unauthorized();
  if (user.verified) return ok({ ok: true, alreadyVerified: true });

  const { link } = await requestEmailVerification(
    { id: user.id, email: user.email, name: user.name },
    appOrigin()
  );
  return ok({ ok: true, ...(emailDevMode() ? { devLink: link } : {}) });
}
