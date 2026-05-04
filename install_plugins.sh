#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD=1
HOTRELOAD=0
PLUGIN="all"
VAULTS=()

usage() {
  cat <<'USAGE'
Install local Obsidian plugins into one or more vaults.

Usage:
  ./install_plugins.sh [options] /path/to/Vault [...]

Options:
  --plugin NAME     all | note-merger | smart-connections (default: all)
  --no-build        copy existing build outputs without running npm build
  --hotreload       create .hotreload in each installed plugin folder
  -h, --help        show this help

Examples:
  ./install_plugins.sh "$HOME/Documents/My Vault"
  ./install_plugins.sh --plugin note-merger --hotreload "$HOME/Vaults/UPSC"
  ./install_plugins.sh --no-build "$HOME/Vault A" "$HOME/Vault B"
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugin)
      [[ $# -ge 2 ]] || { echo "Missing value for --plugin" >&2; exit 2; }
      PLUGIN="$2"
      shift 2
      ;;
    --no-build)
      BUILD=0
      shift
      ;;
    --hotreload)
      HOTRELOAD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do VAULTS+=("$1"); shift; done
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      VAULTS+=("$1")
      shift
      ;;
  esac
done

case "$PLUGIN" in
  all|note-merger|smart-connections) ;;
  *)
    echo "Invalid plugin: $PLUGIN" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ${#VAULTS[@]} -eq 0 ]]; then
  echo "No vault path provided." >&2
  usage >&2
  exit 2
fi

build_plugin() {
  local dir="$1"
  echo "Building $dir..."
  (cd "$ROOT_DIR/$dir" && npm run build)
}

copy_plugin() {
  local vault="$1"
  local plugin_id="$2"
  local source_dir="$3"
  local dest_dir="$vault/.obsidian/plugins/$plugin_id"

  [[ -d "$vault" ]] || { echo "Vault not found: $vault" >&2; exit 1; }
  mkdir -p "$dest_dir"

  for file in main.js manifest.json styles.css; do
    [[ -f "$source_dir/$file" ]] || {
      echo "Missing build file: $source_dir/$file" >&2
      echo "Run without --no-build, or build the plugin first." >&2
      exit 1
    }
    cp "$source_dir/$file" "$dest_dir/$file"
  done

  if [[ "$HOTRELOAD" -eq 1 ]]; then
    : > "$dest_dir/.hotreload"
  fi

  echo "Installed $plugin_id -> $dest_dir"
}

if [[ "$BUILD" -eq 1 ]]; then
  if [[ "$PLUGIN" == "all" || "$PLUGIN" == "note-merger" ]]; then
    build_plugin "note-merger"
  fi
  if [[ "$PLUGIN" == "all" || "$PLUGIN" == "smart-connections" ]]; then
    build_plugin "obsidian-smart-connections"
  fi
fi

for vault in "${VAULTS[@]}"; do
  if [[ "$PLUGIN" == "all" || "$PLUGIN" == "note-merger" ]]; then
    copy_plugin "$vault" "note-merger" "$ROOT_DIR/note-merger"
  fi
  if [[ "$PLUGIN" == "all" || "$PLUGIN" == "smart-connections" ]]; then
    copy_plugin "$vault" "smart-connections" "$ROOT_DIR/obsidian-smart-connections/dist"
  fi
done

echo "Done. Enable or reload the plugin(s) in Obsidian."
