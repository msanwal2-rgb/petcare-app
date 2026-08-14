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
    const expected = seedUsers.length + vetUsers.length + 1; // +1 store ops account
    expect((await listUsers(db)).length).toBe(expected);
  });

  it("updates scalar fields and the nested address", async () => {
    const updated = await updateUser(
      "u2",
      {
        name: "Daniel R.",
        verified: true,
        address: { city: "Dallas", state: "TX", lat: 32.78, lng: -96.8 },
      },
      db
    );
    expect(updated!.name).toBe("Daniel R.");
    expect(updated!.verified).toBe(true);
    expect(updated!.address.city).toBe("Dallas");
  });

  it("updates roles (onboarding role selection)", async () => {
    const updated = await updateUser("u1", { roles: ["owner", "caretaker"] }, db);
    expect(updated!.roles).toEqual(["owner", "caretaker"]);
  });

  it("returns null when updating an unknown user", async () => {
    expect(await updateUser("ghost", { name: "x" }, db)).toBeNull();
  });
});
