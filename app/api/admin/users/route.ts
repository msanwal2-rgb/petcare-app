import { ok, parseQuery } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { searchAdminUsers } from "@/lib/server/admin/users";
import { adminUserQuerySchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/users -> AdminUserPage — search, filter, sort, paginate.
export async function GET(request: Request) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(request, adminUserQuerySchema);
  if ("response" in parsed) return parsed.response;

  return ok(await searchAdminUsers(parsed.data));
}
