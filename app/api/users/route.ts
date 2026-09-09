import { getPublicUsersByIds, listUsers } from "@/lib/server/users";
import { forbidden, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/**
 * GET /api/users?ids=a,b,c -> PublicUser[]
 *   Batch-resolves the counterparties a signed-in user is already looking at —
 *   booking owners, review authors, appointment patients. The public projection
 *   only: rendering a name and a face beside a review never needed the author's
 *   email address and home coordinates, which is what this used to return.
 *
 * GET /api/users -> User[]
 *   The unfiltered listing exists only for the dev account switcher. It returns
 *   every account's email address, so it is refused outside development rather
 *   than left as a directory of the entire user base.
 *
 * Note there is no POST here. Accounts are created through /api/signup, which
 * hashes a password, rejects duplicate emails, and sends a verification link.
 */
/** An unbounded id list is an invitation to ask for the whole table. */
const MAX_IDS = 50;

export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const idsParam = new URL(request.url).searchParams.get("ids");
  if (idsParam !== null) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);
    return ok(await getPublicUsersByIds(ids));
  }

  if (process.env.NODE_ENV === "production") {
    return forbidden("Listing all users is only available in development");
  }
  return ok(await listUsers());
}
