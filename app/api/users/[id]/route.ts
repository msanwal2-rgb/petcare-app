import { getUserById, updateUser } from "@/lib/server/users";
import { updateUserSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id -> User | 404  (public profile)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getUserById(id);
  return user ? ok(user) : notFound(`User ${id} not found`);
}

// PATCH /api/users/:id -> User | 404 — only your own account
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (uid !== id) return forbidden();
  const parsed = await parseBody(request, updateUserSchema);
  if ("response" in parsed) return parsed.response;
  const user = await updateUser(id, parsed.data);
  return user ? ok(user) : notFound(`User ${id} not found`);
}
