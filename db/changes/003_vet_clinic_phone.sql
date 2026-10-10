-- ──────────────────────────────────────────────────────────────────────────
-- 003 — a public phone number for the clinic.
--
-- The vet profile's emergency panel tells an owner to phone the clinic rather
-- than book online. The reference printed the vet's *personal* phone for this,
-- because its endpoint returned the whole user record to anyone. This API
-- returns the public projection, so the number needs a home of its own: the
-- practice's line, set by the vet, on the profile — not the person's.
--
-- Deliberately NOT backfilled from users.phone. On a live database that would
-- publish every vet's personal number without asking. The column starts empty
-- and the page simply omits the number until the vet adds one. (The dev seed
-- carries its own clinic numbers.)
--
-- Owner's decision, 2026-10-10.
-- ──────────────────────────────────────────────────────────────────────────
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = '003_vet_clinic_phone')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

ALTER TABLE vet_profiles
  ADD COLUMN "clinicPhone" text DEFAULT ''::text NOT NULL;

INSERT INTO schema_version (script) VALUES ('003_vet_clinic_phone');
COMMIT;
