# Home/Office Obsidian Plugin Workflow

This repo currently supports two plugins for the UPSC vault:

- `smart-connections`: indexes notes, shows related notes, embeds the vault, and exposes the bridge API used by Note Merger.
- `note-merger`: imports visible Smart Connections results and merges selected notes.

## Git State Before Moving To Another PC

Commit source files, not generated plugin bundles.

```bash
cd /home/bhickta/development/obsidian-plugins

git add .gitignore \
  note-merger/src/ui/merge-queue-view.ts \
  obsidian-smart-connections/src/main.js \
  obsidian-smart-connections/src/views/settings_tab.js \
  obsidian-smart-connections/src/utils/embedding_cache_sync.js \
  obsidian-smart-connections/src/utils/smart_connections_api.js \
  scripts/install_plugins.sh \
  scripts/sync_smart_env.sh \
  scripts/sync_smart_env_cloud.sh \
  install_plugins.sh \
  docs/home-office-workflow.md

git commit -m "Add Smart Connections bridge and embedding cache sync"
git push
```

Do not commit these generated or local files:

- `note-merger/main.js`
- `obsidian-smart-connections/dist/`
- plugin `data.json`
- `.smart-env/`

## Script Layout

Canonical scripts live in `scripts/`.

The root `install_plugins.sh` is kept only as a compatibility wrapper because it existed before this cleanup:

```bash
./install_plugins.sh
```

Prefer the canonical paths in docs and automation:

```bash
./scripts/install_plugins.sh
./scripts/sync_smart_env.sh
./scripts/sync_smart_env_cloud.sh
```

## What Each Shell Script Does

### `scripts/install_plugins.sh`

Builds and installs local plugin builds into one or more Obsidian vaults.

Use it after `git pull` or after making plugin changes.

```bash
./scripts/install_plugins.sh --plugin all /path/to/Vault
./scripts/install_plugins.sh --plugin smart-connections /path/to/Vault
./scripts/install_plugins.sh --plugin note-merger /path/to/Vault
```

Useful flags:

- `--plugin all|note-merger|smart-connections`: choose what to install.
- `--no-build`: copy existing build output without running `npm run build`.
- `--hotreload`: create `.hotreload` in the installed plugin folder.

It copies plugin files into:

```text
/path/to/Vault/.obsidian/plugins/<plugin-id>/
```

### `scripts/sync_smart_env.sh`

Uses `rsync` to copy `.smart-env` between two reachable paths.

Use this when both endpoints are local, mounted, or reachable by SSH. This is not a cloud API tool.

```bash
./scripts/sync_smart_env.sh --from /home/bhickta/development/upsc --to /mnt/backup/upsc --delete
./scripts/sync_smart_env.sh --from /home/bhickta/development/upsc --to office:/home/bhickta/development/upsc --delete
```

Default mode is `embeddings`, which copies:

- `.smart-env/multi/`
- `.smart-env/embedding_models/`
- `.smart-env/ranking_models/`
- `.smart-env/chat_completion_models/`
- `.smart-env/smart_env.json`

It skips `event_logs`.

Useful flags:

- `--mode embeddings`: sync only embedding/index state.
- `--mode all`: sync most Smart Env data except event logs.
- `--delete`: remove target files that no longer exist in source.
- `--dry-run`: preview changes.

### `scripts/sync_smart_env_cloud.sh`

Uses `rclone` to push or pull `.smart-env` through cloud APIs such as Google Drive, Dropbox, OneDrive, S3, R2, or B2.

Use this when the home PC cannot stay online and you do not want direct machine-to-machine sync.

Configure once:

```bash
rclone config
```

Home/GPU PC pushes:

```bash
./scripts/sync_smart_env_cloud.sh push \
  --vault /home/bhickta/development/upsc \
  --remote gdrive:obsidian/upsc \
  --delete
```

Office PC pulls:

```bash
./scripts/sync_smart_env_cloud.sh pull \
  --vault /home/bhickta/development/upsc \
  --remote gdrive:obsidian/upsc \
  --delete
```

Default mode is also `embeddings`.

## Recommended Cache Sync Method

Prefer the built-in Smart Connections setting for normal use:

```text
Smart Connections Settings -> Embedding Cache Sync
```

It stores the device role locally, so pulling cache on the office PC does not overwrite the office PC role.

The built-in sync uses this structure inside the selected sync folder:

```text
smart-connections-cache/
  manifest.json
  smart-env/
    multi/
    embedding_models/
    ranking_models/
    chat_completion_models/
    smart_env.json
```

Use the shell scripts only when you want command-line control or cloud API sync through `rclone`.

## Faster Embedding On RTX 3090

Local Transformers embedding now uses automatic batching:

- GPU/WebGPU auto batch: `32`
- CPU/WASM auto batch: `8`
- Legacy `batch_size` value `1` is treated as auto.

For an RTX 3090, start with auto. If it is stable and GPU memory is not close to full, edit the active embedding model and set:

```text
Embedding batch size: 64
```

If WebGPU resets, Obsidian freezes, or batch embedding falls back to individual items, reduce it:

```text
Embedding batch size: 16
```

Changing batch size does not change embedding quality. It only changes how many notes/blocks are sent to the local model at once.

Watch GPU use while embedding:

```bash
watch -n 1 nvidia-smi
```

## Home/GPU PC Setup

1. Pull or keep the latest code.
2. Install plugins into the UPSC vault:

```bash
cd /home/bhickta/development/obsidian-plugins
./scripts/install_plugins.sh --plugin all /home/bhickta/development/upsc
```

3. Open Obsidian and reload both plugins.
4. Open Smart Connections settings.
5. In `Embedding Cache Sync`, set:

```text
This device: Source device (pushes cache)
Sync folder: <your Dropbox/Google Drive/OneDrive local folder>
Device label: Home GPU PC
```

6. Let Smart Connections finish embedding.
7. Run command:

```text
Embedding Cache Sync: Push cache
```

8. Wait for the cloud folder to finish uploading.

## Office PC Setup

1. Pull latest plugin code:

```bash
cd /home/bhickta/development/obsidian-plugins
git pull
```

2. Install plugins into the office UPSC vault:

```bash
./scripts/install_plugins.sh --plugin all /path/to/office/upsc
```

3. Open Obsidian and reload both plugins.
4. Open Smart Connections settings.
5. In `Embedding Cache Sync`, set:

```text
This device: Replica device (pulls cache)
Sync folder: <same cloud folder path on office PC>
Pull on startup: enabled
Keep backup before pull: enabled
Reload after manual pull: enabled
```

6. Run once:

```text
Embedding Cache Sync: Pull cache
```

7. Smart Connections reloads and uses the pulled cache.

## Note Merger + Smart Connections Workflow

The current integration is direct. Note Merger no longer scrapes Smart Connections HTML.

Smart Connections exposes:

```text
plugin.api.getVisibleConnectionPaths({ include_hidden: false })
```

Note Merger uses that bridge only.

Workflow:

1. Open a target note.
2. Open the Smart Connections panel.
3. Let Smart Connections show related notes.
4. Open Note Merger's Merge Queue.
5. Click `Import from Smart Connections`.
6. Select notes to merge.
7. Run `Merge All into Active Note`.

If the bridge is not available, Note Merger shows:

```text
Smart Connections bridge API not available. Update and enable Smart Connections.
```
