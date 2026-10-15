#!/usr/bin/env bash
set -euo pipefail

pr="$1"
link="${2:-}"
open='<!-- preview -->'
close='<!-- /preview -->'

body=$(gh api "repos/$REPO/pulls/$pr" --jq '.body // ""')
rest=$(printf '%s\n' "$body" | awk -v start="$open" -v end="$close" '
  { line = $0; sub(/\r$/, "", line) }
  line == start { skip = 1; next }
  skip && line == end { skip = 0; next }
  !skip && (started || line != "") { started = 1; print }
')

if [ -n "$link" ]; then
  next=$(printf '%s\n%s\n%s\n\n%s' "$open" "$link" "$close" "$rest")
else
  next="$rest"
fi

[ "$next" = "$body" ] && exit 0
gh api -X PATCH "repos/$REPO/pulls/$pr" -f body="$next" > /dev/null
