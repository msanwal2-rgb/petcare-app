import { z } from "zod";
import { EmailTakenError, registerUser } from "@/lib/server/auth-logic";
import { requestEmailVerification } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { appOrigin } from "@/lib/server/origin";
import { getSetting } from "@/lib/server/settings";
import { userRole } from "@/lib/validation/schemas";
import { error, ok, parseBody } from "@/lib/server/http";
import { RATE_LIMITS, clientKey, limit } from "@/lib/server/rate-limit";

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  roles: z.array(userRole).optional(),
});

// POST /api/signup -> User (201) | 409 (email taken) | 429 | 503 (signups closed)
// Also fires off an email-verification link (best-effort).
export async function POST(request: Request) {
  const limited = await limit(RATE_LIMITS.signup, clientKey(request));
  if (limited) return limited;

  if (!(await getSetting("signupsOpen"))) {
    return error("New accounts are temporarily closed", 503);
  }

  const parsed = await parseBody(request, signupSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const user = await registerUser(parsed.data);
    let devLink: string | undefined;
    try {
      const { link } = await requestEmailVerification(
        { id: user.id, email: user.email, name: user.name },
        appOrigin()
      );
      if (emailDevMode()) devLink = link;
    } catch {
      // Don't fail signup if the verification email can't be sent.
    }
    return ok(devLink ? { ...user, devLink } : user, 201);
  } catch (e) {
    if (e instanceof EmailTakenError) return error(e.message, 409);
    throw e;
  }
}
