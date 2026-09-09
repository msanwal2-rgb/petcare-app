import { ok, parseQuery } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { searchProfessionals } from "@/lib/server/admin/professionals";
import { adminProfessionalQuerySchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/professionals -> AdminProfessionalPage — support.
export async function GET(request: Request) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(request, adminProfessionalQuerySchema);
  if ("response" in parsed) return parsed.response;

  return ok(await searchProfessionals(parsed.data));
}
