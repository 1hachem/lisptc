#!/usr/bin/env bash
set -euo pipefail

pr="$1"
sha="${2:-}"
branch=previews
file="pr-$pr.json"
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

git -C "$dir" init -q
git -C "$dir" config user.name "github-actions[bot]"
git -C "$dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$dir" remote add origin "https://x-access-token:$GH_TOKEN@github.com/$REPO.git"

for attempt in 1 2 3 4 5; do
  if git -C "$dir" fetch -q --depth 1 origin "$branch"; then
    git -C "$dir" checkout -q -f -B "$branch" FETCH_HEAD
  elif [ -z "$sha" ]; then
    exit 0
  else
    git -C "$dir" checkout -q --orphan "$branch"
  fi

  if [ -n "$sha" ]; then
    printf '{"number":"%s","sha":"%s"}\n' "$pr" "$sha" > "$dir/$file"
    git -C "$dir" add "$file"
  elif [ -e "$dir/$file" ]; then
    git -C "$dir" rm -q "$file"
  fi

  git -C "$dir" diff --cached --quiet && exit 0
  git -C "$dir" commit -q -m "preview pr-$pr ${sha:-removed}"
  git -C "$dir" push -q origin "$branch" && exit 0
  sleep $((attempt * 2))
done

exit 1
