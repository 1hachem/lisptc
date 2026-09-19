#!/usr/bin/env bash
set -euo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")
path=$(jq -r '.tool_input.file_path // ""' <<<"$payload")

if [ "$tool" = "apply_patch" ]; then
	path=$(jq -r '.tool_input.command // ""' <<<"$payload" | sed -n 's/^\*\*\* Add File: //p')
fi

case "$path" in
*.md|*.mdx|*.markdown)
	;;
*)
	exit 0
	;;
esac

case "${path##*/}" in
README.md|AGENTS.md|CLAUDE.md)
	exit 0
	;;
esac

case "$path" in
*/.agents/skills/*|*/.agents/agents/*|.agents/skills/*|.agents/agents/*)
	exit 0
	;;
esac

if [ "$tool" = "apply_patch" ]; then
	echo "Blocked: this repo adds no new markdown files. The code is the only source of truth, so put the reason in a name, a type or a test. README.md, AGENTS.md, CLAUDE.md, and files under .agents/skills/ and .agents/agents/ are the exceptions." >&2
	exit 2
fi

if [ -e "$path" ]; then
	exit 0
fi

echo "Blocked: this repo adds no new markdown files. The code is the only source of truth, so put the reason in a name, a type or a test. Editing an existing .md is fine, and README.md, AGENTS.md, CLAUDE.md, and files under .agents/skills/ and .agents/agents/ are the exceptions." >&2
exit 2
