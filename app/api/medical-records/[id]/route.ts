import {
  deleteRecord,
  getRecordById,
  updateRecord,
} from "@/lib/server/medical-records";
import { medicalRecordPatchSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Only the author may amend or withdraw a record. A pet's owner can read their
 * animal's whole history but cannot edit what a vet wrote about it — a health
 * record that the subject can rewrite is not a record.
 */
async function requireAuthor(id: string) {
  const auth = await requireUser();
  if ("response" in auth) return auth;

  const record = await getRecordById(id);
  if (!record) return { response: notFound(`Record ${id} not found`) };
  if (record.authorUserId !== auth.uid) {
    return { response: forbidden("Only the author can change this record") };
  }
  return { record };
}

// PATCH /api/medical-records/:id -> MedicalRecord
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const guard = await requireAuthor(id);
  if ("response" in guard) return guard.response;

  const parsed = await parseBody(request, medicalRecordPatchSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await updateRecord(id, parsed.data));
}

// DELETE /api/medical-records/:id -> 204
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const guard = await requireAuthor(id);
  if ("response" in guard) return guard.response;

  await deleteRecord(id);
  return new Response(null, { status: 204 });
}
