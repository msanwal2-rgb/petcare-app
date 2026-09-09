-- Adoption fees reach the same ledger as everything else.
--
-- `payments.kind` gains "adoption_fee"; the column is already TEXT, so only the
-- doc-comment and the createPaymentRow parameter type change. Note what did NOT
-- need changing: `applyIntentState` keys on `providerRef`, so the reconciler
-- that settles an order settles an adoption fee with no new code at all. That
-- is the payoff of the ledger design, and worth saying out loud.
--
-- NOTE: the "knowledge_chunks_embedding_idx" drop is omitted deliberately.



-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "adoptionApplicationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_adoptionApplicationId_key" ON "payments"("adoptionApplicationId");

