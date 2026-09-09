/**
 * The admin audit trail.
 *
 * `recordAdminAction()` is the only way a row gets written, exactly as
 * `notify()` is the only way a notification does. That single seam is the whole
 * design: an audit log that some code paths remember to write and others don't
 * is worse than none, because it reads as complete.
 *
 * Writing is best-effort in the same sense email is — a logging failure must
 * not roll back the action it describes. The difference from email is that a
 * missing audit row is worth shouting about, so it is logged loudly rather than
 * swallowed.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "./ids";
import type { AdminAuditEntry } from "@/types";

/** Every action the console can take. A closed union so the filter UI can't drift. */
export type AuditAction =
  | "user.verify"
  | "user.unverify"
  | "user.suspend"
  | "user.reactivate"
  | "user.delete"
  | "user.sign_out"
  | "user.roles_change"
  | "user.staff_roles_change"
  | "professional.background_check"
  | "order.status_change"
  | "payment.refund"
  | "subscription.cancel"
  | "subscription.grace_extend"
  | "setting.update"
  | "webhook.replay"
  | "adoption.reverse";

export type AuditTargetType =
  | "user"
  | "order"
  | "payment"
  | "subscription"
  | "caretaker_profile"
  | "vet_profile"
  | "shelter_profile"
  | "setting"
  | "webhook_event"
  | "adoption_application";

export interface RecordAdminActionInput {
  actorUserId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  /** One human-readable line. Written at the call site, which is the only place that knows why. */
  summary: string;
  /** Anything a reader might need to understand the row. Never secrets. */
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function recordAdminAction(
  input: RecordAdminActionInput,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  try {
    await db.adminAuditLog.create({
      data: {
        id: genId("aud"),
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? "",
        summary: input.summary,
        metadata: (input.metadata ?? undefined) as never,
        ip: input.ip ?? "",
        createdAt: nowIso(),
      },
    });
  } catch (e) {
    console.error("[audit] failed to record admin action", input.action, e);
  }
}

/**
 * The client's IP, for the audit row. Vercel sets `x-forwarded-for`; the
 * leftmost entry is the original client. Header-derived and therefore
 * spoofable, which is why it is recorded as context and never used to decide
 * anything.
 */
export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "";
}

export interface AuditQuery {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listAuditEntries(
  query: AuditQuery = {},
  db: PrismaClient = defaultPrisma,
): Promise<{ items: AdminAuditEntry[]; total: number; limit: number; offset: number }> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = query.offset ?? 0;

  const where = {
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
  };

  const [rows, total] = await Promise.all([
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { actor: { select: { name: true, email: true } } },
    }),
    db.adminAuditLog.count({ where }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      actorName: r.actor.name,
      actorEmail: r.actor.email,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      summary: r.summary,
      metadata: (r.metadata ?? null) as Record<string, unknown> | null,
      ip: r.ip,
      createdAt: r.createdAt,
    })),
    total,
    limit,
    offset,
  };
}
