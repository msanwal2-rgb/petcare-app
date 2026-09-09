import { ok, parseQuery } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { listAuditEntries } from "@/lib/server/audit";
import { auditQuerySchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/audit -> { items, total, limit, offset } — admin only.
//
// Reading the log is an admin action rather than a support one: it is a record
// of what colleagues did, and "who looked at what" is exactly the thing a
// support role should not be able to browse casually.
export async function GET(request: Request) {
  const auth = await requireStaff("admin");
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(request, auditQuerySchema);
  if ("response" in parsed) return parsed.response;

  return ok(await listAuditEntries(parsed.data));
}
