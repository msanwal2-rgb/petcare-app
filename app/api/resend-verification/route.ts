import { getUserById } from "@/lib/server/users";
import { requestEmailVerification } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { ok } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

// POST /api/resend-verification -> { ok, devLink? } — for the signed-in user
export async function POST(request: Request) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  const user = await getUserById(uid);
  if (!user) return unauthorized();
  if (user.verified) return ok({ ok: true, alreadyVerified: true });

  const origin = new URL(request.url).origin;
  const { link } = await requestEmailVerification(
    { id: user.id, email: user.email, name: user.name },
    origin
  );
  return ok({ ok: true, ...(emailDevMode() ? { devLink: link } : {}) });
}
