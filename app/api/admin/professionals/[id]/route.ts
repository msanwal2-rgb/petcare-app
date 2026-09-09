import { notFound, ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { requestIp } from "@/lib/server/audit";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import { setVerification } from "@/lib/server/admin/professionals";
import { verificationSchema } from "@/lib/validation/admin-schemas";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/admin/professionals/:id -> { ok }
//
// The id is a profile id, and the `kind` in the body says which table it is in.
// Caretakers and vets have separate profile tables with separate columns, so
// this is not polymorphism to be tidied away — it is two things.
export async function PATCH(request: Request, ctx: Ctx) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await parseBody(request, verificationSchema);
  if ("response" in parsed) return parsed.response;

  const result = await setVerification(
    parsed.data.kind,
    id,
    parsed.data.status,
    { uid: auth.uid, ip: requestIp(request) },
    parsed.data.note
  );
  return result.ok ? ok(result) : notFound("No such profile");
}
