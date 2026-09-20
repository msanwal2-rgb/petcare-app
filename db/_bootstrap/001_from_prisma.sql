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
    "passwordHash" TEXT,
    "isOps" BOOLEAN NOT NULL DEFAULT false,
    "staffRoles" TEXT[],
    "googleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspendedAt" TEXT,
    "suspendedReason" TEXT NOT NULL DEFAULT '',
    "deletedAt" TEXT,
    "lastLoginAt" TEXT,
    "sessionsValidFrom" TEXT,
    "stripeCustomerId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownedSince" TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
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
    "kind" TEXT NOT NULL DEFAULT 'booking',
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "readAt" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vet_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "specialties" TEXT[],
    "licenseNumber" TEXT NOT NULL,
    "licenseState" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'none',
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
    "baseFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountPct" INTEGER NOT NULL DEFAULT 0,
    "priority" BOOLEAN NOT NULL DEFAULT false,
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

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "species" TEXT[],
    "lifeStage" TEXT[],
    "sizeLabel" TEXT NOT NULL,
    "weightLbs" DOUBLE PRECISION NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "compareAtPriceCents" INTEGER,
    "imageUrl" TEXT NOT NULL,
    "ingredients" TEXT[],
    "allergens" TEXT[],
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paymentRef" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "shipName" TEXT NOT NULL,
    "shipLine1" TEXT NOT NULL,
    "shipLine2" TEXT NOT NULL DEFAULT '',
    "shipCity" TEXT NOT NULL,
    "shipState" TEXT NOT NULL,
    "shipPostalCode" TEXT NOT NULL,
    "shipCountry" TEXT NOT NULL DEFAULT 'US',
    "shipPhone" TEXT NOT NULL DEFAULT '',
    "deliveryInstructions" TEXT NOT NULL DEFAULT '',
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "placedAt" TEXT NOT NULL,
    "estimatedDeliveryAt" TEXT,
    "deliveredAt" TEXT,
    "reservationExpiresAt" TEXT,
    "benefitsApplied" TEXT[],

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT,
    "occurredAt" TEXT NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL,
    "readAt" TEXT,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'order',
    "orderId" TEXT,
    "subscriptionId" TEXT,
    "adoptionApplicationId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerRef" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "amountCents" INTEGER NOT NULL,
    "amountRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "methodBrand" TEXT NOT NULL DEFAULT '',
    "methodLast4" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "lastEventAt" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    "succeededAt" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerRef" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL DEFAULT '',
    "initiatedBy" TEXT NOT NULL DEFAULT 'system',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "settledAt" TEXT,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "stripeProductId" TEXT NOT NULL DEFAULT '',
    "stripePriceId" TEXT NOT NULL DEFAULT '',
    "entitlements" TEXT[],
    "consultDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerRef" TEXT NOT NULL,
    "providerCustomerId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "currentPeriodStart" TEXT NOT NULL,
    "currentPeriodEnd" TEXT NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TEXT,
    "endedAt" TEXT,
    "graceEndsAt" TEXT,
    "latestInvoiceRef" TEXT NOT NULL DEFAULT '',
    "lastEventAt" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "type" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT '',
    "eventAt" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "receivedAt" TEXT NOT NULL,
    "processedAt" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

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

-- CreateIndex
CREATE INDEX "messages_bookingId_idx" ON "messages"("bookingId");

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

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_active_idx" ON "products"("active");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_status_reservationExpiresAt_idx" ON "orders"("status", "reservationExpiresAt");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_events_orderId_idx" ON "order_events"("orderId");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_identifier_idx" ON "verification_tokens"("identifier");

-- CreateIndex
CREATE INDEX "admin_audit_log_actorUserId_createdAt_idx" ON "admin_audit_log"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_log_targetType_targetId_idx" ON "admin_audit_log"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_createdAt_idx" ON "admin_audit_log"("action", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_bucket_key_createdAt_idx" ON "rate_limit_hits"("bucket", "key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_adoptionApplicationId_key" ON "payments"("adoptionApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerRef_key" ON "payments"("providerRef");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_providerRef_key" ON "refunds"("providerRef");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_providerRef_key" ON "subscriptions"("providerRef");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "webhook_events_type_eventAt_idx" ON "webhook_events"("type", "eventAt");

-- CreateIndex
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "shelter_profiles_userId_key" ON "shelter_profiles"("userId");

-- CreateIndex
CREATE INDEX "shelter_profiles_city_state_idx" ON "shelter_profiles"("city", "state");

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
ALTER TABLE "pets" ADD CONSTRAINT "pets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caretaker_profiles" ADD CONSTRAINT "caretaker_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_entries" ADD CONSTRAINT "pricing_entries_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "caretaker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_days" ADD CONSTRAINT "availability_days_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "caretaker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_profiles" ADD CONSTRAINT "shelter_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoption_listings" ADD CONSTRAINT "adoption_listings_petId_fkey" FOREIGN KEY ("petId") REFERENCES "pets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adoption_applications" ADD CONSTRAINT "adoption_applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
