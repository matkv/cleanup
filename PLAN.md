# Obsidian Vault Cleaner — Project Plan

## Overview

A local web app to help migrate ~450 notes from an old Obsidian vault structure to a new one with updated templates. The user manually reviews each old file, picks a note type, edits content into the new template, and saves. The app tracks progress and provides a smooth, keyboard-driven workflow.

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** Plain HTML/CSS/JS (no build step, no bundler)
- **Markdown editors:** CodeMirror 6 (loaded via CDN)
- **State:** `progress.json` (flat file, lives next to `server.js`)
- **Config:** `config.json` (flat file, lives next to `server.js`)

## Project Structure

```
obsidian-cleaner/
  server.js
  progress.json       ← auto-created on first run
  config.json         ← auto-created on first run / config screen
  public/
    index.html
    app.js
    style.css
```

## Configuration

On first launch (or if `config.json` is missing), show a config screen where the user sets:

- **Old vault path** — path to the temporary subfolder containing the old files
- **New vault path** — path to the destination folder for new files
- **Templates path** — path to the folder containing the template `.md` files

Config is saved to `config.json` and can be edited later via a settings button.

Example `config.json`:
```json
{
  "oldVaultPath": "C:/Users/user/Obsidian/Vault/Archive",
  "newVaultPath": "C:/Users/user/Obsidian/Vault",
  "templatesPath": "C:/Users/user/Obsidian/Vault/Templates"
}
```

## Progress Tracking

`progress.json` maps relative file paths (relative to oldVaultPath) to their status:

```json
{
  "subfolder/some-note.md": "done",
  "another-note.md": "skipped",
  "old-entry.md": "ignored"
}
```

Statuses:
- `"done"` — handled, new file written
- `"skipped"` — come back to it later
- `"ignored"` — don't need this file at all

Files with no entry are considered unhandled.

## Templates

Templates live in the configured templates folder. The app scans this folder on startup and lists all `.md` files as available types.

### Variable Substitution

The Journal template uses date placeholders. The backend must substitute these when loading a template:

- `{{date}}` → today's date in `YYYY-MM-DD` format
- `{{date: dddd, DD. MMMM YYYY}}` → today's date formatted as e.g. `Thursday, 30. April 2025`

Use a simple regex replace on the template content. Use the `dayjs` library (or native `Intl`) for date formatting.

Known templates (but app should work with any `.md` files in the templates folder):

**Book Template.md**
```markdown
---
index: "[[Books]]"
title:
author:
status:
  - To-Read
  - Finished
year: 
rating:
date:
---
```

**Default Template.md**
```markdown
---
description:
tags:
---
```

**Journal Template.md**
```markdown
---
index: "[[Database/Index/Journal|Journal]]"
date: {{date}}
workout: false
reading: false
---
# {{date: dddd, DD. MMMM YYYY}}
```

## API Endpoints

### `GET /api/config`
Returns current config or `null` if not set.

### `POST /api/config`
Saves config. Validates that all paths exist on disk.

### `GET /api/files`
Returns the full list of files from oldVaultPath (recursive), with their progress status.

Response:
```json
[
  { "path": "subfolder/note.md", "status": "done" },
  { "path": "another.md", "status": null }
]
```

### `GET /api/files/next`
Returns the next unhandled file (status is null or "skipped"). Prefer null over skipped (i.e. go through all unhandled first, then skipped). Returns `null` if everything is done.

### `GET /api/file?path=relative/path.md`
Returns the raw content of a file from the old vault.

### `GET /api/templates`
Returns list of available templates:
```json
[
  { "name": "Book Template", "filename": "Book Template.md" },
  { "name": "Default Template", "filename": "Default Template.md" },
  { "name": "Journal Template", "filename": "Journal Template.md" }
]
```

### `GET /api/template?name=Journal Template.md`
Returns the template content with date variables substituted.

### `POST /api/save`
Writes the new file and marks the old one as done.

Body:
```json
{
  "oldPath": "relative/path.md",
  "newFilename": "my-new-note.md",
  "newSubfolder": "",
  "content": "--- \n..."
}
```

The new file is written to `newVaultPath/newSubfolder/newFilename`. Creates subfolders as needed. Marks `oldPath` as `"done"` in progress.json.

### `POST /api/status`
Updates a file's status without saving a new file (for skip/ignore).

Body:
```json
{
  "path": "relative/path.md",
  "status": "skipped"
}
```

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Obsidian Cleaner        [⚙ Settings]          42 / 450 done   │
├──────────────────────────────┬──────────────────────────────────┤
│  OLD FILE                    │  NEW FILE                        │
│  path/to/old-note.md         │  [Type dropdown ▾] [New filename]│
│                              │                                  │
│  [CodeMirror editor]         │  [CodeMirror editor]             │
│  (read-only or editable)     │  (editable)                      │
│                              │                                  │
│                              │                                  │
├──────────────────────────────┴──────────────────────────────────┤
│  [Skip]  [Ignore]                              [Save & Next →]  │
│                                                                  │
│  Progress: ████████░░░░░░░░░░░░  42 done · 8 skipped · 400 left│
└─────────────────────────────────────────────────────────────────┘
```

### UI Behaviour

- On load, fetch `/api/files/next` and load the old file into the left editor
- Left editor is **read-only** (easier to copy from, no accidental edits)
- Type dropdown populated from `/api/templates`
- Selecting a type fetches the template and populates the right editor
- New filename field defaults to the old filename (without path), user can change it
- Optionally a subfolder field so the user can place the new file into a subdirectory of the new vault
- **Save & Next:** calls `/api/save`, then auto-loads next file
- **Skip:** calls `/api/status` with `skipped`, loads next file
- **Ignore:** calls `/api/status` with `ignored`, loads next file
- After Save, the right editor clears and the type dropdown resets (ready for next file)

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Save & Next |
| `Ctrl+S` | Save & Next (alias) |
| `Ctrl+→` | Skip |
| `Ctrl+D` | Ignore |
| `Ctrl+1/2/3...` | Select template type by index |

### File List Sidebar (optional, implement last)

A collapsible sidebar showing all files with colour-coded status (done = green, skipped = yellow, ignored = grey, pending = white). Clicking a file loads it directly.

## Notes & Edge Cases

- Paths on Windows should work with both `/` and `\` separators — normalise on the backend
- If `newVaultPath` and `oldVaultPath` overlap (they might since old is a subfolder of new), be careful not to include old vault files when scanning the new vault. The scan should only read from `oldVaultPath`.
- If a file with the same name already exists in the new vault, warn the user but don't block (let them rename)
- The app runs locally, no auth needed
- Default port: `3000`
- The left (old) editor should support horizontal scrolling for wide content — don't wrap long lines by default

## Getting Started (for Claude Code)

1. `npm init -y`
2. `npm install express`
3. Optionally `npm install dayjs` for date formatting
4. CodeMirror 6 loaded via CDN in `index.html`
5. Run with `node server.js`
6. Open `http://localhost:3000`

Start with the backend API and a basic working UI, then polish the UX (keyboard shortcuts, progress bar, sidebar).
