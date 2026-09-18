#!/usr/bin/env bash
set -euo pipefail

BUDGET=${CLAUDE_IO_BUDGET:-3}
STATE="${TMPDIR:-/tmp}/claude-io-budget"

payload=$(cat)
read -r tool agent_type session cwd <<<"$(
  jq -r '[.tool_name // "-", .agent_type // .agent_id // "-", .session_id // "unknown", .cwd // "-"] | @tsv' <<<"$payload"
)"

[ "$agent_type" = "-" ] || exit 0

agent=""
what=""

case "$tool" in
Grep | Glob)
  path=$(jq -r '.tool_input.path // ""' <<<"$payload")
  case "$path" in
  "" | "." | "$cwd" | "$cwd/packages" | "$cwd/apps" | packages | apps)
    agent="explore"
    what="a repo-wide $tool"
    ;;
  esac
  ;;
Bash)
  cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
  if grep -qE '(^|[|;&] *)(rg|find|ag|tree)\b|grep +-[a-zA-Z]*[rR]|ls +-[a-zA-Z]*R' <<<"$cmd"; then
    agent="explore"
    what="a recursive search"
  elif grep -qE '\bpnpm\b[^|;&]*\b(test|typecheck|build|lint|knip|boundaries|check:[a-z]+)\b|\b(turbo +run|vitest|tsc +--noEmit|docker +(compose +)?logs|task +up|journalctl)' <<<"$cmd"; then
    agent="script"
    what="a long-output run"
  elif grep -qE '\bchrome-agent +(attach|launch)' <<<"$cmd"; then
    agent="browser"
    what="a browser session"
  fi
  ;;
esac

[ -n "$agent" ] || exit 0

mkdir -p "$STATE"
counter="$STATE/$session"
spent=$(cat "$counter" 2>/dev/null || echo 0)

if [ "$spent" -lt "$BUDGET" ]; then
  echo $((spent + 1)) >"$counter"
  exit 0
fi

cat >&2 <<MSG
Blocked: the main thread has spent its IO budget ($spent heavy calls this session), and this is $what.
Hand it to the agent that owns it instead: Agent(subagent_type: "$agent") with the question and the scope.
It runs a small model, reads the output, and reports the answer back. Do not retry this call.
MSG
exit 2
