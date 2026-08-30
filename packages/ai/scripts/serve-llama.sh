#!/usr/bin/env bash
# Start the local llama-server for the gemma model and make sure the
# system-prompt KV cache is populated (restored from disk, or built once by
# warm-llama.sh). Driven by `task serve-gemma`.
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
CACHE_DIR="${CACHE_DIR:-.llama-cache}"
MODEL="${MODEL:-ggml-org/gemma-4-E4B-it-GGUF}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$root"

# Always start fresh: stop whatever is already bound to the port so a stale
# server (or a leftover from a prior `task dev`) never blocks the new one.
old=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2 || true)
if [ -n "$old" ]; then
  echo "stopping existing server (pid $old) on $PORT"
  kill "$old" 2>/dev/null || true
  for _ in $(seq 1 20); do ss -ltn 2>/dev/null | grep -q ":$PORT " && sleep 0.5 || break; done
fi

mkdir -p "$CACHE_DIR"
# The cache is keyed to the prompt's content hash: edit the prompt and the
# old file is simply not found, so a stale cache can never be restored.
hash=$(node --experimental-transform-types packages/ai/scripts/prompt-hash.ts 2>/dev/null || true)
slot="system-$hash.bin"

# Once the server is listening, either restore the cache or, if it's missing
# (first run, or the prompt changed), build it via warm-llama.sh — so the cache
# always ends up populated without a separate manual step. Runs in the
# background; `exec` then hands the foreground to llama-server so Ctrl-C stops
# it directly.
(
  until curl -sf "http://$HOST:$PORT/health" >/dev/null 2>&1; do sleep 1; done
  if [ -n "$hash" ] && [ -f "$CACHE_DIR/$slot" ]; then
    echo "restoring system-prompt KV from $CACHE_DIR/$slot"
    if curl -sf -X POST "http://$HOST:$PORT/slots/0?action=restore" \
         -H 'content-type: application/json' -d "{\"filename\":\"$slot\"}" >/dev/null; then
      echo "KV restored — system prompt won't be re-evaluated"
    else
      echo "KV restore failed (stale cache?); rebuilding"
      rm -f "$CACHE_DIR/$slot"
      HOST="$HOST" PORT="$PORT" CACHE_DIR="$CACHE_DIR" packages/ai/scripts/warm-llama.sh
    fi
  else
    echo "no KV cache for the current prompt — building it now (one-time, slow)"
    HOST="$HOST" PORT="$PORT" CACHE_DIR="$CACHE_DIR" packages/ai/scripts/warm-llama.sh
  fi
) &

# --no-mmproj: serve text-only (the agent has no vision). Slot save/restore
# is disabled for multimodal models, so this is required for the KV cache.
# --no-warmup: skip the empty warmup run through the default chat template.
# --ctx-size 16384: fits the distilled ~4.6k-token system prompt with plenty
# of headroom for the conversation. The default 131072 makes the (full-size,
# for SWA) KV cache large enough to OOM this box.
# --swa-full: gemma's sliding-window attention otherwise discards the prefix
# KV, so nothing would be reusable.
# -ngl 99: offload all layers to the Vulkan (Radeon iGPU) backend. The
# E2B model is small enough to fit entirely, so there's no reason to keep
# any layers on the CPU.
exec llama-server \
  -hf "$MODEL" --no-mmproj --no-warmup \
  --host "$HOST" --port "$PORT" \
  --ctx-size 16384 --parallel 1 --swa-full \
  -ngl 99 \
  --slot-save-path "$CACHE_DIR"
