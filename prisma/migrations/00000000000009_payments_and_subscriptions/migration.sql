-- Real payments and the Leash Plus membership.
--
-- Adds the ledger the order model never had: Order carried `paymentStatus` and
-- `paymentRef` as two loose columns, so there was nowhere to record that money
-- moved but the order didn't — which is exactly the state a crash between
-- capture and commit produced.
--
-- NOTE: `prisma migrate diff` wants to drop "knowledge_chunks_embedding_idx"
-- here, as it will in every future migration. That is a hand-written pgvector
-- HNSW index Prisma cannot represent in schema.prisma. The drop is omitted
-- deliberately. Never accept it.


-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "benefitsApplied" TEXT[],
ADD COLUMN     "reservationExpiresAt" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stripeCustomerId" TEXT;

-- AlterTable
ALTER TABLE "vet_appointments" ADD COLUMN     "baseFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "discountPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'order',
    "orderId" TEXT,
    "subscriptionId" TEXT,
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
CREATE INDEX "orders_status_reservationExpiresAt_idx" ON "orders"("status", "reservationExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One live subscription per user.
--
-- Prisma cannot express a partial unique index, so it is written by hand. The
-- test harness builds its schema with `prisma db push`, which reads only
-- schema.prisma and therefore cannot see this — tests/helpers/global-setup.ts
-- re-applies it after the push so the constraint exists there too.
CREATE UNIQUE INDEX "subscriptions_one_live_per_user"
  ON "subscriptions"("userId")
  WHERE "status" IN ('trialing', 'active', 'past_due', 'unpaid');

-- The one plan. Priced and described here so the marketing page can render
-- without a Stripe round trip; `stripePriceId` is filled in once the product
-- exists in Stripe, and until then the checkout endpoint refuses rather than
-- guessing.
INSERT INTO "plans" (
  "id", "key", "name", "description", "priceCents", "currency", "interval",
  "stripeProductId", "stripePriceId", "entitlements", "consultDiscountPct",
  "active", "createdAt"
) VALUES (
  'plan_leash_plus',
  'leash_plus',
  'Leash Plus',
  'Free delivery on everything, 20% off every vet consultation, and same-day booking.',
  999,
  'usd',
  'month',
  '',
  '',
  ARRAY['free_shipping', 'vet_consult_discount', 'priority_booking'],
  20,
  true,
  '2026-09-09T00:00:00.000Z'
) ON CONFLICT ("id") DO NOTHING;
