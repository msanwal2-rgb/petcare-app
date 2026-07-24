import { searchCaretakers } from "@/lib/server/caretakers";
import { searchQuerySchema } from "@/lib/validation/schemas";
import { error, ok } from "@/lib/server/http";

// GET /api/caretakers/search?lat&lng&radiusMiles&serviceType&species&startDate&endDate&minPrice&maxPrice
// -> CaretakerWithUser[] (sorted by distance when lat/lng given, else rating)
export async function GET(request: Request) {
  const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = searchQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return error("Invalid search parameters", 400, {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return ok(await searchCaretakers(parsed.data));
}
