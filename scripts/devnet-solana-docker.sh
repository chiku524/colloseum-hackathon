#!/usr/bin/env bash
# Run solana CLI against devnet inside Docker (no local Solana install).
# Usage:
#   bash scripts/devnet-solana-docker.sh balance
#   bash scripts/devnet-solana-docker.sh airdrop 2 92Heix... --url https://api.devnet.solana.com
#   bash scripts/devnet-solana-docker.sh program deploy target/deploy/creator_treasury.so \
#     --program-id target/deploy/creator_treasury-keypair.json --url https://api.devnet.solana.com
#
# Mounts ~/.config/solana so deploy/airdrop use your real wallet when configured.
# On Git Bash (Windows), MSYS_NO_PATHCONV keeps Docker paths valid.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MSYS_NO_PATHCONV=1

SOLANA_IMAGE="${SOLANA_IMAGE:-solanalabs/solana:v1.18.26}"
CONFIG_DIR="${SOLANA_CONFIG_DIR:-$HOME/.config/solana}"

mkdir -p "$CONFIG_DIR"

exec docker run --rm \
  --entrypoint solana \
  -v "${CONFIG_DIR}:/root/.config/solana" \
  -v "${ROOT}:/work" \
  -w /work \
  "${SOLANA_IMAGE}" \
  "$@"
