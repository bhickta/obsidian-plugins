# Obsidian Plugins

A monorepo for custom [Obsidian](https://obsidian.md) plugins.

## Plugins

| Plugin | Description |
|--------|-------------|
| [note-merger](./note-merger/) | AI-powered note merger with quality judging, self-healing retries, and training data export for fine-tuning smaller models. |
| [obsidian-smart-connections](./obsidian-smart-connections/) | Smart Connections plugin (modified). |
| [obsidian-smart-env](./obsidian-smart-env/) | Smart Environment dependency for Smart Connections. |
| [jsbrains](./jsbrains/) | JS Brains dependency for Smart Connections. |

## Quick Start

### Note Merger

```bash
cd note-merger
npm install
npm run build
```

### Install to a Vault

```bash
./install_plugins.sh /path/to/your/vault
```

## License

See individual plugin directories for license details.
