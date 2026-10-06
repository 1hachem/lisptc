#!/usr/bin/env bash
set -euo pipefail

GRACE=${CLAUDE_CI_GRACE:-180}
POLL=${CLAUDE_CI_POLL:-60}
DEADLINE=${CLAUDE_CI_DEADLINE:-2400}
MAX_MISSES=${CLAUDE_CI_MAX_MISSES:-3}

payload=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
cwd=$(jq -r '.cwd // ""' <<<"$payload")

grep -qE '(^|[|;&] *)git +push\b' <<<"$cmd" || exit 0
grep -qE -- '--dry-run|(^| )-n( |$)|--delete|(^| )-d( |$)|--tags( |$)' <<<"$cmd" && exit 0

cd "${cwd:-${CLAUDE_PROJECT_DIR:-$PWD}}"
sha=$(git rev-parse HEAD)
branch=$(git rev-parse --abbrev-ref HEAD)

sleep "$GRACE"

unavailable() {
  cat >&2 <<MSG
Could not read the CI status of $branch at ${sha:0:12}, the commit you pushed. \`gh run list\` failed $misses times in a row:

$lookup_error

Check \`gh auth status\` and the network, then check CI for this commit by hand with \`gh run list --commit $sha\`. Do not assume it passed.
MSG
  exit 2
}

waited=$GRACE
misses=0
lookup_error=""
runs='[]'
while :; do
  if fresh=$(gh run list --commit "$sha" --json databaseId,name,status,conclusion,url 2>&1); then
    runs=$fresh
    misses=0
  else
    misses=$((misses + 1))
    lookup_error=$fresh
    [ "$misses" -ge "$MAX_MISSES" ] && unavailable
  fi
  if [ "$misses" -eq 0 ]; then
    pending=$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs")
    total=$(jq 'length' <<<"$runs")
    if [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
      break
    fi
  fi
  if [ "$waited" -ge "$DEADLINE" ]; then
    [ "$misses" -gt 0 ] && unavailable
    [ "$total" -eq 0 ] && exit 0
    break
  fi
  sleep "$POLL"
  waited=$((waited + POLL))
done

failed=$(jq -r '.[] | select(.status == "completed" and (.conclusion | IN("success", "skipped", "neutral", "cancelled") | not)) | "- \(.name) (\(.conclusion)): run \(.databaseId) \(.url)"' <<<"$runs")
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
