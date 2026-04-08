#!/usr/bin/env bash
# Interactive Supabase setup: prompts for secrets (not stored in shell history when using read -s).
#
# Usage (repo root):
#   bash scripts/supabase-interactive.sh auth-urls
#   bash scripts/supabase-interactive.sh apply-keybags
#
# auth-urls   — PATCH Site URL + redirect allow list (personal access token from Account → Access tokens)
# apply-keybags — Run solana_keybags SQL via psql + database password (direct connection, port 5432)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/apps/web/.env.development.local"

die() {
  echo "Error: $*" >&2
  exit 1
}

extract_project_ref() {
  local url=""
  if [[ -f "$ENV_FILE" ]]; then
    url=$(grep -E '^VITE_PUBLIC_SUPABASE_URL=|^VITE_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'")
  fi
  if [[ -z "$url" ]]; then
    read -r -p "Supabase project URL (e.g. https://abcd.supabase.co): " url
  fi
  [[ -n "$url" ]] || die "Could not determine project URL."
  if [[ "$url" =~ https?://([a-zA-Z0-9]+)\.supabase\.co ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    die "URL must look like https://YOUR_REF.supabase.co"
  fi
}

json_body_auth() {
  local site="$1"
  local allow="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg s "$site" --arg u "$allow" '{site_url:$s, uri_allow_list:$u}'
  else
    node -e "console.log(JSON.stringify({site_url:process.argv[1],uri_allow_list:process.argv[2]}))" "$site" "$allow"
  fi
}

cmd_auth_urls() {
  local ref token site extra allow_list resp http_code
  ref="$(extract_project_ref)"

  echo "Use a personal access token from: https://supabase.com/dashboard/account/tokens"
  echo "(Not the anon or service_role key — those start with eyJ and will not work.)"
  read -r -s -p "Supabase personal access token: " token
  echo ""
  [[ -n "$token" ]] || die "Token is required."

  read -r -p "Site URL [http://localhost:5173]: " site
  site="${site:-http://localhost:5173}"
  site="${site%/}"

  read -r -p "Extra redirect URLs (comma-separated, optional): " extra
  if [[ -n "$extra" ]]; then
    allow_list="${site},${extra}"
  else
    allow_list="$site"
  fi

  local body
  body="$(json_body_auth "$site" "$allow_list")"

  echo "PATCH https://api.supabase.com/v1/projects/${ref}/config/auth"
  tmp="$(mktemp)"
  http_code="$(curl -sS -o "$tmp" -w "%{http_code}" -X PATCH \
    "https://api.supabase.com/v1/projects/${ref}/config/auth" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$body")"
  resp_body="$(cat "$tmp")"
  rm -f "$tmp"

  if [[ "$http_code" != "200" && "$http_code" != "201" && "$http_code" != "204" ]]; then
    echo "Request failed (HTTP $http_code):" >&2
    echo "$resp_body" >&2
    die "Fix token or set URLs manually in Supabase → Authentication → URL configuration."
  fi

  echo "OK: Auth URLs updated."
  echo "  site_url: $site"
  echo "  uri_allow_list: $allow_list"
  if [[ -n "$resp_body" ]]; then
    echo "$resp_body"
  fi
}

cmd_apply_keybags() {
  local ref pass sql_file
  ref="$(extract_project_ref)"
  sql_file="$ROOT/supabase/migrations/001_solana_keybags.sql"
  [[ -f "$sql_file" ]] || die "Missing $sql_file"

  echo "Database host: db.${ref}.supabase.co port 5432 user postgres"
  read -r -s -p "Postgres password (from Supabase → Settings → Database): " pass
  echo ""
  [[ -n "$pass" ]] || die "Password is required."

  if ! command -v psql >/dev/null 2>&1; then
    die "psql not found. Install PostgreSQL client tools, or run: npm run setup:apply-keybags"
  fi

  export PGPASSWORD="$pass"
  # shellcheck disable=SC2064
  trap 'unset PGPASSWORD' EXIT

  psql -h "db.${ref}.supabase.co" -p 5432 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 \
    -f "$sql_file"

  echo "OK: solana_keybags migration applied."
}

case "${1:-}" in
  auth-urls)
    cmd_auth_urls
    ;;
  apply-keybags)
    cmd_apply_keybags
    ;;
  *)
    echo "Usage: $0 auth-urls | apply-keybags" >&2
    echo "" >&2
    echo "  auth-urls     — prompt for personal access token; set Site URL + redirect allow list" >&2
    echo "  apply-keybags — prompt for Postgres password; run migration via psql" >&2
    exit 1
    ;;
esac
