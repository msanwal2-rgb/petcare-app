import { getPetsByIds } from "@/lib/server/pets";
import { ok } from "@/lib/server/http";
import { canViewPet, requireUser } from "@/lib/server/session";

// GET /api/pets?ids=a,b,c -> Pet[]
//
// Filtered to the pets the caller may actually see rather than refused
// wholesale, because the callers that use this are legitimately mixed: a
// booking detail page asks for every pet on the booking, and a caretaker is
// entitled to all of them. Anything they are not entitled to simply isn't in
// the answer — which is also why an unknown id and a forbidden one are
// indistinguishable from the outside.
//
// Capped, because an unbounded id list is an invitation to ask for the table.
const MAX_IDS = 50;

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const idsParam = new URL(request.url).searchParams.get("ids");
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const allowed = await Promise.all(
    ids.map(async (id) => ((await canViewPet(auth.uid, id)) ? id : null))
  );
  return ok(await getPetsByIds(allowed.filter((id): id is string => id !== null)));
}
