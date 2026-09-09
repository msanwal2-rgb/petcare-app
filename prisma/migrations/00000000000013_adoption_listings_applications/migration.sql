-- Adoption listings and applications.
--
-- The animal is an ordinary `pets` row the shelter owns; a listing carries only
-- what is true because it is up for adoption. Completing an application moves
-- `pets.ownerId` and `pets.ownedSince` in one write, which transfers the health
-- record and severs the shelter's caretakers and vets at the same instant.
--
-- Note the absence of foreign keys on adoption_applications.listingId /
-- shelterId / petId. That is the Review.bookingId precedent: an adopter's
-- record of an adoption must outlive the shelter closing its account, and a
-- cascade would erase exactly the row that matters most to the person least
-- able to get it back.
--
-- NOTE: `prisma migrate diff` wants to drop "knowledge_chunks_embedding_idx".
-- That is a hand-written pgvector index Prisma cannot represent. Omitted
-- deliberately, as in every migration since 09.



-- CreateTable
CREATE TABLE "adoption_listings" (
    "id" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "headline" TEXT NOT NULL DEFAULT '',
    "story" TEXT NOT NULL DEFAULT '',
    "goodWithKids" TEXT NOT NULL DEFAULT 'unknown',
    "goodWithDogs" TEXT NOT NULL DEFAULT 'unknown',
    "goodWithCats" TEXT NOT NULL DEFAULT 'unknown',
    "houseTrained" TEXT NOT NULL DEFAULT 'unknown',
    "energyLevel" TEXT NOT NULL DEFAULT 'moderate',
    "specialNeeds" BOOLEAN NOT NULL DEFAULT false,
    "specialNeedsNotes" TEXT NOT NULL DEFAULT '',
    "spayedNeutered" BOOLEAN NOT NULL DEFAULT false,
    "microchipped" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "intakeAt" TEXT NOT NULL,
    "publishedAt" TEXT,
    "closedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "adoption_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adoption_applications" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "shelterId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "petName" TEXT NOT NULL,
    "petPhotoUrl" TEXT NOT NULL DEFAULT '',
    "applicantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "householdAdults" INTEGER NOT NULL DEFAULT 1,
    "householdChildren" INTEGER NOT NULL DEFAULT 0,
    "hasOtherPets" BOOLEAN NOT NULL DEFAULT false,
    "otherPetsNotes" TEXT NOT NULL DEFAULT '',
    "homeType" TEXT NOT NULL DEFAULT 'house',
    "fencedYard" BOOLEAN NOT NULL DEFAULT false,
    "ownsHome" BOOLEAN NOT NULL DEFAULT false,
    "hoursAlonePerDay" INTEGER NOT NULL DEFAULT 0,
    "experience" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL DEFAULT '',
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "decidedAt" TEXT,
    "completedAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "adoption_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adoption_listings_petId_key" ON "adoption_listings"("petId");

-- CreateIndex
CREATE INDEX "adoption_listings_status_idx" ON "adoption_listings"("status");

-- CreateIndex
CREATE INDEX "adoption_listings_shelterId_idx" ON "adoption_listings"("shelterId");

-- CreateIndex
CREATE INDEX "adoption_applications_listingId_idx" ON "adoption_applications"("listingId");

-- CreateIndex
CREATE INDEX "adoption_applications_applicantId_idx" ON "adoption_applications"("applicantId");

-- CreateIndex
CREATE INDEX "adoption_applications_shelterId_status_idx" ON "adoption_applications"("shelterId", "status");

-- AddForeignKey
ALTER TABLE "adoption_listings" ADD CONSTRAINT "adoption_listings_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoption_applications" ADD CONSTRAINT "adoption_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

