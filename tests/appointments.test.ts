import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  createAppointment,
  getAppointmentById,
  getAppointmentsByOwner,
  getAppointmentsByPet,
  getAppointmentsByVet,
  updateAppointmentStatus,
} from "@/lib/server/appointments";

const newAppointment = {
  ownerId: "u1",
  vetId: "v1",
  petId: "p1",
  mode: "in_clinic" as const,
  reason: "Limping after a long walk",
  symptoms: ["Limping"],
  startDateTime: "2026-08-01T15:00:00Z",
  endDateTime: "2026-08-01T15:30:00Z",
  notes: "",
};

beforeAll(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("appointment reads", () => {
  it("lists an owner's appointments newest-first", async () => {
    const list = await getAppointmentsByOwner("u1", db);
    expect(list.length).toBe(2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].startDateTime >= list[i].startDateTime).toBe(true);
    }
  });

  it("returns [] for an owner with no appointments", async () => {
    expect(await getAppointmentsByOwner("u7", db)).toEqual([]);
  });

  it("lists a vet's schedule", async () => {
    const list = await getAppointmentsByVet("v1", db);
    expect(list.every((a) => a.vetId === "v1")).toBe(true);
  });

  it("lists a pet's appointment history", async () => {
    const list = await getAppointmentsByPet("p4", db);
    expect(list.map((a) => a.id)).toEqual(["a1"]);
  });

  it("gets an appointment by id", async () => {
    const a = await getAppointmentById("a3", db);
    expect(a!.status).toBe("confirmed");
    expect(a!.petId).toBe("p1");
  });

  it("returns null for an unknown appointment", async () => {
    expect(await getAppointmentById("nope", db)).toBeNull();
  });
});

describe("appointment creation", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("creates an appointment in the requested state", async () => {
    const res = await createAppointment(newAppointment, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.appointment.id).toMatch(/^a_/);
    expect(res.appointment.status).toBe("requested");
    expect(res.appointment.createdAt).toBeTruthy();
  });

  it("takes the fee from the vet's profile, not the request", async () => {
    const res = await createAppointment(
      { ...newAppointment, vetId: "v2" },
      db
    );
    expect(res.ok).toBe(true);
    // v2 charges 140; nothing in the request body could have said otherwise
    if (res.ok) expect(res.appointment.fee).toBe(140);
  });

  it("rejects an unknown vet", async () => {
    const res = await createAppointment({ ...newAppointment, vetId: "ghost" }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("vet_not_found");
  });

  it("rejects an unknown pet", async () => {
    const res = await createAppointment({ ...newAppointment, petId: "ghost" }, db);
    expect(res.ok).toBe(false);
  });

  it("rejects a species the vet doesn't treat", async () => {
    // p7 (Ziggy) is an "other" species; v1 accepts only dogs and cats
    const res = await createAppointment(
      { ...newAppointment, ownerId: "u5", petId: "p7" },
      db
    );
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "species_not_accepted") {
      expect(res.species).toBe("other");
    }
  });

  it("rejects a consult mode the vet doesn't offer", async () => {
    // v1 offers in_clinic and video, not home visits
    const res = await createAppointment({ ...newAppointment, mode: "home_visit" }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("mode_not_offered");
  });
});

describe("appointment status lifecycle", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("lets the vet confirm a requested appointment", async () => {
    const res = await updateAppointmentStatus("a4", "confirmed", "vet", db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.appointment.status).toBe("confirmed");
  });

  it("walks the happy path requested → confirmed → in_progress → completed", async () => {
    await updateAppointmentStatus("a4", "confirmed", "vet", db);
    await updateAppointmentStatus("a4", "in_progress", "vet", db);
    const res = await updateAppointmentStatus("a4", "completed", "vet", db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.appointment.status).toBe("completed");
  });

  it("lets either party cancel", async () => {
    expect((await updateAppointmentStatus("a4", "cancelled", "owner", db)).ok).toBe(true);
    expect((await updateAppointmentStatus("a3", "cancelled", "vet", db)).ok).toBe(true);
  });

  it("refuses to let an owner confirm their own appointment", async () => {
    const res = await updateAppointmentStatus("a4", "confirmed", "owner", db);
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "not_allowed") expect(res.actor).toBe("owner");
  });

  it("refuses to let an owner decline or complete", async () => {
    expect((await updateAppointmentStatus("a4", "declined", "owner", db)).ok).toBe(false);
    await updateAppointmentStatus("a4", "confirmed", "vet", db);
    await updateAppointmentStatus("a4", "in_progress", "vet", db);
    expect((await updateAppointmentStatus("a4", "completed", "owner", db)).ok).toBe(false);
  });

  it("rejects skipping requested → completed", async () => {
    const res = await updateAppointmentStatus("a4", "completed", "vet", db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_transition");
  });

  it("rejects changing a completed appointment", async () => {
    const res = await updateAppointmentStatus("a1", "in_progress", "vet", db);
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "invalid_transition") expect(res.from).toBe("completed");
  });

  it("rejects reviving a cancelled appointment", async () => {
    const res = await updateAppointmentStatus("a6", "confirmed", "vet", db);
    expect(res.ok).toBe(false);
  });

  it("reports not_found for an unknown appointment", async () => {
    const res = await updateAppointmentStatus("ghost", "confirmed", "vet", db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });

  it("treats a no-op same-status update as valid", async () => {
    const res = await updateAppointmentStatus("a4", "requested", "owner", db);
    expect(res.ok).toBe(true);
  });
});
