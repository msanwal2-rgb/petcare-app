-- ─────────────────────────────────────────────────────────────────────────
-- 002 — refresh_tokens, for the mobile half of dual auth
--
-- The web app authenticates with a cookie and needs no table: the ticket is
-- the cookie, and revocation is the `sessionsValidFrom` watermark. A native
-- client cannot hold a cookie usefully, so M1 also issues a short-lived JWT
-- access token plus a long-lived refresh token (REQUIREMENTS.md A18).
--
-- Refresh tokens are ROTATED — each refresh consumes one and issues the next —
-- and rotation only detects a stolen token if the server remembers which ones
-- it has already spent. That is the whole reason this table exists:
--
--   • only the SHA-256 hash is stored, as with verification_tokens: a dump of
--     this table is not a set of working logins;
--   • `revokedAt` + `replacedById` keep the chain, so presenting an already-
--     rotated token is recognisable as replay rather than merely invalid, and
--     the rest of that chain can be revoked with it;
--   • one row per device, so signing out of a phone does not sign out a
--     tablet. This is why refresh tokens are not folded into
--     verification_tokens, whose `createToken` deletes any prior token of the
--     same type for the same identifier — correct for "one live reset link
--     per account", wrong for "one live session per device".
--
-- `sessionsValidFrom` still governs: a refresh token issued before the
-- watermark is refused whatever this table says, so a password reset ends
-- mobile sessions too without needing to find their rows.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = '002_refresh_tokens')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

CREATE TABLE refresh_tokens (
    id text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "issuedAt" timestamptz NOT NULL,
    "expiresAt" timestamptz NOT NULL,
    "revokedAt" timestamptz,
    -- The row that superseded this one. Set on rotation; NULL means this token
    -- is the live end of its chain.
    "replacedById" text,
    -- Recorded to make an audit answerable ("which device was that?"), never
    -- checked as a credential — it is client-supplied text.
    "userAgent" text DEFAULT ''::text NOT NULL
);

ALTER TABLE ONLY refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);

-- Unique because the hash is the lookup key, and two rows for one token would
-- make "has this been spent?" unanswerable.
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON refresh_tokens USING btree ("tokenHash");

-- Listing and purging a user's sessions.
CREATE INDEX "refresh_tokens_userId_expiresAt_idx" ON refresh_tokens USING btree ("userId", "expiresAt");

ALTER TABLE ONLY refresh_tokens
    ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;

INSERT INTO schema_version (script) VALUES ('002_refresh_tokens');
COMMIT;
