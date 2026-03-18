# Publishing to Obsidian Community Plugins

This guide documents how to publish Note Merger to the official Obsidian community plugins directory.

## Prerequisites

- [ ] GitHub repository is public
- [ ] `README.md` exists with usage instructions
- [ ] `LICENSE` file exists (MIT)
- [ ] `manifest.json` has correct `id`, `name`, `author`, `description`
- [ ] No `console.log` spam in production code
- [ ] API key is stored via `this.loadData()` / `this.saveData()` (never in plaintext files)
- [ ] `isDesktopOnly` is set correctly in manifest

## Step 1: Create a GitHub Release

```bash
# Make sure manifest.json version is correct
# Tag must match the version in manifest.json
git tag 1.0.0
git push origin main
git push origin 1.0.0
```

On GitHub → **Releases** → **Create new release**:
- **Tag**: `1.0.0`
- **Title**: `Note Merger v1.0.0`
- **Attach these files**:
  - `main.js`
  - `manifest.json`
  - `styles.css`

## Step 2: Submit Pull Request

1. Fork [obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
2. Edit `community-plugins.json` — add to the **end** of the array:

```json
{
  "id": "note-merger",
  "name": "Note Merger",
  "author": "bhickta",
  "description": "Merge overlapping notes with AI. Zero information loss.",
  "repo": "bhickta/note-merger"
}
```

3. Commit and create a PR titled: **"Add plugin: Note Merger"**
4. Fill in the PR template checklist

## Step 3: Review

- An automated bot validates your submission first
- The Obsidian team manually reviews your code (1–4 weeks)
- Common rejection reasons:
  - Missing README or LICENSE
  - Using global `app` instance
  - Excessive `console.log` statements
  - Plugin ID containing "obsidian"

## Step 4: After Approval

Once merged, your plugin appears in **Settings → Community Plugins → Browse** for all Obsidian users.

### Releasing Updates

1. Update `version` in both `manifest.json` and `package.json`
2. Update `versions.json` if you change `minAppVersion`
3. Create a new GitHub Release with the new tag
4. Obsidian auto-detects the new release — no PR needed for updates
