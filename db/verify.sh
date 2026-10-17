#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# verify.sh — prove petapp.sql and db/changes/ describe the same schema.
#
# Run before ANY deployment, and after writing any change script.
#
# The risk this catches is not "I forgot to update petapp.sql" — you would
# notice that. It is the two paths producing DIFFERENT results while both look
# correct. The classic case: a change script that adds a column, backfills it,
# then sets NOT NULL, versus a master that declares NOT NULL DEFAULT 'x'.
# Both defensible. Fresh and migrated databases now hold different data.
#
# Builds two throwaway databases, one each way, and diffs the schema dumps.
#
#   ./db/verify.sh
#
# Requires psql and pg_dump on PATH (C:\Program Files\PostgreSQL\18\bin).
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

HOST="${PGHOST:-localhost}"
USER="${PGUSER:-leash}"
export PGPASSWORD="${PGPASSWORD:-devonly}"

A="verify_master_$$"
B="verify_delta_$$"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  psql -U "$USER" -h "$HOST" -d postgres -q -c "DROP DATABASE IF EXISTS $A;" >/dev/null 2>&1 || true
  psql -U "$USER" -h "$HOST" -d postgres -q -c "DROP DATABASE IF EXISTS $B;" >/dev/null 2>&1 || true
  rm -f /tmp/$A.sql /tmp/$B.sql
}
trap cleanup EXIT

echo "→ building $A from petapp.sql"
createdb -U "$USER" -h "$HOST" "$A"
psql -U "$USER" -h "$HOST" -d "$A" -v ON_ERROR_STOP=1 -q -f "$DIR/petapp.sql" > /dev/null

echo "→ building $B from the last release + db/changes/"
createdb -U "$USER" -h "$HOST" "$B"
if [ -f "$DIR/petapp_at_last_release.sql" ]; then
  psql -U "$USER" -h "$HOST" -d "$B" -v ON_ERROR_STOP=1 -q -f "$DIR/petapp_at_last_release.sql" > /dev/null
else
  # No release baseline yet — both sides start from the same master, so this
  # run only proves the change scripts apply cleanly on top of it.
  echo "  (no petapp_at_last_release.sql; starting from petapp.sql)"
  psql -U "$USER" -h "$HOST" -d "$B" -v ON_ERROR_STOP=1 -q -f "$DIR/petapp.sql" > /dev/null
fi

shopt -s nullglob
for f in "$DIR"/changes/*.sql; do
  echo "  applying $(basename "$f")"
  psql -U "$USER" -h "$HOST" -d "$B" -v ON_ERROR_STOP=1 -q -f "$f" > /dev/null
done

echo "→ diffing"
# PostgreSQL 18's pg_dump emits a random \restrict / \unrestrict nonce per dump
# (an anti-injection guard for psql meta-commands). It differs on every run and
# is not schema content, so it must be filtered or the diff never passes.
pg_dump -U "$USER" -h "$HOST" --schema-only --no-owner --no-privileges "$A" \
  | grep -v 'restrict ' > "/tmp/$A.sql"
pg_dump -U "$USER" -h "$HOST" --schema-only --no-owner --no-privileges "$B" \
  | grep -v 'restrict ' > "/tmp/$B.sql"

if diff -q "/tmp/$A.sql" "/tmp/$B.sql" >/dev/null; then
  echo
  echo "✓ IDENTICAL — petapp.sql and db/changes/ agree."
  exit 0
else
  echo
  echo "✗ DRIFT — petapp.sql and db/changes/ describe different schemas:"
  echo
  diff "/tmp/$A.sql" "/tmp/$B.sql" || true
  echo
  echo "Fix petapp.sql to match the change scripts, then re-run."
  exit 1
fi
