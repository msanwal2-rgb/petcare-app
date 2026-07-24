import { createUser, getUsersByIds, listUsers } from "@/lib/server/users";
import { createUserSchema } from "@/lib/validation/schemas";
import { ok, parseBody } from "@/lib/server/http";

// GET /api/users            -> User[] (dev/demo account switcher)
// GET /api/users?ids=a,b,c   -> User[] (batch resolve)
export async function GET(request: Request) {
  const idsParam = new URL(request.url).searchParams.get("ids");
  if (idsParam !== null) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    return ok(await getUsersByIds(ids));
  }
  return ok(await listUsers());
}

// POST /api/users -> User (201)
export async function POST(request: Request) {
  const parsed = await parseBody(request, createUserSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await createUser(parsed.data), 201);
}
