import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  getUserById,
  getUsersByIds,
  listUsers,
  updateUser,
} from "@/lib/server/users";
import { users as seedUsers } from "@/lib/seed-data";
import { vetUsers } from "@/lib/seed-data/vets";
import { staffUsers } from "@/lib/seed-data/store";
import { shelterUsers } from "@/lib/seed-data/shelters";
import { updateUserSchema } from "@/lib/validation/schemas";

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("users", () => {
  it("returns a user in the denormalized API shape", async () => {
    const u = await getUserById("u1", db);
    expect(u).not.toBeNull();
    expect(u!.name).toBe("Maya Chen");
    expect(u!.address).toEqual({
      city: "Austin",
      state: "TX",
      lat: 30.2672,
      lng: -97.7431,
    });
    expect(u!.roles).toEqual(["owner"]);
  });

  it("returns null for an unknown user", async () => {
    expect(await getUserById("nope", db)).toBeNull();
  });

  it("batch-resolves users by id", async () => {
    const users = await getUsersByIds(["u1", "u3", "u7"], db);
    expect(users.map((u) => u.id).sort()).toEqual(["u1", "u3", "u7"]);
  });

  it("returns [] for an empty id list without hitting the db", async () => {
    expect(await getUsersByIds([], db)).toEqual([]);
  });

  it("lists all seeded users", async () => {
    // Derived, not a magic number — adding a seed user shouldn't fail this.
    const expected =
      seedUsers.length +
      vetUsers.length +
      staffUsers.length +
      shelterUsers.length;
    expect((await listUsers(db)).length).toBe(expected);
  });

  it("updates scalar fields and the nested address", async () => {
    const updated = await updateUser(
      "u2",
      {
        name: "Daniel R.",
        address: { city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 },
      },
      db
    );
    expect(updated!.name).toBe("Daniel R.");
    expect(updated!.address.city).toBe("Dallas");
  });

  it("cannot be used to mark yourself verified", () => {
    // The email-verification badge is not self-service. Enforced by the schema
    // rather than the handler, so every caller inherits it.
    const parsed = updateUserSchema.safeParse({ name: "x", verified: true });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "verified" in parsed.data).toBe(false);
  });

  it("cannot be used to change the account email", () => {
    const parsed = updateUserSchema.safeParse({ email: "someone.else@example.com" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "email" in parsed.data).toBe(false);
  });

  it("updates roles (onboarding role selection)", async () => {
    const updated = await updateUser("u1", { roles: ["owner", "caretaker"] }, db);
    expect(updated!.roles).toEqual(["owner", "caretaker"]);
  });

  it("returns null when updating an unknown user", async () => {
    expect(await updateUser("ghost", { name: "x" }, db)).toBeNull();
  });
});
