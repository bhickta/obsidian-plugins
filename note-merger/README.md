# Note Merger — Obsidian Plugin

Merge overlapping Obsidian notes using AI with **zero information loss**.

Built for users with large vaults (10,000+ notes) where the same topic is spread across multiple files. Note Merger uses Google Gemini to intelligently combine notes while preserving every fact, date, figure, and named entity.

## Features

- **Zero-Loss Merge** — Every bullet point, date, and named entity from all source notes is preserved
- **AI Judge** — A separate Gemini model automatically verifies the merge quality and flags missing information  
- **Self-Healing Retries** — If the Judge finds issues, the merger automatically retries with targeted corrections (up to 3 attempts)
- **Auto-Rename** — AI suggests a descriptive filename after each merge
- **3-Pane Review Modal** — Side-by-side view of Source A, Source B, and the editable merged output
- **Training Dataset** — Every approved/rejected merge is logged to JSONL for future model fine-tuning
- **Fully Configurable** — Models, prompts, retry count, thresholds — everything is editable in settings

## Setup

1. Install the plugin (Community Plugins → Browse → "Note Merger", or drop `main.js`, `manifest.json`, `styles.css` into `.obsidian/plugins/note-merger/`)
2. Go to **Settings → Note Merger**
3. Enter your [Google Gemini API Key](https://aistudio.google.com/apikey)
4. (Optional) Adjust the merger/judge models and system prompts

## Usage

### Merge Two Notes
1. Open a note (this becomes the "target")
2. In the File Explorer, right-click another note → **"Merge into current note"**

### Merge Multiple Notes
1. Select 2+ markdown files in the File Explorer
2. Right-click → **"Merge N selected files"**
3. Choose which file should be the "master" (target)

### Review Modal
After the merge completes, a review modal shows:
- **Left pane**: Source A (original notes)
- **Center pane**: Source B (target note)
- **Right pane**: Editable merged output
- **Score badge**: PASS/FAIL with the judge's rating
- **Missing facts**: Red pills showing any dropped information

Click **Approve & Save** to write the merged content and optionally rename the file.

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Gemini API Key | Your Google AI API key | — |
| Merger Model | Model for merging | `gemini-2.5-flash-lite-latest` |
| Judge Model | Model for quality evaluation | `gemini-2.5-flash-latest` |
| Enable Judge | Toggle the quality check | `true` |
| Max Retries | Auto-retry failed merges | `3` |
| Auto-Approve Threshold | Score cutoff for PASS | `0.92` |
| Auto-Rename | Suggest filename after merge | `true` |
| Delete Sources | Remove original files after merge | `false` |
| Merger/Judge Prompts | Editable system instructions | (built-in defaults) |

## Training Data

Approved merges are saved to `_training/dataset.jsonl` with full source/output pairs, judge scores, and metadata. This data can be used to fine-tune a model for your specific note style.

## Requirements

- Obsidian v1.4.0+
- A Google Gemini API key ([get one free](https://aistudio.google.com/apikey))
- Desktop only (uses Node.js APIs)

## License

MIT — see [LICENSE](LICENSE)
