#!/usr/bin/env bash
set -euo pipefail

MODE="embeddings"
DRY_RUN=0
DELETE=0
FROM=""
TO=""

usage() {
  cat <<'USAGE'
Sync Smart Connections / Smart Env embedding data between vaults.

Usage:
  ./scripts/sync_smart_env.sh --from SOURCE_VAULT --to TARGET_VAULT [options]

Options:
  --mode MODE       embeddings | all (default: embeddings)
  --delete          delete target files that no longer exist in source
  --dry-run         show what would sync without changing target
  -h, --help        show this help

SOURCE_VAULT and TARGET_VAULT may be local paths or rsync SSH paths.
Pass the vault path, not the .smart-env path. If you pass .smart-env directly,
the script will use it as-is.

Examples:
  # Home/GPU PC -> cloud/mounted relay folder
  ./scripts/sync_smart_env.sh --from /home/bhickta/development/upsc --to "$HOME/Sync/upsc-smart-env-cache" --delete

  # Office PC pulls from cloud/mounted relay folder
  ./scripts/sync_smart_env.sh --from "$HOME/Sync/upsc-smart-env-cache" --to /home/bhickta/development/upsc --delete

  # Direct sync still works when both machines are online
  ./scripts/sync_smart_env.sh --from /home/bhickta/development/upsc --to office:/home/bhickta/development/upsc --delete

  # Local backup
  ./scripts/sync_smart_env.sh --from /home/bhickta/development/upsc --to /mnt/backup/upsc --dry-run
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      [[ $# -ge 2 ]] || { echo "Missing value for --from" >&2; exit 2; }
      FROM="$2"
      shift 2
      ;;
    --to)
      [[ $# -ge 2 ]] || { echo "Missing value for --to" >&2; exit 2; }
      TO="$2"
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

case "$MODE" in
  embeddings|all) ;;
  *)
    echo "Invalid mode: $MODE" >&2
    usage >&2
    exit 2
    ;;
esac

[[ -n "$FROM" ]] || { echo "Missing --from SOURCE_VAULT" >&2; usage >&2; exit 2; }
[[ -n "$TO" ]] || { echo "Missing --to TARGET_VAULT" >&2; usage >&2; exit 2; }
command -v rsync >/dev/null 2>&1 || { echo "rsync is required." >&2; exit 1; }

is_remote() {
  [[ "$1" == *:* && "$1" != /* ]]
}

smart_env_path() {
  local endpoint="${1%/}"
  if [[ "$endpoint" == */.smart-env ]]; then
    printf '%s/' "$endpoint"
  else
    printf '%s/.smart-env/' "$endpoint"
  fi
}

strip_trailing_slash() {
  local value="${1%/}"
  printf '%s' "$value"
}

SRC="$(smart_env_path "$FROM")"
DST="$(smart_env_path "$TO")"

if ! is_remote "$SRC"; then
  [[ -d "$(strip_trailing_slash "$SRC")" ]] || {
    echo "Source Smart Env folder not found: $(strip_trailing_slash "$SRC")" >&2
    exit 1
  }
fi

if ! is_remote "$DST"; then
  mkdir -p "$(strip_trailing_slash "$DST")"
fi

RSYNC_ARGS=(-az --human-readable --info=stats2,progress2)

if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_ARGS+=(--dry-run)
fi

if [[ "$DELETE" -eq 1 ]]; then
  RSYNC_ARGS+=(--delete)
fi

if [[ "$MODE" == "embeddings" ]]; then
  RSYNC_ARGS+=(
    --include='/multi/***'
    --include='/embedding_models/***'
    --include='/ranking_models/***'
    --include='/chat_completion_models/***'
    --include='/smart_env.json'
    --exclude='*'
  )
else
  RSYNC_ARGS+=(
    --exclude='/event_logs/***'
  )
fi

echo "Syncing Smart Env ($MODE):"
echo "  from: $SRC"
echo "  to:   $DST"
echo
echo "Close Obsidian or wait until embedding is idle before syncing."
echo

rsync "${RSYNC_ARGS[@]}" "$SRC" "$DST"

echo
echo "Done."
