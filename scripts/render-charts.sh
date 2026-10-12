#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

placeholders='s/{{ *\.number *}}/0/g; s/{{ *\.head_sha *}}/main/g'

echo "render deploy/helmfile.yaml.gotmpl"
helmfile template -e prod -f "$root/deploy/helmfile.yaml.gotmpl" --skip-deps >"$out/bootstrap.yaml"

for file in "$root"/argocd/*.yaml; do
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
    helm template "$name" "${args[@]}" -n "$namespace" >"$out/$name-$i.yaml"
  done
done
