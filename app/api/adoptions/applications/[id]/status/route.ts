import {
  isApplicationParticipant,
  updateApplicationStatus,
} from "@/lib/server/adoptions/applications";
import { applicationStatusSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/adoptions/applications/:id/status -> AdoptionApplication
//
// Which party is asking is derived from the session, never the body — the same
// shape as the booking and appointment status routes.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { ok: allowed, actor } = await isApplicationParticipant(auth.uid, id);
  if (!allowed || !actor) return notFound(`Application ${id} not found`);

  const parsed = await parseBody(request, applicationStatusSchema);
  if ("response" in parsed) return parsed.response;

  const result = await updateApplicationStatus(
    id,
    parsed.data.status,
    actor,
    parsed.data.note
  );
  if (result.ok) return ok(result.application);

  if (result.code === "not_found") return notFound(`Application ${id} not found`);
  if (result.code === "not_allowed") {
    return forbidden(
      result.actor === "applicant"
        ? "Only the shelter can do that"
        : "Only the applicant can do that"
    );
  }
  if (result.code === "already_approved") {
    // One approval per listing at a time, so two people are never both asked
    // for money for one animal.
    return error("Another applicant is already approved for this animal", 409, {
      applicationId: result.applicationId,
    });
  }
  if (result.code === "invalid_transition") {
    return error(
      `Cannot move an application from "${result.from}" to "${result.to}"`,
      409,
      { from: result.from, to: result.to }
    );
  }
  return error("Could not update that application", 409);
}
