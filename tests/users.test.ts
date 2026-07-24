import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  createUser,
  getUserById,
  getUsersByIds,
  listUsers,
  updateUser,
} from "@/lib/server/users";

beforeEach(async () => {
  await seedDatabase(db);
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
    expect((await listUsers(db)).length).toBe(16);
  });

  it("creates a user with sensible defaults", async () => {
    const created = await createUser(
      { name: "Test Person", email: "test.person@example.com" },
      db
    );
    expect(created.id).toMatch(/^u_/);
    expect(created.phone).toBe("");
    expect(created.roles).toEqual([]);
    expect(created.verified).toBe(false);
    expect(created.avatarUrl).toContain("http");
    // round-trips through the db
    const fetched = await getUserById(created.id, db);
    expect(fetched!.email).toBe("test.person@example.com");
  });

  it("creates a user with provided phone and roles", async () => {
    const created = await createUser(
      {
        name: "Both Roles",
        email: "both@example.com",
        phone: "(555) 555-5555",
        roles: ["owner", "caretaker"],
      },
      db
    );
    expect(created.phone).toBe("(555) 555-5555");
    expect(created.roles).toEqual(["owner", "caretaker"]);
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
