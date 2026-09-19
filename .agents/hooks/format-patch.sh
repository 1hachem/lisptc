#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
if jq -e '.tool_response.isError == true' >/dev/null <<<"$payload"; then
	exit 0
fi

root=$(git rev-parse --show-toplevel)
cwd=$(jq -r '.cwd // empty' <<<"$payload")
[ -n "$cwd" ] || cwd="$root"
patch=$(jq -r '.tool_input.command // ""' <<<"$payload")
mapfile -t paths < <(sed -n 's/^\*\*\* \(Add\|Update\|Move to\) File: //p; s/^\*\*\* Move to: //p' <<<"$patch")

[ "${#paths[@]}" -gt 0 ] || exit 0
files=()
for path in "${paths[@]}"; do
	if [[ "$path" = /* ]]; then
		files+=("$path")
	else
		files+=("$cwd/$path")
	fi
done

"$root/.agents/hooks/format-files.sh" "${files[@]}"
