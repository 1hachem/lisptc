#!/usr/bin/env bash
set -uo pipefail

session="${1:-}"
interval="${HUNK_NOTES_INTERVAL:-2}"

if [ -z "$session" ]; then
	session=$(hunk session list --json | jq -r --arg pwd "$PWD" '
		[.sessions[] | select(.cwd == $pwd)] as $here
		| (if ($here | length) > 0 then $here else .sessions end)
		| if length == 1 then .[0].sessionId else empty end')
fi

if [ -z "$session" ]; then
	echo '{"event":"error","reason":"no single hunk session to watch; pass its id"}'
	exit 1
fi

seen="${XDG_STATE_HOME:-$HOME/.local/state}/hunk-review-mode/$session.seen"
mkdir -p "$(dirname "$seen")"
touch "$seen"

echo "{\"event\":\"watching\",\"session\":\"$session\"}"

while true; do
	if ! notes=$(hunk session comment list "$session" --type user --json 2>&1); then
		echo "{\"event\":\"session-gone\",\"session\":\"$session\",\"error\":$(jq -Rs . <<<"$notes")}"
		exit 0
	fi
	jq -c '.comments[]' <<<"$notes" | while IFS= read -r note; do
		id=$(jq -r '.noteId // .commentId // .id // empty' <<<"$note")
		[ -n "$id" ] || continue
		if ! grep -qxF "$id" "$seen"; then
			echo "$id" >>"$seen"
			jq -c --arg s "$session" '{event:"note",session:$s,note:.}' <<<"$note"
		fi
	done
	sleep "$interval"
done
