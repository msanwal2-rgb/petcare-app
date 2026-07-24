import { z } from "zod";
import { EmailTakenError, registerUser } from "@/lib/server/auth-logic";
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
export async function POST(request: Request) {
  const parsed = await parseBody(request, signupSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const user = await registerUser(parsed.data);
    return ok(user, 201);
  } catch (e) {
    if (e instanceof EmailTakenError) return error(e.message, 409);
    throw e;
  }
}
