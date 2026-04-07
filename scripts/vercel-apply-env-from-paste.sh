#!/usr/bin/env bash
# Push variables from apps/web/.env.vercel.paste to Vercel (production, preview, development).
# Requires: .vercel/project.json at repo root (see README). Run vercel CLI from ROOT, not apps/web.
# Usage (from repo root): bash scripts/vercel-apply-env-from-paste.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${ROOT}/apps/web/.env.vercel.paste"
cd "${ROOT}"

if [[ ! -f "$FILE" ]]; then
  echo "Missing $FILE — run: npm run vercel:generate-env"
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    echo "Skip: $line"
    continue
  fi
  name="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  value="${value#\"}"
  value="${value%\"}"
  [[ -z "$value" ]] && continue
  echo "Adding $name …"
  for env in production preview development; do
    printf '%s' "$value" | vercel env add "$name" "$env" --yes --force
  done
done < "$FILE"

echo "Done. Trigger a new deployment so Vite picks up VITE_* at build time."
