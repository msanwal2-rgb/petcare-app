import { z } from "zod";
import { EmailTakenError, registerUser } from "@/lib/server/auth-logic";
import { requestEmailVerification } from "@/lib/server/email-flows";
import { emailDevMode } from "@/lib/server/mailer";
import { userRole } from "@/lib/validation/schemas";
import { error, ok, parseBody } from "@/lib/server/http";

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  roles: z.array(userRole).optional(),
});

// POST /api/signup -> User (201) | 409 (email taken)
// Also fires off an email-verification link (best-effort).
export async function POST(request: Request) {
  const parsed = await parseBody(request, signupSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const user = await registerUser(parsed.data);
    let devLink: string | undefined;
    try {
      const origin = new URL(request.url).origin;
      const { link } = await requestEmailVerification(
        { id: user.id, email: user.email, name: user.name },
        origin
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
