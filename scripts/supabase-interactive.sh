#!/usr/bin/env bash
# Interactive Supabase setup: prompts for secrets (not stored in shell history when using read -s).
#
# Usage (repo root):
#   bash scripts/supabase-interactive.sh auth-urls
#   bash scripts/supabase-interactive.sh apply-keybags
#
# auth-urls   — PATCH Site URL + redirect allow list (personal access token from Account → Access tokens)
# apply-keybags — Run solana_keybags SQL via psql + database password (direct connection, port 5432).
#   On Git Bash / MSYS / Cygwin, uses Node + pg instead of psql (MSYS DNS often cannot resolve db.*.supabase.co).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/apps/web/.env.development.local"

die() {
  echo "Error: $*" >&2
  exit 1
}

# Load PAT into the shell so child Node sees it (Git Bash does not auto-read .env.supabase.local).
load_supabase_pat_from_dotenv() {
  local f="$ROOT/.env.supabase.local"
  [[ -f "$f" ]] || return 0
  local raw
  raw=$(grep -E '^[[:space:]]*(export[[:space:]]+)?SUPABASE_ACCESS_TOKEN=' "$f" | tail -1 || true)
  [[ -n "$raw" ]] || return 0
  raw="${raw%%$'\r'}"
  raw="${raw#*SUPABASE_ACCESS_TOKEN=}"
  raw="${raw#export }"
  raw="${raw#\"}"
  raw="${raw%\"}"
  raw="${raw#\'}"
  raw="${raw%\'}"
  if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" && -n "$raw" ]]; then
    export SUPABASE_ACCESS_TOKEN="$raw"
  fi
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
  sql_001="$ROOT/supabase/migrations/001_solana_keybags.sql"
  sql_002="$ROOT/supabase/migrations/002_solana_keybags_grants.sql"
  [[ -f "$sql_001" ]] || die "Missing $sql_001"
  [[ -f "$sql_002" ]] || die "Missing $sql_002"

  echo "Database host: db.${ref}.supabase.co port 5432 user postgres"
  read -r -s -p "Postgres password (from Supabase → Settings → Database): " pass
  echo ""
  [[ -n "$pass" ]] || die "Password is required."

  local uname_s
  uname_s="$(uname -s 2>/dev/null || echo unknown)"

  if [[ "$uname_s" == MINGW* || "$uname_s" == MSYS* || "$uname_s" == CYGWIN* ]]; then
    if ! command -v node >/dev/null 2>&1; then
      die "node not found. Install Node.js, or run this script from WSL/macOS/Linux with psql."
    fi
    load_supabase_pat_from_dotenv
    echo "IPv4-only Windows cannot use direct db.*.supabase.co (IPv6). Node resolves the session pooler using your PAT."
    echo "Put SUPABASE_ACCESS_TOKEN in .env.supabase.local (repo root), or paste below when prompted."
    local enc_pass db_url pat_prompt=0
    if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
      read -r -s -p "Personal access token (same as auth script; needed for pooler API on Windows): " maybe_pat
      echo ""
      if [[ -n "$maybe_pat" ]]; then
        export SUPABASE_ACCESS_TOKEN="$maybe_pat"
        pat_prompt=1
      fi
    fi
    enc_pass="$(node -p "encodeURIComponent(process.argv[1])" "$pass")"
    # uselibpqcompat silences pg v8 deprecation warning for sslmode=require
    db_url="postgresql://postgres:${enc_pass}@db.${ref}.supabase.co:5432/postgres?sslmode=require&uselibpqcompat=true"
    export STRONGHOLD_APPLY_KEYBAGS_URL="$db_url"
    # shellcheck disable=SC2064
    trap 'unset PGPASSWORD; unset STRONGHOLD_APPLY_KEYBAGS_URL; [[ ${pat_prompt:-0} -eq 1 ]] && unset SUPABASE_ACCESS_TOKEN' EXIT
    if command -v psql >/dev/null 2>&1; then
      echo "Applying migration with psql (connection still resolved via Node + pooler)."
      node "$ROOT/scripts/apply-solana-keybags.mjs" --migrate-via-psql
    else
      echo "psql not on PATH; applying migration with Node + pg only."
      node "$ROOT/scripts/apply-solana-keybags.mjs"
    fi
    return 0
  fi

  if ! command -v psql >/dev/null 2>&1; then
    die "psql not found. Install PostgreSQL client tools, or run: npm run setup:apply-keybags"
  fi

  export PGPASSWORD="$pass"
  # shellcheck disable=SC2064
  trap 'unset PGPASSWORD' EXIT

  for sql_file in "$sql_001" "$sql_002"; do
    psql -h "db.${ref}.supabase.co" -p 5432 -U postgres -d postgres \
      -v ON_ERROR_STOP=1 \
      -f "$sql_file"
    echo "OK: applied $(basename "$sql_file")"
  done

  echo "OK: all keybags migrations applied."
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
