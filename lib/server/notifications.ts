/**
 * Notifications — the things that happen to you while you aren't looking.
 *
 * `notify()` is the only way one gets created, and the status machines are the
 * only callers. That single seam is deliberate: it means an in-app record and
 * an email are one call, not two systems to keep in step, and adding a channel
 * later is a change here rather than at a dozen call sites.
 *
 * Email is best-effort. A notification that reached the bell but not the inbox
 * is a degraded delivery; a status change that failed because a mail server
 * was down would be a bug.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "./ids";
import { sendMail } from "./mailer";
import type { Notification, NotificationKind } from "@/types";

function toNotification(n: {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}): Notification {
  return {
    id: n.id,
    userId: n.userId,
    kind: n.kind as NotificationKind,
    title: n.title,
    body: n.body,
    href: n.href,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Where clicking it should land — the booking, order or appointment. */
  href: string;
}

/**
 * Tell someone something happened. Returns the stored notification.
 *
 * Callers are status machines running inside a request that has already
 * succeeded, so this never throws: a failure to notify must not roll back the
 * thing being notified about.
 */
export async function notify(
  userId: string,
  input: NotifyInput,
  db: PrismaClient = defaultPrisma
): Promise<Notification | null> {
  try {
    const row = await db.notification.create({
      data: {
        id: genId("n"),
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? "",
        href: input.href,
        createdAt: nowIso(),
      },
    });

    void emailIfPossible(userId, input, db);
    return toNotification(row);
  } catch (e) {
    console.error("[notify] could not record notification", e);
    return null;
  }
}

/** Mirror to email when we have somewhere to send it. Never awaited by callers. */
async function emailIfPossible(
  userId: string,
  input: NotifyInput,
  db: PrismaClient
): Promise<void> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) return;
    const line = input.body ? `${input.title}\n\n${input.body}` : input.title;
    await sendMail({
      to: user.email,
      subject: input.title,
      text: `Hi ${user.name.split(" ")[0]},\n\n${line}\n\nLeash`,
      html: `<p>Hi ${user.name.split(" ")[0]},</p><p><strong>${input.title}</strong></p><p>${input.body ?? ""}</p><p>— Leash</p>`,
    });
  } catch (e) {
    console.error("[notify] email delivery failed", e);
  }
}

export async function listNotifications(
  userId: string,
  db: PrismaClient = defaultPrisma
): Promise<Notification[]> {
  const rows = await db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map(toNotification);
}

export async function unreadCount(
  userId: string,
  db: PrismaClient = defaultPrisma
): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

/** Mark one notification read, or all of them when no id is given. */
export async function markRead(
  userId: string,
  id: string | undefined,
  db: PrismaClient = defaultPrisma
): Promise<number> {
  const { count } = await db.notification.updateMany({
    // Scoped by userId as well as id — you can only clear your own.
    where: { userId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: nowIso() },
  });
  return count;
}
