#!/usr/bin/env bash
set -uo pipefail

session="${1:-}"
interval="${HUNK_NOTES_INTERVAL:-2}"

if [ -z "$session" ]; then
	root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
	session=$(hunk session list --json | jq -r --arg root "$root" '
		[.sessions[] | select((.repoRoot // .cwd) == $root)]
		| if length == 1 then .[0].sessionId else empty end')
fi

if [ -z "$session" ]; then
	echo '{"event":"error","reason":"no single hunk session in this checkout; pass its id"}'
	exit 1
fi

echo "{\"event\":\"watching\",\"session\":\"$session\"}"

declare -A sent=()

while true; do
	if ! notes=$(hunk session comment list "$session" --type all --json 2>&1); then
		if sessions=$(hunk session list --json 2>/dev/null) &&
			! jq -e --arg s "$session" 'any(.sessions[]; .sessionId == $s)' <<<"$sessions" >/dev/null; then
			echo "{\"event\":\"session-gone\",\"session\":\"$session\"}"
			exit 0
		fi
		echo "{\"event\":\"retrying\",\"session\":\"$session\",\"error\":$(jq -Rs . <<<"$notes")}"
		sleep "$interval"
		continue
	fi
	while IFS= read -r note; do
		id=$(jq -r '.noteId' <<<"$note")
		[ -n "${sent[$id]:-}" ] && continue
		sent[$id]=1
		jq -c --arg s "$session" '{event:"note",session:$s,note:.}' <<<"$note"
	done < <(jq -c '
		[.comments[] | select(.source != "user") | .parentId // empty] as $answered
		| .comments[]
		| select(.source == "user" and (.noteId as $id | $answered | index($id) | not))' <<<"$notes")
	sleep "$interval"
done
