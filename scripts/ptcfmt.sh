#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

ptcfmt() {
  if command -v ptcfmt >/dev/null 2>&1; then
    command ptcfmt "$@"
  else
    nix run --no-warn-dirty "$root#ptcfmt" -- "$@"
  fi
}

mode="${1:-}"
case "$mode" in
  --write | --check) shift ;;
  *)
    echo "usage: scripts/ptcfmt.sh --write|--check [file.ptc...]" >&2
    exit 2
    ;;
esac

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  mapfile -t files < <(git -C "$root" ls-files '*.ptc')
  cd "$root"
fi

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

if [ "$mode" = "--write" ]; then
  ptcfmt "${files[@]}"
  exit 0
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
copies=()
for file in "${files[@]}"; do
  copy="$scratch/$(printf '%s' "$file" | tr '/' '_')"
  cp "$file" "$copy.ptc"
  copies+=("$copy.ptc")
done
ptcfmt "${copies[@]}"

unformatted=()
for i in "${!files[@]}"; do
  cmp -s "${files[$i]}" "${copies[$i]}" || unformatted+=("${files[$i]}")
done

if [ "${#unformatted[@]}" -gt 0 ]; then
  printf 'not formatted by ptcfmt: %s\n' "${unformatted[@]}" >&2
  echo "run pnpm format:ptc to format them" >&2
  exit 1
fi
