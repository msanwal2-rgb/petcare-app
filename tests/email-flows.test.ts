import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import { createToken, consumeToken } from "@/lib/server/tokens";
import {
  requestPasswordReset,
  resetPassword,
  verifyEmailToken,
  requestEmailVerification,
} from "@/lib/server/email-flows";
import { verifyCredentials } from "@/lib/server/auth-logic";
import { DEMO_PASSWORD } from "@/lib/auth/demo";

const ORIGIN = "http://test.local";
const tokenFromLink = (link: string) => new URL(link).searchParams.get("token")!;

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("tokens", () => {
  it("issues a token that consumes to its identifier exactly once", async () => {
    const raw = await createToken("u1", "verify_email", db);
    expect(await consumeToken(raw, "verify_email", db)).toBe("u1");
    // single-use
    expect(await consumeToken(raw, "verify_email", db)).toBeNull();
  });

  it("rejects a token used for the wrong type", async () => {
    const raw = await createToken("u1", "verify_email", db);
    expect(await consumeToken(raw, "reset_password", db)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const raw = await createToken("u1", "verify_email", db);
    await db.verificationToken.updateMany({
      where: { identifier: "u1", type: "verify_email" },
      data: { expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    expect(await consumeToken(raw, "verify_email", db)).toBeNull();
  });
});

describe("email verification", () => {
  it("verifies a user via their token", async () => {
    // u2 is seeded unverified
    const { link } = await requestEmailVerification(
      { id: "u2", email: "daniel.reyes@example.com", name: "Daniel" },
      ORIGIN,
      db
    );
    const user = await verifyEmailToken(tokenFromLink(link), db);
    expect(user?.id).toBe("u2");
    expect(user?.verified).toBe(true);
  });

  it("rejects a bogus verification token", async () => {
    expect(await verifyEmailToken("not-a-real-token", db)).toBeNull();
  });
});

describe("password reset", () => {
  it("returns a link for a known email and resets the password", async () => {
    const { link } = await requestPasswordReset("maya.chen@example.com", ORIGIN, db);
    expect(link).toBeTruthy();

    const okReset = await resetPassword(tokenFromLink(link!), "brandnew1", db);
    expect(okReset).toBe(true);

    // new password works, old one no longer does
    expect(
      await verifyCredentials("maya.chen@example.com", "brandnew1", db)
    ).not.toBeNull();
    expect(
      await verifyCredentials("maya.chen@example.com", DEMO_PASSWORD, db)
    ).toBeNull();
  });

  it("does not reveal unknown emails (no link, no throw)", async () => {
    const { link } = await requestPasswordReset("ghost@example.com", ORIGIN, db);
    expect(link).toBeNull();
  });

  it("rejects resetting with a bad token", async () => {
    expect(await resetPassword("bad-token", "whatever1", db)).toBe(false);
  });
});
