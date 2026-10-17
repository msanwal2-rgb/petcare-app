-- ──────────────────────────────────────────────────────────────────────────
-- 005 — a tie-break for the admin audit log (M9).
--
-- The console lists the log newest first, and several entries can share a
-- millisecond: a settings save that changes two keys, a script, two staff
-- members at once. Ids are random UUIDs, so "newest first" needs something
-- that is not the id — the same trap as notifications.seq (004) and the order
-- timeline (ARCHITECTURE.md §9 item 11). The list is keyset-paged on
-- ("createdAt", seq).
-- ──────────────────────────────────────────────────────────────────────────
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = '005_audit_log_seq')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

ALTER TABLE admin_audit_log
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX "admin_audit_log_createdAt_seq_idx"
  ON admin_audit_log ("createdAt" DESC, seq DESC);

INSERT INTO schema_version (script) VALUES ('005_audit_log_seq');
COMMIT;
