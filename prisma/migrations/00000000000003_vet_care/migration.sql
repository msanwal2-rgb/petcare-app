-- Vet care: vets as the third side of the marketplace (VetProfile,
-- VetAvailabilityDay, VetAppointment, MedicalRecord) plus Review.kind so
-- the existing review table can also carry vet-appointment reviews.
-- Additive only: no drops, no renames on existing tables.

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'booking';

-- CreateTable
CREATE TABLE "vet_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "specialties" TEXT[],
    "licenseNumber" TEXT NOT NULL,
    "licenseState" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL,
    "acceptedSpecies" TEXT[],
    "consultModes" TEXT[],
    "consultFee" DOUBLE PRECISION NOT NULL,
    "emergencyAvailable" BOOLEAN NOT NULL DEFAULT false,
    "clinicCity" TEXT NOT NULL,
    "clinicState" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "responseRatePct" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "vet_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_availability_days" (
    "id" TEXT NOT NULL,
    "vetId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slots" JSONB NOT NULL,

    CONSTRAINT "vet_availability_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_appointments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vetId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "symptoms" TEXT[],
    "startDateTime" TEXT NOT NULL,
    "endDateTime" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "fee" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "vet_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "vetId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "occurredAt" TEXT NOT NULL,
    "nextDueAt" TEXT,
    "medicationName" TEXT,
    "dosage" TEXT,
    "refillsLeft" INTEGER,
    "expiresAt" TEXT,
    "productSlugs" TEXT[],
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "vet_profiles_userId_key" ON "vet_profiles"("userId");

-- CreateIndex
CREATE INDEX "vet_availability_days_vetId_idx" ON "vet_availability_days"("vetId");

-- CreateIndex
CREATE INDEX "vet_appointments_ownerId_idx" ON "vet_appointments"("ownerId");

-- CreateIndex
CREATE INDEX "vet_appointments_vetId_idx" ON "vet_appointments"("vetId");

-- CreateIndex
CREATE INDEX "vet_appointments_petId_idx" ON "vet_appointments"("petId");

-- CreateIndex
CREATE INDEX "medical_records_petId_idx" ON "medical_records"("petId");

-- CreateIndex
CREATE INDEX "medical_records_appointmentId_idx" ON "medical_records"("appointmentId");

-- AddForeignKey
ALTER TABLE "vet_profiles" ADD CONSTRAINT "vet_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_availability_days" ADD CONSTRAINT "vet_availability_days_vetId_fkey" FOREIGN KEY ("vetId") REFERENCES "vet_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_appointments" ADD CONSTRAINT "vet_appointments_vetId_fkey" FOREIGN KEY ("vetId") REFERENCES "vet_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vet_appointments" ADD CONSTRAINT "vet_appointments_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "vet_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

