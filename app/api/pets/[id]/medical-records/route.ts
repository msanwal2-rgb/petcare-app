import {
  createRecord,
  getRecordsForPet,
  ownerMayAuthor,
} from "@/lib/server/medical-records";
import { medicalRecordSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { canAccessPetRecords, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id/medical-records -> MedicalRecord[]
// Auth: the pet's owner, or a vet currently treating this pet.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const access = await canAccessPetRecords(auth.uid, id);
  if (!access.allowed) return forbidden();
  return ok(await getRecordsForPet(id));
}

// POST /api/pets/:id/medical-records -> MedicalRecord (201)
// Auth: a treating vet may write any entry type. The owner may only add the
// self-reported kinds — a prescription written by the patient's owner would
// defeat the point of the Rx gate in the store.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const access = await canAccessPetRecords(auth.uid, id);
  if (!access.allowed) return forbidden();

  const parsed = await parseBody(request, medicalRecordSchema);
  if ("response" in parsed) return parsed.response;

  const authoringAsVet = access.asVetId !== null;
  if (!authoringAsVet && !ownerMayAuthor(parsed.data.type)) {
    return forbidden(
      "Only the treating vet can add that kind of record. You can add allergies and weights yourself."
    );
  }

  const record = await createRecord(id, auth.uid, access.asVetId, parsed.data);
  return ok(record, 201);
}
