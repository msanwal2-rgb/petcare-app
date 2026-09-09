-- Rate limiting for the credential endpoints.
--
-- Until now the only throttled route in the app was the assistant's chat
-- endpoint, because that one costs money per call. Sign-in, sign-up and
-- password reset cost an attacker nothing and were unlimited, which made
-- password guessing and reset-email flooding free.

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_bucket_key_createdAt_idx" ON "rate_limit_hits"("bucket", "key", "createdAt");
