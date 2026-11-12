#!/usr/bin/env bash
# Rebuilds public/lighter-signer.wasm and public/wasm_exec.js from Lighter's
# Go SDK, and records their SHA-256 in scripts/signer.sha256. The two files
# must come from the same Go toolchain, which is why wasm_exec.js is copied
# from GOROOT here rather than taken from the repo.
#
# The build is reproducible: the same lighter-go commit and Go version give the
# same bytes on any machine, so anyone can run this script and check that the
# committed binary is what the source produces (`git diff --exit-code public scripts/signer.sha256`).
set -euo pipefail

LIGHTER_GO_REF="${LIGHTER_GO_REF:-9d38261d1a4cc5c7211b383ba07a4d6e41604708}"   # elliottech/lighter-go commit this build was verified against
GO_VERSION="${GO_VERSION:-go1.26.2}"                                           # toolchain the recorded hashes were produced with
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ "$(go env GOVERSION)" != "$GO_VERSION" ]]; then
  echo "expected $GO_VERSION but found $(go env GOVERSION); another toolchain produces different bytes." >&2
  echo "install $GO_VERSION, or set GO_VERSION to rebuild on purpose with a new one." >&2
  exit 1
fi

git clone -q https://github.com/elliottech/lighter-go "$WORK/lighter-go"
git -C "$WORK/lighter-go" checkout -q "$LIGHTER_GO_REF"

# -trimpath, -buildvcs=false and an empty build id keep local paths and
# machine state out of the binary.
(cd "$WORK/lighter-go" && GOFLAGS=-mod=mod GOOS=js GOARCH=wasm \
  go build -trimpath -buildvcs=false -ldflags="-s -w -buildid=" -o "$ROOT/public/lighter-signer.wasm" ./web-wasm)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$ROOT/public/wasm_exec.js"

(cd "$ROOT" && shasum -a 256 public/lighter-signer.wasm public/wasm_exec.js > scripts/signer.sha256)

echo "built public/lighter-signer.wasm ($(du -h "$ROOT/public/lighter-signer.wasm" | cut -f1)) with $(go version)"
cat "$ROOT/scripts/signer.sha256"
