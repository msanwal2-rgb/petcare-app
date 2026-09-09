/**
 * Professional verification.
 *
 * `CaretakerProfile.backgroundCheckStatus` has existed since the first
 * migration and nothing has ever written to it — the badge on a caretaker card
 * meant only that a seed fixture said so. Vets had no equivalent at all, so a
 * self-declared "veterinarian" with an invented licence number was
 * indistinguishable from a real one.
 *
 * Role selection stays self-service: choosing "I'm a veterinarian" is what
 * /onboarding is for. What a claim is *worth* is decided here.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { recordAdminAction } from "../audit";
import { notify } from "../notifications";
import type {
  AdminProfessionalPage,
  AdminProfessionalRow,
  VerificationStatus,
} from "@/types";
import type { AdminProfessionalQuery } from "@/lib/validation/admin-schemas";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function searchProfessionals(
  params: AdminProfessionalQuery = {},
  db: PrismaClient = defaultPrisma
): Promise<AdminProfessionalPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;
  const wantCaretakers = !params.kind || params.kind === "caretaker";
  const wantVets = !params.kind || params.kind === "vet";
  const wantShelters = !params.kind || params.kind === "shelter";

  const nameFilter: Prisma.UserWhereInput | undefined = params.q
    ? {
        OR: [
          { name: { contains: params.q, mode: "insensitive" } },
          { email: { contains: params.q, mode: "insensitive" } },
        ],
      }
    : undefined;

  const caretakerWhere: Prisma.CaretakerProfileWhereInput = {
    ...(params.status ? { backgroundCheckStatus: params.status } : {}),
    ...(nameFilter ? { user: nameFilter } : {}),
  };
  const vetWhere: Prisma.VetProfileWhereInput = {
    ...(params.status ? { verificationStatus: params.status } : {}),
    ...(nameFilter ? { user: nameFilter } : {}),
  };
  const shelterWhere: Prisma.ShelterProfileWhereInput = {
    ...(params.status ? { verificationStatus: params.status } : {}),
    ...(nameFilter ? { user: nameFilter } : {}),
  };

  const [
    caretakers,
    vets,
    pendingCaretakers,
    pendingVets,
    shelters,
    pendingShelters,
  ] = await Promise.all([
    wantCaretakers
      ? db.caretakerProfile.findMany({
          where: caretakerWhere,
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),
    wantVets
      ? db.vetProfile.findMany({
          where: vetWhere,
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),
    db.caretakerProfile.count({ where: { backgroundCheckStatus: { not: "verified" } } }),
    db.vetProfile.count({ where: { verificationStatus: { not: "verified" } } }),
    wantShelters
      ? db.shelterProfile.findMany({
          where: shelterWhere,
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),
    db.shelterProfile.count({ where: { verificationStatus: { not: "verified" } } }),
  ]);

  const rows: AdminProfessionalRow[] = [
    ...caretakers.map((c) => ({
      id: c.id,
      kind: "caretaker" as const,
      userId: c.userId,
      userName: c.user.name,
      userEmail: c.user.email,
      avatarUrl: c.user.avatarUrl,
      status: c.backgroundCheckStatus as VerificationStatus,
      rating: c.rating,
      reviewCount: c.reviewCount,
      detail: `${c.servicesOffered.length} service${c.servicesOffered.length === 1 ? "" : "s"} · ${c.certifications.length} certification${c.certifications.length === 1 ? "" : "s"}`,
    })),
    ...vets.map((v) => ({
      id: v.id,
      kind: "vet" as const,
      userId: v.userId,
      userName: v.user.name,
      userEmail: v.user.email,
      avatarUrl: v.user.avatarUrl,
      status: v.verificationStatus as VerificationStatus,
      rating: v.rating,
      reviewCount: v.reviewCount,
      detail: `${v.clinicName} · licence ${v.licenseNumber || "—"} (${v.licenseState || "—"})`,
    })),
    ...shelters.map((sh) => ({
      id: sh.id,
      kind: "shelter" as const,
      userId: sh.userId,
      userName: sh.user.name,
      userEmail: sh.user.email,
      avatarUrl: sh.user.avatarUrl,
      status: sh.verificationStatus as VerificationStatus,
      // A shelter has no rating, deliberately — see the model. Zeroes here are
      // the honest rendering of "we do not score these yet".
      rating: 0,
      reviewCount: 0,
      detail: `${sh.name} · ${sh.kind.replace(/_/g, " ")} · reg ${sh.registrationNumber || "—"}`,
    })),
  ];

  // Unverified first: this page exists to work through a queue, and sorting by
  // anything else buries the reason to open it.
  const rank: Record<VerificationStatus, number> = { pending: 0, none: 1, verified: 2 };
  rows.sort(
    (a, b) => rank[a.status] - rank[b.status] || a.userName.localeCompare(b.userName)
  );

  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    awaitingReview: pendingCaretakers + pendingVets + pendingShelters,
  };
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; code: "not_found" };

export async function setVerification(
  kind: "caretaker" | "vet" | "shelter",
  id: string,
  status: VerificationStatus,
  actor: { uid: string; ip?: string },
  note: string | undefined,
  db: PrismaClient = defaultPrisma
): Promise<VerificationResult> {
  const include = { user: { select: { id: true, email: true } } } as const;
  const profile =
    kind === "caretaker"
      ? await db.caretakerProfile.findUnique({ where: { id }, include })
      : kind === "vet"
        ? await db.vetProfile.findUnique({ where: { id }, include })
        : await db.shelterProfile.findUnique({ where: { id }, include });
  if (!profile) return { ok: false, code: "not_found" };

  if (kind === "caretaker") {
    await db.caretakerProfile.update({
      where: { id },
      data: { backgroundCheckStatus: status },
    });
  } else if (kind === "vet") {
    await db.vetProfile.update({ where: { id }, data: { verificationStatus: status } });
  } else {
    await db.shelterProfile.update({
      where: { id },
      data: { verificationStatus: status },
    });
  }

  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "professional.background_check",
      targetType:
        kind === "caretaker"
          ? "caretaker_profile"
          : kind === "vet"
            ? "vet_profile"
            : "shelter_profile",
      targetId: id,
      summary: `Marked ${profile.user.email}'s ${kind} profile "${status}"`,
      metadata: { status, note },
      ip: actor.ip,
    },
    db
  );

  // Being verified is worth hearing about; being un-verified is a conversation
  // somebody should be having with them directly, not a bell notification.
  if (status === "verified") {
    await notify(
      profile.user.id,
      {
        kind: "membership_started",
        title: "Your profile has been verified",
        body:
          kind === "vet"
            ? "Your licence has been checked. Clients will see the verified badge on your profile."
            : kind === "shelter"
              ? "Your registration has been checked. Adopters will see the verified badge on your listings."
              : "Your background check has been approved. Owners will see the verified badge on your profile.",
        href:
          kind === "vet"
            ? "/dashboard/vet-profile"
            : kind === "shelter"
              ? "/dashboard/shelter-profile"
              : "/dashboard/caretaker-profile",
      },
      db
    );
  }

  return { ok: true };
}
