#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────
# load-db.sh — build a fresh review database: schema, reference data, and the
# demo seed (maya.chen, liam.novak, naomi.ruiz … password leashdemo123).
#
#   PATH="/c/Program Files/PostgreSQL/18/bin:$PATH" \
#     ./deploy/load-db.sh "postgresql://leash:<password>@localhost/leash_review"
#
# The target database must be EMPTY and PostgreSQL 17 or newer (petapp.sql
# sets transaction_timeout). Use psql 18 to run it — the dump's \restrict
# lines need it. The demo seed is for review environments only, never a
# database with real customers in it.
# ──────────────────────────────────────────────────────────────────────────
set -euo pipefail

URL="${1:?usage: load-db.sh <postgres connection URL>}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../db" && pwd)"
# The SQL files are UTF-8; psql on Windows otherwise reads them as WIN1252.
export PGCLIENTENCODING=UTF8

run() {
  echo "→ $(basename "$1")"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$1" > /dev/null
}

run "$DIR/petapp.sql"
for f in "$DIR"/reference/*.sql; do run "$f"; done
for f in "$DIR"/devseed/*.sql;   do run "$f"; done

echo "✓ loaded"
