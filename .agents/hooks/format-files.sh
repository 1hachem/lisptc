#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
declare -A seen=()
files=()

for path in "$@"; do
	if [[ "$path" = /* ]]; then
		file=$(realpath -m "$path")
	else
		file=$(realpath -m "$root/$path")
	fi
	case "$file" in
	"$root"/*)
		if [ -f "$file" ] && [ -z "${seen[$file]:-}" ]; then
			seen[$file]=1
			files+=("$file")
		fi
		;;
	esac
done

[ "${#files[@]}" -gt 0 ] || exit 0
pnpm --dir "$root" exec biome format --write --no-errors-on-unmatched -- "${files[@]}"
