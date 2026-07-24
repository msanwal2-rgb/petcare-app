import { getCaretakerById } from "@/lib/server/caretakers";
import { notFound, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/caretakers/:id -> CaretakerWithUser | 404
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const caretaker = await getCaretakerById(id);
  return caretaker ? ok(caretaker) : notFound(`Caretaker ${id} not found`);
}
