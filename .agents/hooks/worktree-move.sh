#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
cwd=$(jq -r '.cwd // ""' <<<"$payload")

grep -qE '\bgit\b.*\bworktree +move\b' <<<"$cmd" || exit 0

dest=$(sed -E 's/.*worktree +move +//; s/[;&|].*//' <<<"$cmd" | xargs -n1 | grep -v '^-' | sed -n 2p)
[ -n "$dest" ] || exit 0

main=$(dirname "$(git -C "${cwd:-$PWD}" rev-parse --path-format=absolute --git-common-dir)")
case "$dest" in
/*) ;;
"~"*) dest="$HOME${dest#\~}" ;;
*) dest="${cwd:-$PWD}/$dest" ;;
esac
dest=$(realpath -m "$dest")

slug=${dest#"$main"/worktrees/}
if [ "$slug" = "$dest" ] || ! grep -qE '^[a-z]+/[^/]+$' <<<"$slug"; then
	echo "Blocked: a worktree lives at $main/worktrees/<type>/<slug>, not $dest" >&2
	exit 2
fi
