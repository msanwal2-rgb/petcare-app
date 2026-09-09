import { getPublicUserById, updateUser } from "@/lib/server/users";
import { updateUserSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id -> PublicUser | 404
//
// The *public* projection: name, avatar, roles, city and state. It used to
// return the whole record — email, phone, and the home coordinates the search
// map is drawn from — to anyone who asked, against ids that count upward from
// u1. Your own full record is at /api/me; an administrator reads one through
// /api/admin/users/:id, where it is a privileged action and recorded as one.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getPublicUserById(id);
  return user ? ok(user) : notFound(`User ${id} not found`);
}

// PATCH /api/users/:id -> User | 404 — only your own account
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== id) return forbidden();
  const parsed = await parseBody(request, updateUserSchema);
  if ("response" in parsed) return parsed.response;
  const user = await updateUser(id, parsed.data);
  return user ? ok(user) : notFound(`User ${id} not found`);
}
