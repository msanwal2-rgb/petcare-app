import { searchCaretakers } from "@/lib/server/caretakers";
import { searchQuerySchema } from "@/lib/validation/schemas";
import { ok, parseQuery } from "@/lib/server/http";

// GET /api/caretakers/search?lat&lng&radiusMiles&serviceType&species&startDate&endDate&minPrice&maxPrice
// -> CaretakerWithUser[] (sorted by distance when lat/lng given, else rating)
export async function GET(request: Request) {
  const parsed = parseQuery(request, searchQuerySchema);
  if ("response" in parsed) return parsed.response;
  return ok(await searchCaretakers(parsed.data));
}
