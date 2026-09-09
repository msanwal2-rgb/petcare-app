import { error, notFound, ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { requestIp } from "@/lib/server/audit";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import {
  forceSignOut,
  getAdminUserDetail,
  reactivateUser,
  setStaffRoles,
  setUserRoles,
  setUserVerified,
  softDeleteUser,
  suspendUser,
  type AdminUserMutationResult,
} from "@/lib/server/admin/users";
import { adminUserActionSchema } from "@/lib/validation/admin-schemas";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/admin/users/:id -> AdminUserDetail | 404
export async function GET(_request: Request, ctx: Ctx) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const detail = await getAdminUserDetail(id);
  return detail ? ok(detail) : notFound(`User ${id} not found`);
}

/** Map a domain refusal onto a status code and a sentence worth reading. */
function respond(result: AdminUserMutationResult): Response {
  if (result.ok) return ok(result.user);
  if (result.code === "not_found") return notFound("That user no longer exists");
  if (result.code === "self_staff_edit") {
    return error("You can't change your own staff access", 403);
  }
  return error("There has to be at least one active admin", 409);
}

// PATCH /api/admin/users/:id -> User
//
// One action per request (see adminUserActionSchema). Granting staff roles is
// the only action gated on "admin" rather than "support": deciding who may read
// customer accounts is a different kind of decision from reading one.
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await parseBody(request, adminUserActionSchema);
  if ("response" in parsed) return parsed.response;

  const actor = { uid: auth.uid, ip: requestIp(request) };
  const body = parsed.data;

  switch (body.action) {
    case "verify":
      return respond(await setUserVerified(id, body.verified, actor));
    case "suspend":
      return respond(await suspendUser(id, body.reason, actor));
    case "reactivate":
      return respond(await reactivateUser(id, actor));
    case "sign_out":
      return respond(await forceSignOut(id, actor));
    case "set_roles":
      return respond(await setUserRoles(id, body.roles, actor));
    case "set_staff_roles": {
      const elevated = await requireStaff("admin");
      if ("response" in elevated) return elevated.response;
      return respond(await setStaffRoles(id, body.staffRoles, actor));
    }
  }
}

// DELETE /api/admin/users/:id -> User (soft delete; the row survives, the person doesn't)
export async function DELETE(request: Request, ctx: Ctx) {
  const auth = await requireStaff("admin");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  return respond(
    await softDeleteUser(id, { uid: auth.uid, ip: requestIp(request) })
  );
}
