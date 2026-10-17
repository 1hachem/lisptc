#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")
paths=$(jq -r '.tool_input.file_path // ""' <<<"$payload")

if [ "$tool" = "apply_patch" ]; then
	paths=$(jq -r '.tool_input.command // ""' <<<"$payload" | sed -n 's/^\*\*\* \(Add\|Update\|Delete\) File: //p')
fi

while IFS= read -r path; do
	if [ "${path##*/}" = "pnpm-lock.yaml" ]; then
		echo "Blocked: pnpm-lock.yaml is generated, never edited. Change the package.json that declares the dependency and run \`pnpm install\` to regenerate it." >&2
		exit 2
	fi
done <<<"$paths"

exit 0
