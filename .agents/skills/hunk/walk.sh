#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "usage: walk.sh load <plan.json> [session-id] | next | prev | go <n> | show | list" >&2
	exit 2
}

[ $# -ge 1 ] || usage
cmd="$1"
shift

root=$(git rev-parse --show-toplevel)
dir=$(git rev-parse --git-path hunk-walk)
mkdir -p "$dir"
state="$dir/walk.json"

single_session() {
	hunk session list --json | jq -r --arg root "$root" '
		[.sessions[] | select((.repoRoot // .cwd) == $root)]
		| if length == 1 then .[0].sessionId else empty end'
}

column_of() {
	local file="$1" line="$2" mark="$3"
	sed -n "${line}p" "$root/$file" | awk -v m="$mark" '{ i = index($0, m); print (i == 0 ? -1 : i - 1) }'
}

show() {
	local at total stop file line mark start session
	at=$(jq -r '.at' "$state")
	total=$(jq -r '.stops | length' "$state")
	session=$(jq -r '.session' "$state")
	stop=$(jq -c --argjson i "$at" '.stops[$i - 1]' "$state")
	file=$(jq -r '.file' <<<"$stop")
	line=$(jq -r '.line' <<<"$stop")
	mark=$(jq -r '.mark' <<<"$stop")
	start=$(column_of "$file" "$line" "$mark")
	hunk session highlight clear "$session" >/dev/null
	hunk session navigate "$session" --file "$file" --new-line "$line" >/dev/null
	if [ "$start" -ge 0 ]; then
		hunk session highlight add "$session" --file "$file" --new-line "$line" \
			--start "$start" --end $((start + ${#mark})) --tone current --focus >/dev/null
	fi
	echo "Stop $at/$total  $file:$line"
	echo
	jq -r '.say' <<<"$stop"
	if [ "$start" -lt 0 ]; then
		echo
		echo "(mark \"$mark\" not found on $file:$line, nothing highlighted)"
	fi
}

move_to() {
	local to="$1" total
	total=$(jq -r '.stops | length' "$state")
	if [ "$to" -lt 1 ] || [ "$to" -gt "$total" ]; then
		echo "No stop $to: the walk has $total." >&2
		exit 1
	fi
	jq --argjson i "$to" '.at = $i' "$state" >"$state.tmp" && mv "$state.tmp" "$state"
	show
}

load() {
	local plan="$1" session="${2:-}" total missing
	[ -n "$session" ] || session=$(single_session)
	if [ -z "$session" ]; then
		echo "No single hunk session in this checkout; pass its id." >&2
		exit 1
	fi
	jq -e '.stops | type == "array" and length > 0' "$plan" >/dev/null ||
		{ echo "The plan has no stops." >&2; exit 1; }
	missing=$(jq -r '.stops | to_entries[]
		| select([.value.file, .value.line, .value.mark, .value.summary, .value.say] | any(. == null))
		| "stop \(.key + 1) lacks one of file, line, mark, summary, say"' "$plan")
	if [ -n "$missing" ]; then
		echo "$missing" >&2
		exit 1
	fi
	total=$(jq '.stops | length' "$plan")
	jq --argjson n "$total" '{comments: [.stops | to_entries[] | {
		filePath: .value.file,
		newLine: .value.line,
		author: "Claude",
		summary: "\(.key + 1)/\($n) \(.value.summary)",
		rationale: (.value.rationale // "")
	}]}' "$plan" | hunk session comment apply "$session" --stdin >/dev/null
	jq --arg s "$session" '{session: $s, at: 1, stops: .stops}' "$plan" >"$state"
	list
	echo
	show
}

list() {
	jq -r '.stops | to_entries[] | "\(.key + 1). \(.value.file):\(.value.line)  \(.value.summary)"' "$state"
}

need_state() {
	[ -f "$state" ] || { echo "No walk loaded; run walk.sh load <plan.json> first." >&2; exit 1; }
}

case "$cmd" in
load)
	[ $# -ge 1 ] || usage
	load "$@"
	;;
next)
	need_state
	move_to $(($(jq -r '.at' "$state") + 1))
	;;
prev)
	need_state
	move_to $(($(jq -r '.at' "$state") - 1))
	;;
go)
	need_state
	[ $# -ge 1 ] || usage
	move_to "$1"
	;;
show)
	need_state
	show
	;;
list)
	need_state
	list
	;;
*)
	usage
	;;
esac
