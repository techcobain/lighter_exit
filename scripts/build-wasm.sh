#!/usr/bin/env bash
# Rebuilds public/lighter-signer.wasm and public/wasm_exec.js from Lighter's
# Go SDK. The two files must come from the same Go toolchain, which is why
# wasm_exec.js is copied from GOROOT here rather than taken from the repo.
set -euo pipefail

LIGHTER_GO_REF="${LIGHTER_GO_REF:-9d38261}"   # elliottech/lighter-go commit this build was verified against
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone -q https://github.com/elliottech/lighter-go "$WORK/lighter-go"
git -C "$WORK/lighter-go" checkout -q "$LIGHTER_GO_REF"

(cd "$WORK/lighter-go" && GOFLAGS=-mod=mod GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o "$ROOT/public/lighter-signer.wasm" ./web-wasm)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$ROOT/public/wasm_exec.js"

echo "built public/lighter-signer.wasm ($(du -h "$ROOT/public/lighter-signer.wasm" | cut -f1)) with $(go version)"
