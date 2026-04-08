#!/usr/bin/env bash
# Apply solana_keybags migration using psql (Postgres client).
# Cross-platform alternative (Node): npm run setup:apply-keybags
#
# Usage (get password from Supabase → Project Settings → Database):
#   export SUPABASE_DB_URL='postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres?sslmode=require'
#   bash scripts/apply-solana-keybags.sh
#
# Or pass URL as first argument:
#   bash scripts/apply-solana-keybags.sh 'postgresql://postgres:...'
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
URL="${1:-${SUPABASE_DB_URL:-}}"

if [[ -z "$URL" ]]; then
  echo "Missing database URL. Set SUPABASE_DB_URL or pass it as the first argument."
  echo "Example: postgresql://postgres:PASSWORD@db.xxxxx.supabase.co:5432/postgres?sslmode=require"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install Postgres client tools, or run the SQL in Supabase → SQL Editor."
  exit 1
fi

for f in "$MIGRATIONS_DIR/001_solana_keybags.sql" "$MIGRATIONS_DIR/002_solana_keybags_grants.sql"; do
  [[ -f "$f" ]] || { echo "Missing migration: $f" >&2; exit 1; }
  psql "$URL" -v ON_ERROR_STOP=1 -f "$f"
  echo "OK: applied $(basename "$f")"
done
echo "OK: all keybags migrations applied."
