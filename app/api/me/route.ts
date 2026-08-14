import { getUserById } from "@/lib/server/users";
import { requireUser } from "@/lib/server/session";
import { notFound, ok } from "@/lib/server/http";

// GET /api/me -> the authenticated user (full record) | 401
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const user = await getUserById(auth.uid);
  return user ? ok(user) : notFound("Account not found");
}
