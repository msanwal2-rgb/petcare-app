import { searchShelters } from "@/lib/server/shelters";
import { ok, parseQuery } from "@/lib/server/http";
import { shelterSearchQuerySchema } from "@/lib/validation/schemas";

// GET /api/shelters/search -> ShelterWithUser[] — public, like vet search.
export async function GET(request: Request) {
  const parsed = parseQuery(request, shelterSearchQuerySchema);
  if ("response" in parsed) return parsed.response;
  return ok(await searchShelters(parsed.data));
}
