# Zettel Merge AI

Obsidian plugin for safely merging fragmented Zettelkasten notes with an OpenAI-compatible model endpoint.

The plugin is designed for local-first workflows such as LM Studio / `lms-server`, Ollama OpenAI-compatible servers, llama.cpp server, vLLM, LocalAI, OpenRouter, or OpenAI-compatible remote APIs.

## Workflow

1. Open a note inside the configured Zettelkasten folder.
2. Run **Zettel Merge AI: Suggest merge candidates for active note**.
3. The plugin embeds notes in the configured folder and finds similar candidates.
4. A chat model judges whether each candidate should be merged or skipped.
5. Approved candidates are merged into the active note.
6. Before any visible note is overwritten or deleted, the plugin writes a full archive job under `.zettel-merge-ai/jobs/<job-id>/`.
7. Training records are appended to `.zettel-merge-ai/datasets/`.

## Commands

- **Suggest merge candidates for active note**: embedding search + mergeability judge + review modal.
- **Auto-merge active note with high-confidence candidates**: runs the full pipeline without the review modal when auto-merge is enabled in settings.
- **Clear embedding cache**: forces embeddings to be rebuilt on the next suggestion run.
- **Restore latest applied merge from archive**: restores the latest archived target/source originals.

## Local Server Defaults

Default base URL:

```text
http://127.0.0.1:1234/v1
```

Use any OpenAI-compatible chat and embedding model names exposed by your local server.

The API key can be left empty for local servers that do not require authentication.

## Archive Layout

```text
.zettel-merge-ai/
  index/
    embeddings.json
  jobs/
    index.json
    <job-id>/
      manifest.json
      originals/
      proposed/
      final/
      quality/
      rollback.json
      training/
  datasets/
    sft.jsonl
    judge.jsonl
    preference.jsonl
```

Visible source files can be deleted after a successful merge, but originals remain in the job archive for comparison, training, and rollback.
