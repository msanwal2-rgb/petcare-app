import { searchVets } from "@/lib/server/vets";
import { vetSearchQuerySchema } from "@/lib/validation/schemas";
import { ok, parseQuery } from "@/lib/server/http";

// GET /api/vets/search?lat&lng&radiusMiles&specialty&species&mode&emergencyOnly
// -> VetWithUser[] (sorted by distance when lat/lng given, else rating)
export async function GET(request: Request) {
  const parsed = parseQuery(request, vetSearchQuerySchema);
  if ("response" in parsed) return parsed.response;
  return ok(await searchVets(parsed.data));
}
