#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
path=$(jq -r '.worktree_path // ""' <<<"$payload")

if [ -z "$path" ] || [ ! -d "$path" ]; then
	exit 0
fi

common=$(git -C "$path" rev-parse --path-format=absolute --git-common-dir)
root=$(dirname "$common")
branch=$(git -C "$path" symbolic-ref --quiet --short HEAD || true)

git -C "$root" worktree remove --force "$path" >&2

if [ -n "$branch" ]; then
	git -C "$root" branch -d "$branch" >&2 || echo "worktree-remove: kept unmerged branch $branch" >&2
fi
