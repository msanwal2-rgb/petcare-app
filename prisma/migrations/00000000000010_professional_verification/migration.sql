-- Professional verification.
--
-- `caretaker_profiles.backgroundCheckStatus` has existed since the first
-- migration and nothing has ever written to it: the badge on a caretaker card
-- meant only that a seed fixture said so. Vets had no equivalent at all, so a
-- self-declared "veterinarian" with an invented licence number looked exactly
-- like a real one.
--
-- The column below, and the console at /dashboard/admin/professionals, make
-- both of them something a person decides and the audit log records.

-- AlterTable
ALTER TABLE "vet_profiles" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'none';

-- Seeded vets are the demo's licensed professionals; treat them as checked so
-- the directory doesn't read as entirely unverified on a fresh deploy.
UPDATE "vet_profiles" SET "verificationStatus" = 'verified';
