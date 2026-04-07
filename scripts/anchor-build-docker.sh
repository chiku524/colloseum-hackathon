#!/usr/bin/env bash
# Build the Anchor program inside Docker (Linux + Solana 1.18 SBF toolchain).
# Usage (from repo root): bash scripts/anchor-build-docker.sh
# With IDL generation (needs a working nightly; may fail on some hosts):
#   bash scripts/anchor-build-docker.sh --idl
# Env overrides: SOLANA_VERSION, RUST_IMAGE, ANCHOR_VERSION

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MSYS_NO_PATHCONV=1

SOLANA_VERSION="${SOLANA_VERSION:-1.18.26}"
RUST_IMAGE="${RUST_IMAGE:-rust:1.79-bookworm}"
ANCHOR_VERSION="${ANCHOR_VERSION:-0.30.1}"

ANCHOR_EXTRA=(--no-idl)
if [[ "${1:-}" == "--idl" ]]; then
  ANCHOR_EXTRA=()
  shift
fi
# Expand on the host so the container sees a plain anchor argv.
ANCHOR_EXTRA_WORDS="${ANCHOR_EXTRA[*]}"

docker run --rm \
  -v "${ROOT}:/work" \
  -w /work \
  "${RUST_IMAGE}" \
  bash -c "
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq curl bzip2 pkg-config libudev-dev libssl-dev >/dev/null
if [ ! -x /opt/solana-release/bin/solana ]; then
  curl -sL 'https://github.com/solana-labs/solana/releases/download/v${SOLANA_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2' -o /tmp/sol.tar.bz2
  tar -xjf /tmp/sol.tar.bz2 -C /opt
fi
export PATH=\"/opt/solana-release/bin:\$PATH\"
if ! command -v anchor >/dev/null 2>&1; then
  cargo install anchor-cli --version ${ANCHOR_VERSION} --locked --quiet
fi
anchor build ${ANCHOR_EXTRA_WORDS}
"

echo "Done. Artifact: ${ROOT}/target/deploy/creator_treasury.so"
