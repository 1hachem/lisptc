#!/usr/bin/env bash
set -euo pipefail

action="${1:-pull}"
local_dir="${2:-.r2}"

: "${R2_BUCKET:?comes from infisical /assets — run this through a task}"
: "${R2_ACCESS_KEY_ID:?comes from infisical /assets — run this through a task}"
: "${R2_SECRET_ACCESS_KEY:?comes from infisical /assets — run this through a task}"

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID or R2_ENDPOINT}.r2.cloudflarestorage.com}"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

mkdir -p "$local_dir"

case "$action" in
pull) rclone copy "r2:$R2_BUCKET" "$local_dir" --progress ;;
push) rclone copy "$local_dir" "r2:$R2_BUCKET" --progress ;;
sync) rclone sync "r2:$R2_BUCKET" "$local_dir" --progress ;;
*)
	echo "usage: r2-sync.sh [pull|push|sync] [dir]" >&2
	exit 2
	;;
esac
