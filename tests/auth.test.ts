import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  EmailTakenError,
  findOrCreateOAuthUser,
  hashPassword,
  registerUser,
  verifyCredentials,
  verifyPassword,
} from "@/lib/server/auth-logic";
import { DEMO_PASSWORD } from "@/lib/auth/demo";

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash).not.toBe("s3cret!");
    expect(await verifyPassword("s3cret!", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("credential verification", () => {
  it("logs in a seeded demo account with the demo password", async () => {
    const user = await verifyCredentials("maya.chen@example.com", DEMO_PASSWORD, db);
    expect(user).not.toBeNull();
    expect(user!.id).toBe("u1");
  });

  it("is case-insensitive on email", async () => {
    const user = await verifyCredentials("MAYA.CHEN@EXAMPLE.COM", DEMO_PASSWORD, db);
    expect(user?.id).toBe("u1");
  });

  it("rejects a wrong password", async () => {
    expect(
      await verifyCredentials("maya.chen@example.com", "nope", db)
    ).toBeNull();
  });

  it("rejects an unknown email", async () => {
    expect(await verifyCredentials("ghost@example.com", DEMO_PASSWORD, db)).toBeNull();
  });
});

describe("registration", () => {
  it("creates an account that can then log in", async () => {
    const created = await registerUser(
      { name: "New Person", email: "new.person@example.com", password: "hunter2!" },
      db
    );
    expect(created.id).toMatch(/^u_/);
    const login = await verifyCredentials("new.person@example.com", "hunter2!", db);
    expect(login?.id).toBe(created.id);
  });

  it("normalizes email to lowercase", async () => {
    const created = await registerUser(
      { name: "Caps", email: "Caps.User@Example.com", password: "hunter2!" },
      db
    );
    expect(created.email).toBe("caps.user@example.com");
  });

  it("rejects a duplicate email", async () => {
    await expect(
      registerUser(
        { name: "Dup", email: "maya.chen@example.com", password: "hunter2!" },
        db
      )
    ).rejects.toBeInstanceOf(EmailTakenError);
  });
});

describe("oauth provisioning", () => {
  it("creates a user on first sign-in, returns the same on the next", async () => {
    const first = await findOrCreateOAuthUser(
      { email: "oauth.user@gmail.com", name: "OAuth User" },
      db
    );
    expect(first.verified).toBe(true);
    const second = await findOrCreateOAuthUser(
      { email: "oauth.user@gmail.com", name: "OAuth User" },
      db
    );
    expect(second.id).toBe(first.id);
  });

  it("links to an existing account by email", async () => {
    const linked = await findOrCreateOAuthUser(
      { email: "maya.chen@example.com", name: "Maya" },
      db
    );
    expect(linked.id).toBe("u1");
  });
});
