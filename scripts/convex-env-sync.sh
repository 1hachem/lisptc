#!/usr/bin/env bash
set -euo pipefail

: "${INFISICAL_KEYS_CONVEX_DEPLOY?run this through a task that loads infisical /convex-deploy}"

for name in $INFISICAL_KEYS_CONVEX_DEPLOY; do
	printenv "$name" | pnpm --silent --filter @repo/backend exec convex env set "$name"
done
