#!/usr/bin/env bash
# Deploy creator_treasury.so to devnet using Docker Solana CLI.
# Prerequisites:
#   - Docker
#   - target/deploy/creator_treasury.so (e.g. npm run build:program:docker)
#   - Payer keypair: ~/.config/solana/id.json inside SOLANA_CONFIG_DIR, OR set FEE_PAYER_KEYPAIR
#     to a repo-relative path (e.g. keys/devnet-payer.json) for a funded wallet JSON export.
#   - Payer funded on devnet

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MSYS_NO_PATHCONV=1

SOLANA_IMAGE="${SOLANA_IMAGE:-solanalabs/solana:v1.18.26}"
export SOLANA_IMAGE
RPC_URL="${DEVNET_RPC_URL:-https://api.devnet.solana.com}"
SO_PATH="${SO_PATH:-target/deploy/creator_treasury.so}"
KEYPAIR="${PROGRAM_KEYPAIR:-target/deploy/creator_treasury-keypair.json}"

# If present, default to repo keys/devnet-payer.json (gitignored) unless FEE_PAYER_KEYPAIR is set.
if [[ -z "${FEE_PAYER_KEYPAIR:-}" ]] && [[ -f "${ROOT}/keys/devnet-payer.json" ]]; then
  FEE_PAYER_KEYPAIR=keys/devnet-payer.json
fi

if [[ ! -f "${ROOT}/${SO_PATH}" ]]; then
  echo "Missing ${SO_PATH}. Run: npm run build:program:docker"
  exit 1
fi
if [[ ! -f "${ROOT}/${KEYPAIR}" ]]; then
  echo "Missing ${KEYPAIR}."
  exit 1
fi

KEY_ARGS=()
if [[ -n "${FEE_PAYER_KEYPAIR:-}" ]]; then
  if [[ ! -f "${ROOT}/${FEE_PAYER_KEYPAIR}" ]]; then
    echo "FEE_PAYER_KEYPAIR file not found: ${ROOT}/${FEE_PAYER_KEYPAIR}"
    exit 1
  fi
  KP="/work/${FEE_PAYER_KEYPAIR}"
  KEY_ARGS=(-k "${KP}")
fi

echo "Deploying ${SO_PATH} to devnet (${RPC_URL})…"
# Upgradeable `ProgramData` must be ≥ binary size; default ~2× .so keeps rent lower than a huge fixed cap.
if [[ -n "${PROGRAM_DEPLOY_MAX_LEN:-}" ]]; then
  MAX_LEN="${PROGRAM_DEPLOY_MAX_LEN}"
else
  SO_BYTES="$(wc -c < "${ROOT}/${SO_PATH}" | tr -d ' ')"
  # Tight cap: rent scales with max_len; only add a small margin above the ELF size.
  MAX_LEN=$((SO_BYTES + 16384))
fi
echo "Using --max-len ${MAX_LEN} (override with PROGRAM_DEPLOY_MAX_LEN=…)"

# Upgrades fail with "account data too small" if on-chain ProgramData is smaller than the new ELF.
# Extend before deploy when needed (no-op if program is not deployed yet or already large enough).
SO_BYTES="${SO_BYTES:-$(wc -c < "${ROOT}/${SO_PATH}" | tr -d ' ')}"
NEED=$((SO_BYTES + 16384))
PROG_ID_PRE="$(
  docker run --rm --entrypoint solana-keygen \
    -v "${ROOT}:/work" \
    "${SOLANA_IMAGE}" \
    pubkey "/work/${KEYPAIR}"
)"
if [[ -z "${SKIP_PROGRAM_EXTEND_CHECK:-}" ]]; then
  SHOW_JSON="$(
    bash "${ROOT}/scripts/devnet-solana-docker.sh" "${KEY_ARGS[@]}" \
      program show "${PROG_ID_PRE}" --url "${RPC_URL}" --output json 2>/dev/null || true
  )"
  DATA_LEN="$(
    printf '%s' "${SHOW_JSON}" | node -e "
      try {
        const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
        const n = j && typeof j.dataLen === 'number' ? j.dataLen : 0;
        process.stdout.write(String(n));
      } catch { process.stdout.write(''); }
    " 2>/dev/null || true
  )"
  if [[ -n "${DATA_LEN}" ]] && [[ "${DATA_LEN}" =~ ^[0-9]+$ ]] && ((DATA_LEN < NEED)); then
    EXT=$((NEED - DATA_LEN))
    echo "On-chain ProgramData is ${DATA_LEN} bytes; extending by ${EXT} so the new binary fits…"
    bash "${ROOT}/scripts/devnet-solana-docker.sh" "${KEY_ARGS[@]}" \
      program extend "${PROG_ID_PRE}" "${EXT}" --url "${RPC_URL}"
  fi
fi

bash "${ROOT}/scripts/devnet-solana-docker.sh" "${KEY_ARGS[@]}" program deploy "${SO_PATH}" \
  --program-id "${KEYPAIR}" \
  --url "${RPC_URL}" \
  --max-len "${MAX_LEN}"

PROG_ID="$(
  docker run --rm --entrypoint solana-keygen \
    -v "${ROOT}:/work" \
    "${SOLANA_IMAGE:-solanalabs/solana:v1.18.26}" \
    pubkey "/work/${KEYPAIR}"
)"
echo "Done. Program id: ${PROG_ID}"
echo "Verify: bash scripts/devnet-solana-docker.sh program show ${PROG_ID} --url ${RPC_URL}"
