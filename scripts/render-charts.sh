#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

retry() {
  local attempt
  for attempt in 1 2 3 4; do
    "$@" && return 0
    [ "$attempt" -lt 4 ] || return 1
    echo "attempt $attempt failed, retrying in $((attempt * 10))s" >&2
    sleep $((attempt * 10))
  done
}

placeholders='s/{{ *\.number *}}/0/g; s/{{ *\.head_sha *}}/main/g'

echo "render deploy/helmfile.yaml.gotmpl"
retry helmfile template -e prod -f "$root/deploy/helmfile.yaml.gotmpl" >"$out/bootstrap.yaml"

files=("$root"/argocd/*.yaml)
for ((f = 0; f < ${#files[@]}; f++)); do
  file="${files[$f]}"
  case "$(yq '.kind' "$file")" in
    Application) app='' ;;
    ApplicationSet) app='.spec.template' ;;
    *) continue ;;
  esac

  name="$(yq "$app.metadata.name" "$file" | sed "$placeholders")"
  namespace="$(yq "$app.spec.destination.namespace" "$file" | sed "$placeholders")"
  sources="($app.spec.sources // [$app.spec.source])"

  for i in $(seq 0 $(($(yq "$sources | length" "$file") - 1))); do
    src="$sources[$i]"
    chart="$(yq "$src.chart // \"\"" "$file")"
    path="$(yq "$src.path // \"\"" "$file")"

    args=()
    if [ -n "$chart" ]; then
      args=("$chart" --repo "$(yq "$src.repoURL" "$file")" --version "$(yq "$src.targetRevision" "$file")")
    elif [ -n "$path" ] && [ ! -f "$root/$path/Chart.yaml" ]; then
      files+=("$root/$path"/*.yaml)
      continue
    elif [ -n "$path" ]; then
      args=("$root/$path")
    else
      continue
    fi

    while IFS= read -r values; do
      [ -n "$values" ] && args+=(-f "$root/${values#\$values/}")
    done < <(yq "$src.helm.valueFiles // [] | .[]" "$file")

    inline="$out/$name-$i.values.yaml"
    yq "$src.helm.valuesObject // {}" "$file" | sed "$placeholders" >"$inline"
    args+=(-f "$inline")

    echo "render ${file#"$root"/} as $name"
    retry helm template "$name" "${args[@]}" -n "$namespace" >"$out/$name-$i.yaml"
  done
done
