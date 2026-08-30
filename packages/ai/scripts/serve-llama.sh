#!/usr/bin/env bash
# Start the local llama-server for the gemma model. The system-prompt KV cache
# is not this script's business — the API primes it on startup (packages/ai/src/warm.ts)
# via the server's own slot restore/save endpoints. Driven by `task serve-gemma`.
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
CACHE_DIR="${CACHE_DIR:-.llama-cache}"
MODEL="${MODEL:-ggml-org/gemma-4-E4B-it-GGUF}"
NGL="${NGL:-0}"
THREADS="${THREADS:-8}"

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

# --no-mmproj: serve text-only (the agent has no vision). Slot save/restore
# is disabled for multimodal models, so this is required for the KV cache.
# --no-warmup: skip the empty warmup run through the default chat template.
# --ctx-size 16384: fits the distilled ~4.6k-token system prompt with plenty
# of headroom for the conversation. The default 131072 makes the (full-size,
# for SWA) KV cache large enough to OOM this box.
# --swa-full: gemma's sliding-window attention otherwise discards the prefix
# KV, so nothing would be reusable.
# -ngl 0 (CPU): this box's GPU is an Intel UHD 620, and offloading to it hangs
# the i915 engine — a single ubatch runs longer than the 640ms rcs0 preemption
# timeout, so the kernel resets the GPU mid-decode and Vulkan aborts the server
# with vk::DeviceLostError. Shrinking --ubatch-size to 32 avoids the reset but is
# *slower* than the CPU (7.8 vs 10.8 tok/s prefill, 1.5 vs 1.8 tok/s generation),
# so there is nothing to win here. Override with `NGL=99` on a real GPU.
exec llama-server \
  -hf "$MODEL" --no-mmproj --no-warmup \
  --host "$HOST" --port "$PORT" \
  --ctx-size 16384 --parallel 1 --swa-full \
  -ngl "$NGL" --threads "$THREADS" \
  --slot-save-path "$CACHE_DIR"
