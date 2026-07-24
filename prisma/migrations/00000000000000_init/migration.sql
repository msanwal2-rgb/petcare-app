-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "avatarUrl" TEXT NOT NULL,
    "roles" TEXT[],
    "addressCity" TEXT NOT NULL,
    "addressState" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "breed" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "dob" TEXT NOT NULL,
    "weightLbs" INTEGER NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "vaccinated" BOOLEAN NOT NULL,
    "allergies" TEXT[],
    "medications" TEXT[],
    "behaviorNotes" TEXT NOT NULL,
    "feedingInstructions" TEXT NOT NULL,
    "vetName" TEXT NOT NULL,
    "vetPhone" TEXT NOT NULL,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caretaker_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "servicesOffered" TEXT[],
    "serviceRadiusMiles" INTEGER NOT NULL,
    "acceptedSpecies" TEXT[],
    "fencedYard" BOOLEAN NOT NULL,
    "hasOtherPets" BOOLEAN NOT NULL,
    "smokeFree" BOOLEAN NOT NULL,
    "certifications" TEXT[],
    "backgroundCheckStatus" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "reviewCount" INTEGER NOT NULL,
    "responseRatePct" INTEGER NOT NULL,

    CONSTRAINT "caretaker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_entries" (
    "id" TEXT NOT NULL,
    "caretakerId" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "pricing_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_days" (
    "id" TEXT NOT NULL,
    "caretakerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slots" JSONB NOT NULL,

    CONSTRAINT "availability_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "caretakerId" TEXT NOT NULL,
    "petIds" TEXT[],
    "serviceType" TEXT NOT NULL,
    "startDateTime" TEXT NOT NULL,
    "endDateTime" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "priceTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "pets_ownerId_idx" ON "pets"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "caretaker_profiles_userId_key" ON "caretaker_profiles"("userId");

-- CreateIndex
CREATE INDEX "pricing_entries_caretakerId_idx" ON "pricing_entries"("caretakerId");

-- CreateIndex
CREATE INDEX "availability_days_caretakerId_idx" ON "availability_days"("caretakerId");

-- CreateIndex
CREATE INDEX "bookings_ownerId_idx" ON "bookings"("ownerId");

-- CreateIndex
CREATE INDEX "bookings_caretakerId_idx" ON "bookings"("caretakerId");

-- CreateIndex
CREATE INDEX "reviews_toUserId_idx" ON "reviews"("toUserId");

-- CreateIndex
CREATE INDEX "reviews_bookingId_idx" ON "reviews"("bookingId");

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caretaker_profiles" ADD CONSTRAINT "caretaker_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_entries" ADD CONSTRAINT "pricing_entries_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "caretaker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_days" ADD CONSTRAINT "availability_days_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "caretaker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

