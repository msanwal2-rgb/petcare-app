import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  EmailTakenError,
  linkGoogleToUser,
  linkOrCreateOAuthUser,
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
  const google = (over: Partial<Parameters<typeof linkOrCreateOAuthUser>[0]> = {}) => ({
    email: "oauth.user@gmail.com",
    emailVerified: true,
    googleId: "google-sub-1",
    name: "OAuth User",
    ...over,
  });

  it("creates a user on first sign-in, returns the same on the next", async () => {
    const first = await linkOrCreateOAuthUser(google(), db);
    expect(first.ok).toBe(true);
    expect(first.ok && first.created).toBe(true);
    expect(first.ok && first.user.verified).toBe(true);

    const second = await linkOrCreateOAuthUser(google(), db);
    expect(second.ok && second.created).toBe(false);
    expect(second.ok && first.ok && second.user.id).toBe(first.ok && first.user.id);
  });

  it("recognises the Google account even after the address changes", async () => {
    const first = await linkOrCreateOAuthUser(google(), db);
    // Same `sub`, new address: still the same person.
    const renamed = await linkOrCreateOAuthUser(
      google({ email: "new.address@gmail.com" }),
      db
    );
    expect(renamed.ok && first.ok && renamed.user.id).toBe(first.ok && first.user.id);
  });

  it("refuses an unverified Google address", async () => {
    const result = await linkOrCreateOAuthUser(google({ emailVerified: false }), db);
    expect(result).toEqual({ ok: false, reason: "email_unverified" });
  });

  it("refuses to take over an existing password account", async () => {
    // The pre-hijack: register a password account at someone's address before
    // they arrive, and a naive email lookup hands you their Google sign-in.
    const result = await linkOrCreateOAuthUser(
      google({ email: "maya.chen@example.com", googleId: "attacker-sub" }),
      db
    );
    expect(result).toEqual({ ok: false, reason: "account_exists" });

    const maya = await db.user.findUnique({ where: { id: "u1" } });
    expect(maya!.googleId).toBeNull();
  });

  it("adopts an account that has no password, since nobody can reach it by one", async () => {
    const passwordless = await db.user.create({
      data: {
        id: "u_invited",
        name: "Invited",
        email: "invited@gmail.com",
        avatarUrl: "",
        roles: [],
        addressCity: "Austin",
        addressState: "TX",
        lat: 30.2672,
        lng: -97.7431,
        verified: false,
        createdAt: new Date().toISOString(),
      },
    });

    const result = await linkOrCreateOAuthUser(
      google({ email: "invited@gmail.com", googleId: "invited-sub" }),
      db
    );
    expect(result.ok && result.user.id).toBe(passwordless.id);
    expect(result.ok && result.user.verified).toBe(true);
  });

  it("will not let a second account claim a Google id already linked", async () => {
    await linkOrCreateOAuthUser(google(), db);
    const other = await linkGoogleToUser("u2", "google-sub-1", db);
    expect(other).toEqual({ ok: false, reason: "taken" });
  });
});
