#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")

generated='(^|[/[:space:]"'"'"'])convex/_generated/'

block() {
	echo "Blocked: the files under convex/_generated/ are written by the convex CLI alone, never by hand." >&2
	echo "To update them, change the module under convex/ and run \`task convex:generate\`. It starts the local convex backend and regenerates convex/_generated/ from the modules." >&2
	exit 2
}

case "$tool" in
Write|Edit|MultiEdit|NotebookEdit)
	path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' <<<"$payload")
	if grep -Eq "$generated" <<<"$path"; then block; fi
	;;
apply_patch)
	paths=$(jq -r '.tool_input.command // ""' <<<"$payload" | sed -n 's/^\*\*\* \(Add\|Update\|Delete\) File: //p')
	if grep -Eq "$generated" <<<"$paths"; then block; fi
	;;
Bash)
	command=$(jq -r '.tool_input.command // ""' <<<"$payload")
	cwd=$(jq -r '.cwd // ""' <<<"$payload")
	if grep -Eq '/convex/_generated(/|$)' <<<"$cwd" \
		|| grep -Eq '(^|[^[:alnum:]_-])cd[[:space:]]+[^|;&]*_generated' <<<"$command"; then
		path=''
		redirect='>{1,2}[[:space:]]*[^[:space:]&|;/]'
	elif grep -Eq "$generated" <<<"$command"; then
		path='convex/_generated/'
		redirect='>{1,2}[[:space:]]*[^[:space:]&|;]*convex/_generated/'
	else
		exit 0
	fi
	if grep -Eq '(^|[^[:alnum:]_-])(sed|perl)[[:space:]]+([^|;&]*[[:space:]])?-[[:alnum:]]*i' <<<"$command" \
		|| grep -Eq "$redirect" <<<"$command" \
		|| grep -Eq "(^|[^[:alnum:]_-])(tee|cp|mv|rm|truncate|install|ln|touch|patch|dd)[[:space:]][^|;&]*${path}" <<<"$command" \
		|| grep -Eq "git[[:space:]]+(checkout|restore)[^|;&]*${path}" <<<"$command"; then
		block
	fi
	;;
esac

exit 0
