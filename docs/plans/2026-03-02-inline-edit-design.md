# Inline Edit for History Entries

## Problem

After transcription (raw or post-processed), there is no way to fix the text directly in Handy. Users must paste into a separate text editor to make corrections, breaking the workflow.

## Solution

Add inline edit capability to history entries. Both raw transcription and post-processed text are editable. Manual edits are versioned so they can be undone via the existing version history timeline.

## Frontend UX

- Edit button (pencil icon) added to the history entry action bar, between post-process and copy buttons
- Matches existing icon button style: `text-text/50 hover:text-logo-primary transition-colors cursor-pointer`, lucide-react icon at 16x16
- Clicking edit swaps the `<p>` text display to a `<textarea>` pre-filled with the currently displayed text (raw or enhanced, whichever is showing)
- Save (`<Button variant="primary" size="sm">`) and Cancel (`<Button variant="secondary" size="sm">`) buttons appear below
- Keyboard: `Escape` cancels, `Ctrl+Enter` saves
- Other action buttons disabled while editing to prevent conflicts
- No feature gate required — editing is basic CRUD

## Backend

### New migration (M7)

```sql
ALTER TABLE transcription_versions ADD COLUMN target TEXT NOT NULL DEFAULT 'post_processed';
```

The default ensures existing version rows are correctly tagged without backfilling. Values: `"post_processed"`, `"transcription"`.

### New HistoryManager method

`update_entry_text(&self, id: i64, field: &str, new_text: &str) -> Result<()>`

- Inserts a version record: `model_name = "Manual edit"`, `prompt = None`, `target = field`
- Updates the appropriate column (`transcription_text` or `post_processed_text`)
- Both operations in a single transaction
- Emits `history-updated`

### New Tauri command

`update_history_entry_text(id: i64, field: String, new_text: String) -> Result<(), String>`

- `field` is `"transcription"` or `"post_processed"`
- No feature gate
- Calls `HistoryManager::update_entry_text`

## Version History Display

- Versions with `model_name == "Manual edit"` show a pencil icon chip instead of a model name chip
- Versions with `target == "transcription"` labeled "Transcription edit" to distinguish from post-process edits
- `restore_version` checks the `target` field to write back to the correct column

## Data Flow

```
User clicks edit → textarea with current displayText
User edits → local state only
Save → updateHistoryEntryText(id, field, newText)
     → INSERT transcription_versions (text, target, model_name="Manual edit")
     → UPDATE transcription_history (correct column)
     → emit "history-updated"
     → frontend reloads, textarea closes
Cancel/Escape → discard, close textarea
```

## i18n Keys (settings.history)

- `editTranscription`: "Edit transcription"
- `editSaved`: "Edit saved"
- `manualEdit`: "Manual edit"
- `transcriptionEdit`: "Transcription edit"

## Scope

- 1 new DB migration (add `target` column)
- 1 new Rust method on HistoryManager
- 1 new Tauri command
- Frontend edits to HistoryEntryComponent (edit state + textarea) and VersionCard (manual edit labels)
- 4 new i18n keys
- No new files, no new components, no feature gates
