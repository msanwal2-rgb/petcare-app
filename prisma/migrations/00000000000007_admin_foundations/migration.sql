-- Admin foundations: staff privileges, account lifecycle, audit trail, settings.
--
-- Additive. `isOps` is deliberately KEPT here and dropped in a later migration,
-- so the release that starts reading `staffRoles` can roll back to one that
-- still reads `isOps`.
--
-- NOTE for whoever generates the next migration: `prisma migrate diff` wants to
-- drop "knowledge_chunks_embedding_idx" (and the tsvector expression index
-- beside it), because they are hand-written pgvector/expression indexes that
-- Prisma cannot represent in schema.prisma. Never accept those drops.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffRoles" TEXT[],
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "suspendedAt" TEXT,
ADD COLUMN     "suspendedReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deletedAt" TEXT,
ADD COLUMN     "lastLoginAt" TEXT,
ADD COLUMN     "sessionsValidFrom" TEXT;

-- Backfill: the one seeded operations account keeps its fulfilment access and
-- gains full admin, so the console has an owner from the first deploy.
UPDATE "users" SET "staffRoles" = ARRAY['ops', 'admin'] WHERE "isOps" = true;

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_actorUserId_createdAt_idx" ON "admin_audit_log"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_log_targetType_targetId_idx" ON "admin_audit_log"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_createdAt_idx" ON "admin_audit_log"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
