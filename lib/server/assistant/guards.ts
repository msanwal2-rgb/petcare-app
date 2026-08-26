/**
 * Authorization for the assistant's tools.
 *
 * Thin wrappers over lib/server/session.ts that answer in the shape a tool
 * needs. Two differences from the route-handler guards they delegate to:
 *
 * 1. **They return refusals as data, never as thrown errors or Responses.** A
 *    thrown error reaches the model as a stack trace it cannot act on; a code
 *    like `not_yours` it can explain in a sentence. The model is allowed to
 *    know it was refused — it is not allowed to know anything about the record.
 *
 * 2. **They take the context, not a user id.** Nothing in this file can be
 *    called with a user id supplied by the model, because there is nowhere to
 *    put one.
 *
 * Every guard re-checks against the database on every call. None of them trust
 * an earlier turn, and none of them trust the conversation history — a model
 * that "remembers" owning order o1 still gets refused if it does not.
 */

import {
  canAccessPetRecords,
  isAppointmentParticipant,
  isBookingParticipant,
  ownsPet,
  ownsVetProfile,
} from "@/lib/server/access";
import type { AssistantContext } from "./context";

/** Why a tool refused. Deliberately coarse — it must not leak record details. */
export type RefusalCode =
  | "needs_sign_in"
  | "not_yours"
  | "not_found"
  | "too_late"
  | "not_allowed";

export interface Refusal {
  error: RefusalCode;
  /** A short, safe explanation the model may paraphrase. */
  detail?: string;
}

export function refuse(error: RefusalCode, detail?: string): Refusal {
  return detail ? { error, detail } : { error };
}

export function isRefusal(value: unknown): value is Refusal {
  return typeof value === "object" && value !== null && "error" in value;
}

/** The signed-in user id, or a refusal. The gate every account tool opens with. */
export function requireSignedIn(ctx: AssistantContext): string | Refusal {
  if (!ctx.uid) {
    return refuse(
      "needs_sign_in",
      "This needs the customer to be signed in. Offer them a sign-in link for the page they are on.",
    );
  }
  return ctx.uid;
}

/**
 * `not_yours` is returned for a record that exists but belongs to someone else
 * *and* for one that does not exist at all, deliberately: distinguishing them
 * would let someone probe for valid ids by watching which answer they get.
 */
const NOT_YOURS = "That doesn't belong to this account.";

export async function assertOwnsPet(
  ctx: AssistantContext,
  petId: string,
): Promise<string | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  return (await ownsPet(uid, petId, ctx.db)) ? uid : refuse("not_yours", NOT_YOURS);
}

/** Read access to a pet's health record: the owner, or a vet treating it. */
export async function assertCanReadPetRecords(
  ctx: AssistantContext,
  petId: string,
): Promise<{ uid: string; asVetId: string | null } | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  const { allowed, asVetId } = await canAccessPetRecords(uid, petId, ctx.db);
  return allowed ? { uid, asVetId } : refuse("not_yours", NOT_YOURS);
}

export async function assertBookingParticipant(
  ctx: AssistantContext,
  bookingId: string,
): Promise<string | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  return (await isBookingParticipant(uid, bookingId, ctx.db))
    ? uid
    : refuse("not_yours", NOT_YOURS);
}

export async function assertAppointmentParticipant(
  ctx: AssistantContext,
  appointmentId: string,
): Promise<string | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  return (await isAppointmentParticipant(uid, appointmentId, ctx.db))
    ? uid
    : refuse("not_yours", NOT_YOURS);
}

/**
 * Which side of an appointment the caller is on.
 *
 * Derived from the session, never accepted as an argument. This is what stops
 * an owner confirming their own appointment through the assistant: only a vet
 * may confirm, and the only way to be the vet here is to actually own the vet
 * profile the appointment was booked with.
 */
export async function appointmentActor(
  ctx: AssistantContext,
  vetId: string,
): Promise<"owner" | "vet"> {
  if (!ctx.uid) return "owner";
  return (await ownsVetProfile(ctx.uid, vetId, ctx.db)) ? "vet" : "owner";
}

/** An order is the one record whose ownership is a plain column check. */
export async function assertOwnsOrder(
  ctx: AssistantContext,
  orderId: string,
): Promise<string | Refusal> {
  const uid = requireSignedIn(ctx);
  if (typeof uid !== "string") return uid;
  const order = await ctx.db.order.findUnique({
    where: { id: orderId },
    select: { userId: true },
  });
  return order?.userId === uid ? uid : refuse("not_yours", NOT_YOURS);
}
