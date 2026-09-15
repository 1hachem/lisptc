# r2mount: mounts the project's Cloudflare R2 bucket under the working tree, so
# agents reach object storage with ordinary file tools.
#
# A devShell cannot mount at boot, so this is an on-demand user FUSE mount.
# Credentials arrive through the environment (`task r2` pipes them in from
# Infisical) and reach rclone as RCLONE_CONFIG_* variables, so they never land
# in an rclone.conf on disk. The endpoint follows the same precedence as
# packages/env/src/r2.ts: R2_ENDPOINT wins, R2_ACCOUNT_ID is the fallback.
{
  lib,
  writeShellApplication,
  rclone,
  fuse3,
  util-linux,
  git,
}:
writeShellApplication {
  name = "r2mount";

  runtimeInputs = [rclone util-linux git];

  text = ''
    # An unprivileged FUSE mount needs the setuid fusermount3, so the wrapper dir
    # leads and plain fuse3 only trails as a non-NixOS fallback.
    export PATH=/run/wrappers/bin:$PATH:${lib.makeBinPath [fuse3]}

    root=$(git rev-parse --show-toplevel)
    mnt="''${R2_MOUNT:-$root/.r2}"
    cache="$root/.r2-cache"

    case "''${1:-mount}" in
      mount) ;;
      umount | unmount)
        if mountpoint -q "$mnt"; then
          fusermount3 -uz "$mnt"
          echo "unmounted $mnt"
        else
          echo "not mounted: $mnt"
        fi
        exit 0
        ;;
      *)
        echo "usage: r2mount [mount|umount]" >&2
        exit 2
        ;;
    esac

    : "''${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}"
    : "''${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}"
    : "''${R2_BUCKET:?set R2_BUCKET}"

    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_R2_ENDPOINT="''${R2_ENDPOINT:-https://''${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID or R2_ENDPOINT}.r2.cloudflarestorage.com}"
    export RCLONE_CONFIG_R2_REGION=auto
    export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

    mkdir -p "$mnt" "$cache"
    if mountpoint -q "$mnt"; then
      echo "already mounted: $mnt"
      exit 0
    fi

    log="$cache/rclone.log"

    # --daemon swallows the reason it failed, so keep one on disk. The daemon also
    # inherits stdio and would hold the caller's pipe open, hence the redirects.
    if ! rclone mount "r2:$R2_BUCKET" "$mnt" \
      --daemon \
      --log-file="$log" \
      --log-level=INFO \
      --cache-dir="$cache" \
      --vfs-cache-mode=full \
      --vfs-cache-max-size=5G \
      --vfs-cache-max-age=24h \
      --vfs-write-back=5s \
      --vfs-fast-fingerprint \
      --dir-cache-time=30s \
      --poll-interval=0 \
      --transfers=8 \
      --links </dev/null >/dev/null 2>&1; then
      echo "mount failed, last lines of $log:" >&2
      tail -n 20 "$log" >&2
      exit 1
    fi
    echo "mounted r2:$R2_BUCKET at $mnt"
  '';
}
