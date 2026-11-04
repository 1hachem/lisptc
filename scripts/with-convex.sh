#!/usr/bin/env bash
set -euo pipefail

version=http://127.0.0.1:3210/version

if ! curl -sf "$version" >/dev/null; then
  kubectl -n lisptc-dev port-forward svc/convex-backend 3210:3210 3211:3211 >/dev/null 2>&1 &
  forward=$!
  trap 'kill "$forward" 2>/dev/null || true' EXIT
  for _ in $(seq 30); do
    curl -sf "$version" >/dev/null && break
    sleep 1
  done
  curl -sf "$version" >/dev/null || { echo "convex-backend in lisptc-dev is not reachable. Run task up first." >&2; exit 1; }
fi

"$@"
