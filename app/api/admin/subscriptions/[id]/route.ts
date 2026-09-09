import { error, ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { requestIp } from "@/lib/server/audit";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import { adminCancelSubscription, extendGrace } from "@/lib/server/admin/finance";
import { subscriptionActionSchema } from "@/lib/validation/admin-schemas";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/subscriptions/:id -> { ok } — finance only.
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireStaff("finance");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await parseBody(request, subscriptionActionSchema);
  if ("response" in parsed) return parsed.response;

  const actor = { uid: auth.uid, ip: requestIp(request) };
  const result =
    parsed.data.action === "cancel"
      ? await adminCancelSubscription(
          id,
          { immediately: parsed.data.immediately },
          actor
        )
      : await extendGrace(id, parsed.data.days, actor);

  if (result.ok) return ok(result);
  return error(result.message, result.code === "not_found" ? 404 : 502);
}
