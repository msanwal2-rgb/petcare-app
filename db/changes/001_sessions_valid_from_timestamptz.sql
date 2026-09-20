-- ─────────────────────────────────────────────────────────────────────────
-- 001 — users."sessionsValidFrom": text → timestamptz
--
-- The one column the bootstrap conversion missed. `002_cents_and_timestamps`
-- found its 59 timestamp columns with a regex over column names ending in
-- At / Since / expires / Start / End; this one ends in "From", so it stayed
-- ISO-8601 text while every other instant in the schema became timestamptz.
--
-- It matters more than its size suggests. This is the session-revocation
-- watermark: M1 refuses any session issued before it, on every authenticated
-- request (REQUIREMENTS.md A14). Comparing an incoming `IssuedUtc` against a
-- text column means either a string comparison that depends on both sides
-- being formatted identically, or a cast on every request. Both are ways to
-- get "the compromised cookie still works" wrong, quietly.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version
             WHERE script = '001_sessions_valid_from_timestamptz')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

-- NULLIF covers rows written as '' by the reference project, which used the
-- empty string where it meant "never revoked".
ALTER TABLE users
  ALTER COLUMN "sessionsValidFrom" TYPE timestamptz
  USING NULLIF("sessionsValidFrom", '')::timestamptz;

INSERT INTO schema_version (script) VALUES ('001_sessions_valid_from_timestamptz');
COMMIT;
