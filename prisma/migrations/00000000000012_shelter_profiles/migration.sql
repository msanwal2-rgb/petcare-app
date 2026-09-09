-- Adoption shelters: a fourth kind of participant.
--
-- Mirrors vet_profiles, deliberately: same shape of thing, so the search, the
-- upsert, the verification console and the derived response rate are all the
-- code that already exists with a third arm rather than a parallel
-- implementation.
--
-- No availability table — a shelter is not booked by the hour. No rating or
-- reviewCount either, until Review.kind has an "adoption" arm; shipping a badge
-- nothing can write is the mistake backgroundCheckStatus already made once.
--
-- NOTE: `prisma migrate diff` wants to drop "knowledge_chunks_embedding_idx"
-- here, as it does in every migration. That is a hand-written pgvector HNSW
-- index Prisma cannot represent. The drop is omitted deliberately.


-- CreateTable
CREATE TABLE "shelter_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'rescue',
    "registrationNumber" TEXT NOT NULL DEFAULT '',
    "registrationState" TEXT NOT NULL DEFAULT '',
    "verificationStatus" TEXT NOT NULL DEFAULT 'none',
    "acceptedSpecies" TEXT[],
    "websiteUrl" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "addressLine" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "adoptionPolicy" TEXT NOT NULL DEFAULT '',
    "responseRatePct" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "shelter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shelter_profiles_userId_key" ON "shelter_profiles"("userId");

-- CreateIndex
CREATE INDEX "shelter_profiles_city_state_idx" ON "shelter_profiles"("city", "state");

-- AddForeignKey
ALTER TABLE "shelter_profiles" ADD CONSTRAINT "shelter_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

