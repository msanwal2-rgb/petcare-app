/**
 * Email verification and password reset flows. Each "request" creates a token
 * and emails a link; each "confirm" consumes the token and applies the change.
 * Password-reset requests never reveal whether an email exists.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toUser } from "./serialize";
import { nowIso } from "./ids";
import { hashPassword } from "./auth-logic";
import { createToken, consumeToken } from "./tokens";
import { sendMail } from "./mailer";

function emailShell(title: string, intro: string, link: string, cta: string) {
  const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto">
    <h2>${title}</h2><p>${intro}</p>
    <p><a href="${link}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">${cta}</a></p>
    <p style="color:#888;font-size:12px">Or paste this link: ${link}</p>
  </div>`;
  const text = `${title}\n\n${intro}\n\n${cta}: ${link}`;
  return { html, text };
}

export async function requestEmailVerification(
  user: { id: string; email: string; name: string },
  origin: string,
  db: PrismaClient = defaultPrisma
): Promise<{ link: string }> {
  const token = await createToken(user.id, "verify_email", db);
  const link = `${origin}/verify-email?token=${token}`;
  const { html, text } = emailShell(
    "Verify your email",
    `Hi ${user.name.split(" ")[0]}, confirm your email to finish setting up your Leash account.`,
    link,
    "Verify email"
  );
  await sendMail({ to: user.email, subject: "Verify your Leash email", html, text });
  return { link };
}

/** Consume a verify token and mark the user verified. Returns the user or null. */
export async function verifyEmailToken(
  raw: string,
  db: PrismaClient = defaultPrisma
) {
  const userId = await consumeToken(raw, "verify_email", db);
  if (!userId) return null;
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing) return null;
  const updated = await db.user.update({
    where: { id: userId },
    data: { verified: true },
  });
  return toUser(updated);
}

/**
 * Start a password reset. Always resolves the same way (whether or not the email
 * exists) to avoid account enumeration. Returns a link only when one was created.
 */
export async function requestPasswordReset(
  email: string,
  origin: string,
  db: PrismaClient = defaultPrisma
): Promise<{ link: string | null }> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) return { link: null };

  const token = await createToken(user.id, "reset_password", db);
  const link = `${origin}/reset-password?token=${token}`;
  const { html, text } = emailShell(
    "Reset your password",
    "We received a request to reset your Leash password. This link expires in 1 hour. If you didn't ask for this, you can ignore this email.",
    link,
    "Reset password"
  );
  await sendMail({ to: user.email, subject: "Reset your Leash password", html, text });
  return { link };
}

/** Consume a reset token and set a new password. Returns true on success. */
export async function resetPassword(
  raw: string,
  newPassword: string,
  db: PrismaClient = defaultPrisma
): Promise<boolean> {
  const userId = await consumeToken(raw, "reset_password", db);
  if (!userId) return false;
  const existing = await db.user.findUnique({ where: { id: userId } });
  if (!existing) return false;
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      // Every session issued before now is refused from here on.
      //
      // Sessions are JWTs with no database adapter, so there is no row to
      // delete: without this, someone who resets their password because their
      // account was compromised changes nothing for the attacker, whose cookie
      // stays valid for its full thirty days. `requireUser()` enforces it.
      sessionsValidFrom: nowIso(),
    },
  });
  return true;
}
