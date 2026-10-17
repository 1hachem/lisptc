#!/usr/bin/env bash
set -uo pipefail

tries="${RETRY_TRIES:-4}"
delay=2
attempt=1
until out=$("$@"); do
  status=$?
  if [ "$attempt" -ge "$tries" ]; then
    printf 'retry: %.120s failed %d times, last exit %d\n' "$*" "$attempt" "$status" >&2
    exit "$status"
  fi
  printf 'retry: %.120s exited %d, trying again in %ds\n' "$*" "$status" "$delay" >&2
  sleep "$delay"
  attempt=$((attempt + 1))
  delay=$((delay * 2))
done
printf '%s\n' "$out"
