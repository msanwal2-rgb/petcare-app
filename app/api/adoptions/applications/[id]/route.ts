import {
  getApplicationById,
  isApplicationParticipant,
} from "@/lib/server/adoptions/applications";
import { notFound, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/adoptions/applications/:id -> AdoptionApplication | 404
//
// Either side may read it. Somebody else's reads as 404 rather than 403, so an
// id cannot be probed — the same rule the assistant's conversations follow.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { ok: allowed } = await isApplicationParticipant(auth.uid, id);
  if (!allowed) return notFound(`Application ${id} not found`);

  const application = await getApplicationById(id);
  return application ? ok(application) : notFound(`Application ${id} not found`);
}
