import { deleteRecord, getRecordById } from "@/lib/server/medical-records";
import { forbidden, notFound } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/medical-records/:id -> 204
//
// Only the author may withdraw a record. A pet's owner can read their animal's
// whole history but cannot delete what a vet wrote about it — a health record
// its subject can rewrite is not a record.
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const record = await getRecordById(id);
  if (!record) return notFound(`Record ${id} not found`);
  if (record.authorUserId !== auth.uid) {
    return forbidden("Only the author can remove this record");
  }

  await deleteRecord(id);
  return new Response(null, { status: 204 });
}
