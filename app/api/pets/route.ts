import { getPetsByIds } from "@/lib/server/pets";
import { ok } from "@/lib/server/http";

// GET /api/pets?ids=a,b,c -> Pet[]
export async function GET(request: Request) {
  const idsParam = new URL(request.url).searchParams.get("ids");
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ok(await getPetsByIds(ids));
}
