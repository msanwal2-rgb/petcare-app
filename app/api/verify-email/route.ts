import { z } from "zod";
import { verifyEmailToken } from "@/lib/server/email-flows";
import { error, ok, parseBody } from "@/lib/server/http";

// POST /api/verify-email { token } -> { user } | 400 (invalid/expired)
export async function POST(request: Request) {
  const parsed = await parseBody(request, z.object({ token: z.string().min(1) }));
  if ("response" in parsed) return parsed.response;
  const user = await verifyEmailToken(parsed.data.token);
  if (!user) return error("This verification link is invalid or has expired", 400);
  return ok({ user });
}
