#!/usr/bin/env bash
set -euo pipefail

GRACE=${CLAUDE_CI_GRACE:-180}
POLL=${CLAUDE_CI_POLL:-60}
DEADLINE=${CLAUDE_CI_DEADLINE:-2400}

payload=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
cwd=$(jq -r '.cwd // ""' <<<"$payload")

grep -qE '(^|[|;&] *)git +push\b' <<<"$cmd" || exit 0
grep -qE -- '--dry-run|(^| )-n( |$)|--delete|(^| )-d( |$)|--tags( |$)' <<<"$cmd" && exit 0

cd "${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"
sha=$(git rev-parse HEAD)
branch=$(git rev-parse --abbrev-ref HEAD)

sleep "$GRACE"

waited=$GRACE
while :; do
  runs=$(gh run list --commit "$sha" --json databaseId,name,status,conclusion,url 2>/dev/null || echo '[]')
  pending=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
  total=$(jq 'length' <<<"$runs")
  if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
    break
  fi
  if [ "$waited" -ge "$DEADLINE" ]; then
    [ "$total" -eq 0 ] && exit 0
    break
  fi
  sleep "$POLL"
  waited=$((waited + POLL))
done

failed=$(jq -r '.[] | select(.status == "completed" and (.conclusion | IN("success", "skipped", "neutral") | not)) | "- \(.name) (\(.conclusion)): run \(.databaseId) \(.url)"' <<<"$runs")
still=$(jq -r '.[] | select(.status != "completed") | "- \(.name) (\(.status)): run \(.databaseId)"' <<<"$runs")

[ -z "$failed" ] && exit 0

cat >&2 <<MSG
CI failed for $branch at ${sha:0:12}, the commit you pushed.

$failed
${still:+
Still running when this check gave up:
$still}

Fix it now:
1. Send a script agent to run \`gh run view <run> --log-failed\` for each failed run and report the failing steps and errors verbatim.
2. Read the diff you pushed (\`git log -p origin/main..HEAD\` or the commits of this session) and work out how your change caused each failure. If a failure is unrelated to your change (flaky test, infra outage), say so to the user and stop instead of patching around it.
3. Fix the cause, reproduce the failing check locally under the command CI names, commit it as its own conventional commit, and push. The push re-arms this watch.
MSG
exit 2
