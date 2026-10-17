-- ──────────────────────────────────────────────────────────────────────────
-- 004 — the notification outbox (REQUIREMENTS.md N3, N6).
--
-- The reference wrote the in-app notification and then fired the email with
-- `void emailIfPossible(...)` — not awaited, so a process torn down between
-- the two lost the email and nothing ever knew it was owed (§12, Medium).
--
-- Here a notification and one outbox row per out-of-band channel (email
-- today; push once it exists) are written in the SAME transaction as the
-- status change that caused them. A hosted service drains the outbox. A crash
-- at any point leaves either nothing (the move rolled back) or a pending row
-- that the next drain delivers.
--
-- The claim protocol is the webhook one (M7): `lockedAt` is a lease, taken
-- with FOR UPDATE SKIP LOCKED, so two API instances never deliver the same row
-- at once, and a worker that dies mid-delivery has its row reclaimed when the
-- lease runs out.
--
-- `notifications.seq` is a tie-break. Ids are random UUIDs and several
-- notifications can share a millisecond (the fulfilment job catching an order
-- up walks shipped → out for delivery → delivered in one run), so "newest
-- first" needs something that is not the id. Same trap as OrderLifecycle's
-- timeline; ARCHITECTURE.md §9 item 11.
-- ──────────────────────────────────────────────────────────────────────────
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM schema_version WHERE script = '004_notification_outbox')
  THEN RAISE EXCEPTION 'Already applied on this database'; END IF;
END $$;

ALTER TABLE notifications
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

-- The bell's unread count, on every page load of a signed-in user.
CREATE INDEX "notifications_userId_unread_idx"
  ON notifications ("userId") WHERE "readAt" IS NULL;

CREATE TABLE notification_outbox (
  id text NOT NULL,
  "notificationId" text NOT NULL,
  channel text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  "nextAttemptAt" timestamp with time zone NOT NULL,
  "lockedAt" timestamp with time zone,
  "lastError" text,
  "createdAt" timestamp with time zone NOT NULL,
  "sentAt" timestamp with time zone
);

ALTER TABLE ONLY notification_outbox
  ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);

-- One delivery per channel per notification, so a retried enqueue cannot
-- send the same email twice.
ALTER TABLE ONLY notification_outbox
  ADD CONSTRAINT "notification_outbox_notificationId_channel_key"
  UNIQUE ("notificationId", channel);

ALTER TABLE ONLY notification_outbox
  ADD CONSTRAINT "notification_outbox_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES notifications(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

-- What the drain scans: only the rows still owed, soonest first.
CREATE INDEX "notification_outbox_due_idx"
  ON notification_outbox ("nextAttemptAt") WHERE status = 'pending'::text;

INSERT INTO schema_version (script) VALUES ('004_notification_outbox');
COMMIT;
