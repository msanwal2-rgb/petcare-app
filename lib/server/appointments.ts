/**
 * Vet appointments — server logic. The vet-side analogue of lib/server/bookings.ts,
 * including the same server-enforced status machine.
 *
 * Lifecycle:
 *   requested → confirmed → in_progress → completed
 * with `declined` (vet) and `cancelled` (either party) as terminal branches.
 *
 * Who may move it is a separate question from whether the move is legal, and
 * both are enforced: TRANSITIONS says what's reachable, ACTOR_ALLOWED says who
 * may do it. An owner cannot confirm their own appointment.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toAppointment } from "./serialize";
import { genId, nowIso } from "./ids";
import { refreshResponseRate } from "./reputation";
import { notify } from "./notifications";
import type { AppointmentStatus, NotificationKind } from "@/types";
import type { CreateAppointmentBody } from "@/lib/validation/schemas";

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  requested: ["confirmed", "declined", "cancelled"],
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

export type AppointmentActor = "owner" | "vet";

/** Which party may drive each transition. */
const ACTOR_ALLOWED: Record<AppointmentStatus, AppointmentActor[]> = {
  requested: [],
  confirmed: ["vet"],
  declined: ["vet"],
  in_progress: ["vet"],
  completed: ["vet"],
  cancelled: ["owner", "vet"],
};

/** What the owner hears when a vet moves their appointment along. */
const APPOINTMENT_NOTICES: Partial<
  Record<AppointmentStatus, (reason: string) => { kind: NotificationKind; title: string; body: string }>
> = {
  confirmed: (reason) => ({
    kind: "appointment_confirmed",
    title: "Your vet appointment is confirmed",
    body: `${reason} — see the appointment for the time and what to bring.`,
  }),
  declined: (reason) => ({
    kind: "appointment_declined",
    title: "Your vet couldn't take that appointment",
    body: `${reason} — you can request another time or find a different vet.`,
  }),
  completed: (reason) => ({
    kind: "appointment_completed",
    title: "Your visit summary is ready",
    body: `${reason} — notes and any prescriptions are in your pet's health record.`,
  }),
};

export type AppointmentStatusResult =
  | { ok: true; appointment: ReturnType<typeof toAppointment> }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid_transition"; from: AppointmentStatus; to: AppointmentStatus }
  | { ok: false; code: "not_allowed"; actor: AppointmentActor; to: AppointmentStatus };

export async function getAppointmentsByOwner(
  ownerId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.vetAppointment.findMany({
    where: { ownerId },
    orderBy: { startDateTime: "desc" },
  });
  return rows.map(toAppointment);
}

export async function getAppointmentsByVet(
  vetId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.vetAppointment.findMany({
    where: { vetId },
    orderBy: { startDateTime: "desc" },
  });
  return rows.map(toAppointment);
}

export async function getAppointmentsByPet(
  petId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.vetAppointment.findMany({
    where: { petId },
    orderBy: { startDateTime: "desc" },
  });
  return rows.map(toAppointment);
}

export async function getAppointmentById(
  id: string,
  db: PrismaClient = defaultPrisma
) {
  const a = await db.vetAppointment.findUnique({ where: { id } });
  return a ? toAppointment(a) : null;
}

export type CreateAppointmentResult =
  | { ok: true; appointment: ReturnType<typeof toAppointment> }
  | { ok: false; code: "vet_not_found" }
  | { ok: false; code: "species_not_accepted"; species: string }
  | { ok: false; code: "mode_not_offered"; mode: string };

/**
 * Book an appointment. The fee is taken from the vet's profile rather than the
 * request body — the client shouldn't get to name its own price, and it's the
 * same reasoning as re-pricing a cart at checkout.
 */
export async function createAppointment(
  input: CreateAppointmentBody,
  db: PrismaClient = defaultPrisma
): Promise<CreateAppointmentResult> {
  const vet = await db.vetProfile.findUnique({ where: { id: input.vetId } });
  if (!vet) return { ok: false, code: "vet_not_found" };

  const pet = await db.pet.findUnique({
    where: { id: input.petId },
    select: { species: true },
  });
  if (!pet) return { ok: false, code: "vet_not_found" };

  if (!vet.acceptedSpecies.includes(pet.species)) {
    return { ok: false, code: "species_not_accepted", species: pet.species };
  }
  if (!vet.consultModes.includes(input.mode)) {
    return { ok: false, code: "mode_not_offered", mode: input.mode };
  }

  const a = await db.vetAppointment.create({
    data: {
      ...input,
      id: genId("a"),
      status: "requested",
      fee: vet.consultFee,
      createdAt: nowIso(),
    },
  });
  await refreshResponseRate("vet", a.vetId, db);
  return { ok: true, appointment: toAppointment(a) };
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
  actor: AppointmentActor,
  db: PrismaClient = defaultPrisma
): Promise<AppointmentStatusResult> {
  const existing = await db.vetAppointment.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const from = existing.status as AppointmentStatus;
  if (from === status) {
    return { ok: true, appointment: toAppointment(existing) };
  }
  if (!TRANSITIONS[from].includes(status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }
  if (!ACTOR_ALLOWED[status].includes(actor)) {
    return { ok: false, code: "not_allowed", actor, to: status };
  }

  const a = await db.vetAppointment.update({ where: { id }, data: { status } });
  await refreshResponseRate("vet", a.vetId, db);

  // The owner is the one waiting on an answer, so they are the one told.
  const told = APPOINTMENT_NOTICES[status];
  if (told) {
    await notify(a.ownerId, { ...told(a.reason), href: `/appointments/${a.id}` }, db);
  }

  return { ok: true, appointment: toAppointment(a) };
}
