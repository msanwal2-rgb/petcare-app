import { getUserById, updateUser } from "@/lib/server/users";
import { updateUserSchema } from "@/lib/validation/schemas";
import { notFound, ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id -> User | 404
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const user = await getUserById(id);
  return user ? ok(user) : notFound(`User ${id} not found`);
}

// PATCH /api/users/:id -> User | 404
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, updateUserSchema);
  if ("response" in parsed) return parsed.response;
  const user = await updateUser(id, parsed.data);
  return user ? ok(user) : notFound(`User ${id} not found`);
}
