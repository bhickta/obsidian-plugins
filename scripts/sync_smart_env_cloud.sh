#!/usr/bin/env bash
set -euo pipefail

ACTION=""
VAULT=""
REMOTE=""
MODE="embeddings"
DELETE=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Sync Smart Connections / Smart Env embedding data through a cloud API using rclone.

Usage:
  ./scripts/sync_smart_env_cloud.sh push --vault /path/to/Vault --remote REMOTE:path [options]
  ./scripts/sync_smart_env_cloud.sh pull --vault /path/to/Vault --remote REMOTE:path [options]

Options:
  --mode MODE       embeddings | all (default: embeddings)
  --delete          mirror deletes too; without this, only copy/update files
  --dry-run         show what would sync without changing destination
  -h, --help        show this help

Examples:
  # Configure once:
  #   rclone config
  #
  # Home/GPU PC uploads cache to Google Drive / OneDrive / S3 / R2 / B2:
  ./scripts/sync_smart_env_cloud.sh push --vault /home/bhickta/development/upsc --remote gdrive:obsidian/upsc --delete

  # Office PC downloads the latest cache later:
  ./scripts/sync_smart_env_cloud.sh pull --vault /home/bhickta/development/upsc --remote gdrive:obsidian/upsc --delete

Notes:
  - The remote path is a folder. The script stores data under REMOTE:path/.smart-env/.
  - Default mode syncs embedding/index state, not event logs.
  - Use the same embedding model on all devices.
USAGE
}

if [[ $# -gt 0 && "$1" != -* ]]; then
  ACTION="$1"
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      [[ $# -ge 2 ]] || { echo "Missing value for --vault" >&2; exit 2; }
      VAULT="$2"
      shift 2
      ;;
    --remote)
      [[ $# -ge 2 ]] || { echo "Missing value for --remote" >&2; exit 2; }
      REMOTE="$2"
      shift 2
      ;;
    --mode)
      [[ $# -ge 2 ]] || { echo "Missing value for --mode" >&2; exit 2; }
      MODE="$2"
      shift 2
      ;;
    --delete)
      DELETE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$ACTION" in
  push|pull) ;;
  *)
    echo "First argument must be push or pull." >&2
    usage >&2
    exit 2
    ;;
esac

case "$MODE" in
  embeddings|all) ;;
  *)
    echo "Invalid mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac

[[ -n "$VAULT" ]] || { echo "Missing --vault /path/to/Vault" >&2; usage >&2; exit 2; }
[[ -n "$REMOTE" ]] || { echo "Missing --remote REMOTE:path" >&2; usage >&2; exit 2; }
command -v rclone >/dev/null 2>&1 || {
  echo "rclone is required. Install it and run: rclone config" >&2
  exit 1
}

LOCAL_ENV="${VAULT%/}/.smart-env"
REMOTE_ENV="${REMOTE%/}/.smart-env"

if [[ "$ACTION" == "push" && ! -d "$LOCAL_ENV" ]]; then
  echo "Local Smart Env folder not found: $LOCAL_ENV" >&2
  exit 1
fi

if [[ "$ACTION" == "pull" ]]; then
  mkdir -p "$LOCAL_ENV"
fi

RCLONE_CMD="copy"
if [[ "$DELETE" -eq 1 ]]; then
  RCLONE_CMD="sync"
fi

RCLONE_ARGS=(--progress --stats-one-line --fast-list)
if [[ "$DRY_RUN" -eq 1 ]]; then
  RCLONE_ARGS+=(--dry-run)
fi

if [[ "$MODE" == "embeddings" ]]; then
  RCLONE_ARGS+=(
    --include "multi/**"
    --include "embedding_models/**"
    --include "ranking_models/**"
    --include "chat_completion_models/**"
    --include "smart_env.json"
    --exclude "**"
  )
else
  RCLONE_ARGS+=(
    --exclude "event_logs/**"
  )
fi

if [[ "$ACTION" == "push" ]]; then
  SRC="$LOCAL_ENV"
  DST="$REMOTE_ENV"
else
  SRC="$REMOTE_ENV"
  DST="$LOCAL_ENV"
fi

echo "Cloud syncing Smart Env ($MODE, $ACTION):"
echo "  from: $SRC"
echo "  to:   $DST"
echo
echo "Close Obsidian or wait until embedding is idle before syncing."
echo

rclone "$RCLONE_CMD" "$SRC" "$DST" "${RCLONE_ARGS[@]}"

echo
echo "Done."
