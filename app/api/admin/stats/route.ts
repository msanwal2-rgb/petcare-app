import { ok } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { getAdminStats } from "@/lib/server/admin/stats";

// GET /api/admin/stats -> AdminStats — any staff member.
export async function GET() {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;
  return ok(await getAdminStats());
}
