#!/usr/bin/env sh
set -eu

env_dir="${1:?the directory holding the deployment's environment, one file per variable}"
migration_timeout="${MIGRATION_TIMEOUT_SECONDS:-1500}"

: "${CONVEX_SELF_HOSTED_URL:?the backend this release is pushed to}"
: "${CONVEX_SELF_HOSTED_ADMIN_KEY:?the backend's admin key}"

until node -e 'fetch(process.env.CONVEX_SELF_HOSTED_URL + "/version").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'; do
  sleep 2
done

for f in "$env_dir"/*; do
  [ -f "$f" ] || continue
  pnpm exec convex env set "$(basename "$f")" "$(cat "$f")"
done
if [ -n "${PREVIEW_SITE_URL:-}" ]; then
  pnpm exec convex env set SITE_URL "$PREVIEW_SITE_URL"
fi

pnpm exec convex deploy --typecheck disable --codegen disable

pnpm exec convex run migrations:runLive

deadline=$(($(date +%s) + migration_timeout))
while :; do
  verdict=$(pnpm exec convex run migrations:liveStatus | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c)).on("end", () => {
      const all = JSON.parse(raw);
      const bad = all.find((m) => m.state === "failed" || m.state === "canceled");
      if (bad) return console.log(`failed ${bad.name}: ${bad.state} ${bad.error ?? ""}`);
      const pending = all.filter((m) => !m.isDone).map((m) => `${m.name} (${m.processed} processed)`);
      console.log(pending.length ? `pending ${pending.join(", ")}` : "done");
    });
  ')
  case "$verdict" in
    done) echo "migrations complete"; exit 0 ;;
    failed*) echo "$verdict" >&2; exit 1 ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "migrations still running after ${migration_timeout}s: ${verdict#pending }" >&2
    exit 1
  fi
  echo "$verdict"
  sleep 5
done
