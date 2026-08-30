#!/usr/bin/env bash
# Build the system-prompt KV cache on disk for a running llama-server.
# Idempotent, and auto-run by serve-llama.sh — not meant to be called by hand.
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
CACHE_DIR="${CACHE_DIR:-.llama-cache}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root"

hash=$(node --experimental-transform-types packages/ai/scripts/prompt-hash.ts 2>/dev/null || true)
[ -n "$hash" ] || { echo "failed to compute prompt hash"; exit 1; }

if [ -f "$CACHE_DIR/system-$hash.bin" ]; then
  echo "cache already warm for current prompt (system-$hash.bin) — nothing to do"
  exit 0
fi

# Needs a running server (serve-llama.sh calls this once its own is healthy;
# standalone, wait a bit in case it's still loading).
for i in $(seq 1 60); do
  curl -sf "http://$HOST:$PORT/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "no server on $HOST:$PORT — start 'task serve-gemma' first"; exit 1; }
  sleep 1
done

# Drop caches for older prompt versions — only the current one is useful.
rm -f "$CACHE_DIR"/system-*.bin

LLAMACPP_BASE_URL="http://$HOST:$PORT/v1" LLAMACPP_SLOT_FILE="system-$hash.bin" \
  node --experimental-transform-types packages/ai/scripts/warm-llama.ts
