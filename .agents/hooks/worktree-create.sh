#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
name=$(jq -r '.name // ""' <<<"$payload")
cwd=$(jq -r '.cwd // ""' <<<"$payload")

if [ -z "$name" ]; then
	echo "worktree-create: no worktree name in the payload" >&2
	exit 1
fi

common=$(git -C "${cwd:-$PWD}" rev-parse --path-format=absolute --git-common-dir)
root=$(dirname "$common")
path="$root/worktrees/$name"

if [ -e "$path" ]; then
	echo "worktree-create: $path already exists" >&2
	exit 1
fi

if git -C "$root" show-ref --verify --quiet "refs/heads/$name"; then
	git -C "$root" worktree add "$path" "$name" >&2
else
	base=$(git -C "$root" symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo HEAD)
	git -C "$root" worktree add -b "$name" "$path" "$base" >&2
fi

echo "$path"
