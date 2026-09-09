import { reverseAdoption } from "@/lib/server/adoptions/transfer";
import { recordAdminAction, requestIp } from "@/lib/server/audit";
import { error, notFound, ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

const reverseSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// POST /api/admin/adoptions/:id/reverse -> { pet } — support staff only.
//
// Adoptions fall through: the dog is frightened of the baby, the allergy turns
// out to be real. Without this route the only way to put an animal back would
// be the ownership backdoor this feature closed — which somebody would reopen
// by hand in production, and then it would stay open.
//
// It severs in the other direction for free: the *adopter's* caretakers and
// vets lose access on the same write, because the mechanism has never cared
// which way an animal moves.
//
// Deliberately does not refund. Whether the fee comes back is a conversation
// between a shelter and a person, and auto-refunding here would quietly make
// every returned animal free.
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireStaff("support");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await parseBody(request, reverseSchema);
  if ("response" in parsed) return parsed.response;

  const result = await reverseAdoption(id, parsed.data.reason);
  if (!result.ok) {
    if (result.code === "not_found") {
      return notFound(`Application ${id} not found`);
    }
    return error("That adoption was never completed", 409, {
      status: result.status,
    });
  }

  await recordAdminAction({
    actorUserId: auth.uid,
    action: "adoption.reverse",
    targetType: "adoption_application",
    targetId: id,
    summary: `Returned ${result.pet.name} to the shelter`,
    metadata: { reason: parsed.data.reason, petId: result.pet.id },
    ip: requestIp(request),
  });

  return ok(result);
}
