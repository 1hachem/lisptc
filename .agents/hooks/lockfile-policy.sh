#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")

lockfile='(^|[/[:space:]"'"'"'])pnpm-lock\.yaml'

block() {
	echo "Blocked: pnpm-lock.yaml is generated, never edited. Not by hand, not by a script, not to resolve a merge conflict." >&2
	echo "To change a dependency, edit the package.json that declares it and run \`pnpm install\`. To resolve a conflict in the lockfile, take either side with \`git checkout --ours pnpm-lock.yaml\` or \`--theirs\`, then run \`pnpm install\`." >&2
	exit 2
}

case "$tool" in
Write|Edit|MultiEdit|NotebookEdit)
	path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$payload")
	if [ "${path##*/}" = "pnpm-lock.yaml" ]; then block; fi
	;;
apply_patch)
	paths=$(jq -r '.tool_input.command // ""' <<<"$payload" | sed -n 's/^\*\*\* \(Add\|Update\|Delete\) File: //p')
	while IFS= read -r path; do
		if [ "${path##*/}" = "pnpm-lock.yaml" ]; then block; fi
	done <<<"$paths"
	;;
Bash)
	command=$(jq -r '.tool_input.command // ""' <<<"$payload")
	grep -Eq "$lockfile" <<<"$command" || exit 0
	if grep -Eq '(^|[^[:alnum:]_-])(sed|perl)[[:space:]]+([^|;&]*[[:space:]])?-[[:alnum:]]*i' <<<"$command" \
		|| grep -Eq '>{1,2}[[:space:]]*[^[:space:]&|;]*pnpm-lock\.yaml' <<<"$command" \
		|| grep -Eq '(^|[^[:alnum:]_-])(tee|cp|mv|truncate|ln|patch|dd)[[:space:]][^|;&]*pnpm-lock\.yaml' <<<"$command"; then
		block
	fi
	;;
esac

exit 0
