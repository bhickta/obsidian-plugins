#!/bin/bash

# obsidian-plugins installation script
# Usage: ./install_plugins.sh </path/to/my/obsidian/vault>

set -e

if [ -z "$1" ]; then
    echo "Error: Please provide the path to your Obsidian vault."
    echo "Usage: ./install_plugins.sh /path/to/my/obsidian/vault"
    exit 1
fi

VAULT_PATH=$(realpath "$1")
PLUGINS_DIR="$VAULT_PATH/.obsidian/plugins"

if [ ! -d "$VAULT_PATH" ]; then
    echo "Error: The provided vault path does not exist: $VAULT_PATH"
    exit 1
fi

if [ ! -d "$VAULT_PATH/.obsidian" ]; then
    echo "Warning: Target folder doesn't look like an Obsidian vault (missing .obsidian directory)."
    echo "Creating .obsidian/plugins directory anyway..."
fi

mkdir -p "$PLUGINS_DIR"
echo "Installing plugins to: $PLUGINS_DIR"
echo "------------------------------------------------"

# Get the directory of this script (where the plugin repos are)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"

# Loop through all subdirectories
for dir in "$SCRIPT_DIR"/*/; do
    dir=${dir%*/} # remove trailing slash
    plugin_name=$(basename "$dir")
    
    # Skip if not a directory or if it doesn't have a manifest.json
    if [ ! -f "$dir/manifest.json" ]; then
        continue
    fi
    
    echo "Processing plugin: $plugin_name"
    
    # Check what we need to build / where the built files are
    MAIN_JS=""
    STYLES_CSS=""
    
    # Build if package.json exists
    if [ -f "$dir/package.json" ]; then
        echo "  - Building..."
        cd "$dir"
        if [ ! -d "node_modules" ]; then
            npm install || echo "  - Warning: npm install failed"
        fi
        npm run build || echo "  - Warning: npm run build failed"
        cd "$SCRIPT_DIR"
    fi

    # Find built main.js
    if [ -f "$dir/dist/main.js" ]; then
        MAIN_JS="$dir/dist/main.js"
    elif [ -f "$dir/main.js" ]; then
        MAIN_JS="$dir/main.js"
    fi
    
    if [ -f "$dir/styles.css" ]; then
        STYLES_CSS="$dir/styles.css"
    elif [ -f "$dir/dist/styles.css" ]; then
        STYLES_CSS="$dir/dist/styles.css"
    fi
    
    # Determine the actual plugin ID from manifest
    PLUGIN_ID=$(grep -m 1 '"id"' "$dir/manifest.json" | sed 's/.*"id": "\(.*\)".*/\1/' | tr -d ',"' | xargs)
    if [ -z "$PLUGIN_ID" ]; then
        PLUGIN_ID="$plugin_name"
    fi
    
    TARGET_DIR="$PLUGINS_DIR/$PLUGIN_ID"
    
    if [ -n "$MAIN_JS" ]; then
        echo "  - Installing to $TARGET_DIR"
        mkdir -p "$TARGET_DIR"
        cp "$dir/manifest.json" "$TARGET_DIR/manifest.json"
        cp "$MAIN_JS" "$TARGET_DIR/main.js"
        if [ -n "$STYLES_CSS" ]; then
            cp "$STYLES_CSS" "$TARGET_DIR/styles.css"
        fi
        echo "  - Success!"
    else
        echo "  - Failed: Could not find or build main.js for $plugin_name"
    fi
    echo "------------------------------------------------"
done

echo "Done! Restart Obsidian or reload the plugins in community plugins settings."
