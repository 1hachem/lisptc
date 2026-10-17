#!/bin/sh
set -eu

declared=$(node --no-warnings --input-type=module -e '
import { deploymentEnv } from "./convex/lib/env.ts";
for (const [name, validator] of Object.entries(deploymentEnv)) console.log(name, validator.isOptional);
')

while read -r name optionality; do
	value=$(printenv "$name" || true)
	if [ -n "$value" ]; then
		printf '%s' "$value" | pnpm --silent exec convex env set "$name"
	elif [ "$optionality" = required ]; then
		echo "$name is declared required in convex/lib/env.ts and is unset here" >&2
		exit 1
	fi
done <<EOF
$declared
EOF
