import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  forceSignOut,
  getAdminUserDetail,
  reactivateUser,
  searchAdminUsers,
  setStaffRoles,
  setUserRoles,
  setUserVerified,
  softDeleteUser,
  suspendUser,
} from "@/lib/server/admin/users";
import { getAdminStats } from "@/lib/server/admin/stats";
import { hasStaffRole, isOps, staffRoles } from "@/lib/server/access";
import { listAuditEntries } from "@/lib/server/audit";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { adminUserActionSchema } from "@/lib/validation/admin-schemas";

const ADMIN = { uid: "u22" }; // Priya, seeded with staffRoles ["admin"]
const OPS = "u21"; // Rosa, ["ops"]
const SUPPORT = "u23"; // Tom, ["support", "finance"]

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("staff roles", () => {
  it("grants exactly what was seeded", async () => {
    expect(await staffRoles(OPS, db)).toEqual(["ops"]);
    expect(await staffRoles(SUPPORT, db)).toEqual(["support", "finance"]);
    expect(await staffRoles("u1", db)).toEqual([]);
  });

  it("lets admin satisfy every other role", async () => {
    // The point of stating this once: twenty call sites would otherwise each
    // have to remember to also check for "admin".
    expect(await hasStaffRole(ADMIN.uid, "ops", db)).toBe(true);
    expect(await hasStaffRole(ADMIN.uid, "finance", db)).toBe(true);
    expect(await hasStaffRole(ADMIN.uid, "support", db)).toBe(true);
  });

  it("does not let one specific role stand in for another", async () => {
    expect(await hasStaffRole(OPS, "finance", db)).toBe(false);
    expect(await hasStaffRole(SUPPORT, "ops", db)).toBe(false);
  });

  it("keeps isOps answering the question it always answered", async () => {
    expect(await isOps(OPS, db)).toBe(true);
    expect(await isOps(ADMIN.uid, db)).toBe(true);
    expect(await isOps("u1", db)).toBe(false);
  });

  it("says no for a user that does not exist", async () => {
    expect(await hasStaffRole("ghost", "admin", db)).toBe(false);
  });
});

describe("user search", () => {
  it("paginates without overlap", async () => {
    const first = await searchAdminUsers({ limit: 5, offset: 0 }, db);
    const second = await searchAdminUsers({ limit: 5, offset: 5 }, db);
    expect(first.items).toHaveLength(5);
    const overlap = first.items.filter((a) =>
      second.items.some((b) => b.id === a.id)
    );
    expect(overlap).toEqual([]);
    expect(first.total).toBe(second.total);
  });

  it("caps an absurd limit rather than dumping the table", async () => {
    const page = await searchAdminUsers({ limit: 100_000 }, db);
    expect(page.limit).toBeLessThanOrEqual(100);
  });

  it("finds by email fragment, case-insensitively", async () => {
    const page = await searchAdminUsers({ q: "MAYA.CHEN" }, db);
    expect(page.items.map((u) => u.id)).toContain("u1");
  });

  it("matches an id exactly, so u1 does not drag in u10", async () => {
    const page = await searchAdminUsers({ q: "u1" }, db);
    const ids = page.items.map((u) => u.id);
    expect(ids).toContain("u1");
    expect(ids).not.toContain("u10");
  });

  it("filters by staff role", async () => {
    const page = await searchAdminUsers({ staffRole: "ops" }, db);
    expect(page.items.map((u) => u.id)).toEqual([OPS]);
  });

  it("filters by marketplace role", async () => {
    const page = await searchAdminUsers({ role: "vet", limit: 100 }, db);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((u) => u.roles.includes("vet"))).toBe(true);
  });

  it("filters by how the account signs in", async () => {
    const page = await searchAdminUsers({ authMethod: "password", limit: 100 }, db);
    expect(page.items.every((u) => u.authMethods.includes("password"))).toBe(true);

    const google = await searchAdminUsers({ authMethod: "google" }, db);
    expect(google.total).toBe(0); // nothing seeded is linked to Google
  });

  it("never returns a password hash", async () => {
    const page = await searchAdminUsers({ limit: 5 }, db);
    for (const item of page.items) {
      expect(JSON.stringify(item)).not.toContain("$2");
    }
  });

  it("sorts by name", async () => {
    const page = await searchAdminUsers({ sort: "name", limit: 100 }, db);
    const names = page.items.map((u) => u.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe("user detail", () => {
  it("gathers counts and profiles in one shot", async () => {
    const detail = await getAdminUserDetail("u1", db);
    expect(detail).not.toBeNull();
    expect(detail!.counts.pets).toBeGreaterThan(0);
    expect(detail!.counts.bookings).toBeGreaterThan(0);
    expect(detail!.authMethods).toContain("password");
  });

  it("returns null for an unknown id", async () => {
    expect(await getAdminUserDetail("ghost", db)).toBeNull();
  });
});

describe("account actions", () => {
  it("verifies and un-verifies, recording both", async () => {
    await setUserVerified("u2", true, ADMIN, db);
    expect((await db.user.findUnique({ where: { id: "u2" } }))!.verified).toBe(true);

    await setUserVerified("u2", false, ADMIN, db);
    expect((await db.user.findUnique({ where: { id: "u2" } }))!.verified).toBe(false);

    const log = await listAuditEntries({ targetId: "u2" }, db);
    expect(log.items.map((e) => e.action)).toEqual(["user.unverify", "user.verify"]);
  });

  it("suspends, and cuts existing sessions off at the same moment", async () => {
    const before = new Date().toISOString();
    const result = await suspendUser("u2", "Chargeback fraud", ADMIN, db);
    expect(result.ok).toBe(true);

    const row = await db.user.findUnique({ where: { id: "u2" } });
    expect(row!.status).toBe("suspended");
    expect(row!.suspendedReason).toBe("Chargeback fraud");
    // Without this the suspension means nothing until their JWT expires.
    expect(row!.sessionsValidFrom! >= before).toBe(true);
  });

  it("reactivates and clears the suspension reason", async () => {
    await suspendUser("u2", "Mistake", ADMIN, db);
    await reactivateUser("u2", ADMIN, db);
    const row = await db.user.findUnique({ where: { id: "u2" } });
    expect(row!.status).toBe("active");
    expect(row!.suspendedAt).toBeNull();
    expect(row!.suspendedReason).toBe("");
  });

  it("forces a sign-out without suspending", async () => {
    await forceSignOut("u2", ADMIN, db);
    const row = await db.user.findUnique({ where: { id: "u2" } });
    expect(row!.sessionsValidFrom).not.toBeNull();
    expect(row!.status).toBe("active");
  });

  it("changes marketplace roles", async () => {
    const result = await setUserRoles("u2", ["owner", "caretaker"], ADMIN, db);
    expect(result.ok && result.user.roles).toEqual(["owner", "caretaker"]);
  });

  it("reports a missing user rather than throwing", async () => {
    expect(await setUserVerified("ghost", true, ADMIN, db)).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("staff role changes", () => {
  it("grants and revokes", async () => {
    const result = await setStaffRoles("u2", ["support"], ADMIN, db);
    expect(result.ok && result.user.staffRoles).toEqual(["support"]);
    expect(await hasStaffRole("u2", "support", db)).toBe(true);
  });

  it("keeps the legacy isOps column in step until it is dropped", async () => {
    await setStaffRoles("u2", ["ops"], ADMIN, db);
    expect((await db.user.findUnique({ where: { id: "u2" } }))!.isOps).toBe(true);

    await setStaffRoles("u2", ["support"], ADMIN, db);
    expect((await db.user.findUnique({ where: { id: "u2" } }))!.isOps).toBe(false);
  });

  it("refuses to let anyone edit their own staff access", async () => {
    // Otherwise "admin" is not a role, it is a starting point.
    expect(await setStaffRoles(ADMIN.uid, ["admin", "finance"], ADMIN, db)).toEqual({
      ok: false,
      code: "self_staff_edit",
    });
  });

  it("refuses to demote the last admin", async () => {
    // Losing every admin means nobody can grant the role back, and recovery is
    // a hand-written UPDATE against production.
    await setStaffRoles("u2", ["admin"], ADMIN, db);
    const demoteOne = await setStaffRoles("u2", [], ADMIN, db);
    expect(demoteOne.ok).toBe(true); // two admins existed, so this is fine

    const other = { uid: "u2" };
    await setStaffRoles("u2", ["admin"], ADMIN, db);
    const demoteLast = await setStaffRoles(ADMIN.uid, [], other, db);
    expect(demoteLast.ok).toBe(true);

    // Now u2 is the only admin left, and cannot be demoted by anyone.
    const stranded = await setStaffRoles("u2", [], { uid: "u23" }, db);
    expect(stranded).toEqual({ ok: false, code: "last_admin" });
  });
});

describe("soft delete", () => {
  it("scrubs the person and keeps the row", async () => {
    const detail = await getAdminUserDetail("u7", db);
    expect(detail).not.toBeNull();

    const result = await softDeleteUser("u7", ADMIN, db);
    expect(result.ok).toBe(true);

    const row = await db.user.findUnique({ where: { id: "u7" } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("deleted");
    expect(row!.name).toBe("Deleted account");
    expect(row!.email).not.toContain("@example.com");
    expect(row!.passwordHash).toBeNull();
    expect(row!.phone).toBe("");
    expect(row!.roles).toEqual([]);
    // And they cannot get back in on an old cookie.
    expect(row!.sessionsValidFrom).not.toBeNull();
  });

  it("refuses to delete yourself", async () => {
    expect(await softDeleteUser(ADMIN.uid, ADMIN, db)).toEqual({
      ok: false,
      code: "self_staff_edit",
    });
  });
});

describe("audit log", () => {
  it("attributes each entry to the admin who acted", async () => {
    await suspendUser("u2", "Testing", ADMIN, db);
    const log = await listAuditEntries({ actorUserId: ADMIN.uid }, db);
    expect(log.items[0]!.action).toBe("user.suspend");
    expect(log.items[0]!.actorEmail).toBe("priya.raman@example.com");
    expect(log.items[0]!.metadata).toMatchObject({ reason: "Testing" });
  });

  it("paginates newest first", async () => {
    await setUserVerified("u2", true, ADMIN, db);
    await setUserVerified("u3", true, ADMIN, db);
    const log = await listAuditEntries({ limit: 1 }, db);
    expect(log.items).toHaveLength(1);
    expect(log.total).toBeGreaterThanOrEqual(2);
    expect(log.items[0]!.targetId).toBe("u3");
  });
});

describe("settings", () => {
  it("returns defaults when nothing is stored", async () => {
    const settings = await getSettings(db);
    expect(settings.signupsOpen).toBe(true);
    expect(settings.freeShippingThresholdCents).toBe(4900);
  });

  it("round-trips a change", async () => {
    const after = await updateSettings({ signupsOpen: false }, ADMIN.uid, db);
    expect(after.signupsOpen).toBe(false);
    expect((await getSettings(db)).signupsOpen).toBe(false);
  });

  it("ignores keys it does not recognise", async () => {
    await updateSettings(
      { signupsOpen: false, sudo: true } as never,
      ADMIN.uid,
      db
    );
    const rows = await db.systemSetting.findMany();
    expect(rows.map((r) => r.key)).toEqual(["signupsOpen"]);
  });

  it("falls back to the default when a stored value is the wrong type", async () => {
    // A hand-edited row must not be able to crash every page that reads it.
    await db.systemSetting.create({
      data: {
        key: "freeShippingThresholdCents",
        value: "not a number" as never,
        updatedAt: new Date().toISOString(),
        updatedBy: "hand",
      },
    });
    expect((await getSettings(db)).freeShippingThresholdCents).toBe(4900);
  });
});

describe("the action schema", () => {
  it("demands a reason with a suspension", async () => {
    expect(adminUserActionSchema.safeParse({ action: "suspend" }).success).toBe(false);
    expect(
      adminUserActionSchema.safeParse({ action: "suspend", reason: "ok" }).success
    ).toBe(false); // too short to be a reason
    expect(
      adminUserActionSchema.safeParse({ action: "suspend", reason: "Fraud" }).success
    ).toBe(true);
  });

  it("will not let a reason ride along with an unrelated action", async () => {
    const parsed = adminUserActionSchema.safeParse({
      action: "reactivate",
      reason: "sneaky",
    });
    expect(parsed.success && "reason" in parsed.data).toBe(false);
  });
});

describe("overview stats", () => {
  it("counts what the page shows", async () => {
    const stats = await getAdminStats(new Date(), db);
    expect(stats.users.total).toBeGreaterThan(0);
    expect(stats.users.staff).toBe(3);
    expect(stats.orders.total).toBeGreaterThan(0);
    expect(stats.catalog.active).toBeGreaterThan(0);
  });

  it("excludes refunded and cancelled orders from gross value", async () => {
    const before = await getAdminStats(new Date(), db);
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a delivered order in the seed");

    await db.order.update({
      where: { id: order.id },
      data: { status: "refunded" },
    });

    const after = await getAdminStats(new Date(), db);
    expect(after.orders.grossCents).toBe(before.orders.grossCents - order.totalCents);
  });

  it("leaves deleted accounts out of the headline count", async () => {
    const before = await getAdminStats(new Date(), db);
    await softDeleteUser("u7", ADMIN, db);
    const after = await getAdminStats(new Date(), db);
    expect(after.users.total).toBe(before.users.total - 1);
  });
});
