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
pushed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

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
total=0
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
    break
  fi
  sleep "$POLL"
  waited=$((waited + POLL))
done

failed=$(jq -r '.[] | select(.status == "completed" and (.conclusion | IN("success", "skipped", "neutral", "cancelled") | not)) | "- \(.name) (\(.conclusion)): run \(.databaseId) \(.url)"' <<<"$runs")
still=$(jq -r '.[] | select(.status != "completed") | "- \(.name) (\(.status)): run \(.databaseId)"' <<<"$runs")

ci_msg=""
if [ -n "$failed" ]; then
  ci_msg=$(cat <<MSG
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
)
fi

review_msg=""
review_unavailable() {
  review_msg=$(cat <<MSG
Could not check $branch for review feedback:

$1

Check \`gh auth status\` and the network, then look for unresolved threads, reviews and comments on its PR by hand with \`gh pr view $branch --comments\`. Do not assume there is none.
MSG
)
}

threads_query='query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {repository(owner: $owner, name: $repo) {pullRequest(number: $number) {reviewThreads(first: 100, after: $endCursor) {pageInfo {hasNextPage endCursor} nodes {isResolved isOutdated path line comments(first: 100) {nodes {author {login} body}}}}}}}'

if ! pr=$(gh pr list --head "$branch" --state open --json number,url --jq '.[0] // empty' 2>&1); then
  review_unavailable "$pr"
elif [ -n "$pr" ]; then
  number=$(jq -r '.number' <<<"$pr")
  url=$(jq -r '.url' <<<"$pr")
  if ! threads=$(gh api graphql --paginate --slurp -F owner='{owner}' -F repo='{repo}' -F number="$number" -f query="$threads_query" 2>&1); then
    review_unavailable "$threads"
  elif ! recent=$(gh api graphql -F owner='{owner}' -F repo='{repo}' -F number="$number" -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviews(last: 100) { nodes { submittedAt author { login } } }
          comments(last: 100) { nodes { createdAt author { login } } }
        }
      }
    }' 2>&1); then
    review_unavailable "$recent"
  else
    unresolved=$(jq '[.[].data.repository.pullRequest.reviewThreads.nodes[] | select((.isResolved or .isOutdated) | not)] | length' <<<"$threads")
    counts=$(jq -r --arg since "$pushed_at" '.data.repository.pullRequest as $pr | [
      ([$pr.reviews.nodes[] | select(.submittedAt >= $since)] | length),
      ([$pr.comments.nodes[] | select(.createdAt >= $since and .author.login != "github-actions")] | length)
    ] | @tsv' <<<"$recent")
    read -r reviews comments <<<"$counts"
    if [ $((unresolved + reviews + comments)) -gt 0 ]; then
      review_msg=$(cat <<MSG
PR #$number ($url) has review feedback to triage: $unresolved unresolved review threads, $reviews reviews and $comments comments since the push.

Triage it before changing anything:
1. Send a script agent to collect every unresolved review thread, every review body and every PR comment, and report each one verbatim with its author and file:line. The commands:
   - \`gh api graphql --paginate --slurp -F owner='{owner}' -F repo='{repo}' -F number=$number -f query='$threads_query'\` (keep the threads that are neither resolved nor outdated)
   - \`gh pr view $number --json reviews,comments\`
2. Read the code each comment points at, and judge every point on three axes:
   - valid or not: is the reviewer right about this code, or is it a false positive, a misread, or against a rule in AGENTS.md?
   - priority: a real bug or rule break, or a low-priority nit?
   - effort: an easy, local fix, or a larger change?
3. Show the user one table with a row per point: reviewer, file:line, a one-line summary, and your verdict on each axis with a short reason. Merge duplicates the bots raised more than once.
4. Ask the user with AskUserQuestion (multiSelect) which points to work on; the rest are ignored. Recommend the valid, high-priority ones. Do not fix, reply to or resolve anything until they answer.
5. Once a chosen point is fixed, tested and pushed, reply on its thread with a short description of the change and the commit that made it, then resolve the thread. A point that is answered but not fixed gets a reply and stays open.
MSG
)
    fi
  fi
fi

[ -z "$ci_msg" ] && [ -z "$review_msg" ] && exit 0

if [ -n "$ci_msg" ] && [ -n "$review_msg" ]; then
  printf '%s\n\nOnce CI is fixed and pushed, or you have told the user the failure is unrelated, deal with the PR. Fix nothing for it before the user has chosen.\n\n%s\n' "$ci_msg" "$review_msg" >&2
else
  printf '%s\n' "$ci_msg$review_msg" >&2
fi
exit 2
