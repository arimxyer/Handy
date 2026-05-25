# Post-Process Button for History Items

**Discussion:** [#826](https://github.com/cjpais/Handy/discussions/826)
**Date:** 2026-02-18

## Summary

Add a post-process button to each history entry in the History tab, allowing users to enhance past transcriptions with their configured LLM provider after the fact. Includes version history to track each post-processing run.

## Core Behavior

When a user clicks the post-process button (sparkle/wand icon) on any history entry:

1. The button swaps to a loading spinner, disabled
2. The app takes the entry's `transcription_text` (always the raw ASR output) and sends it to the currently configured LLM provider/model/prompt from the user's post-processing settings
3. On success, a new version is saved to the `transcription_versions` table and `post_processed_text` is updated on the history entry
4. The UI refreshes to show the enhanced text, with a toggle to view the original
5. On failure (network error, no provider configured, etc.), show an error toast and restore the button

Re-processing always runs against the **raw** `transcription_text`, not any previous enhanced version. The original is never lost.

The button is always visible on history entries (regardless of whether already post-processed), as long as the feature is enabled.

## Feature Gating (Three-Level)

1. `experimental_enabled` must be on — shows the Experimental section in Advanced settings
2. `post_process_enabled` must be on — enables post-processing generally
3. `history_post_process_enabled` (new) must be on — enables the button on history entries

The new toggle only appears in the Experimental section when `post_process_enabled` is already true.

## UI Changes

### History Entry Component

**Post-process button:**

- Sparkle/wand icon button added to the existing action button row (alongside copy, star, delete)
- When processing: swaps to a spinner, other action buttons remain functional
- If post-processing is not configured (no provider/API key/prompt), button is disabled with tooltip "Set up post-processing in settings first"
- Only rendered when all three feature gates are enabled

**Before/after toggle:**

- Only appears on entries where `post_processed_text` is not null
- Small text link below the transcription text: "Show original" / "Show enhanced"
- Default view is the enhanced text when available
- The copy button copies whichever version is currently displayed

### Advanced Settings — Experimental Section

New `HistoryPostProcessToggle` component:

- Follows existing `ToggleSwitch` pattern
- Conditionally rendered when `post_process_enabled` is true
- Label: "Post-process History"
- Description: "Add a button to enhance past transcriptions from the History tab"

## Backend Changes

### New Database Migration (Migration 4)

```sql
CREATE TABLE transcription_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_entry_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    prompt TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (history_entry_id) REFERENCES transcription_history(id) ON DELETE CASCADE
);
```

### New HistoryManager Methods

- `update_post_processed_text(id, text, prompt)` — Updates `post_processed_text` and `post_process_prompt` on the history entry
- `save_version(entry_id, text, prompt)` — Inserts a row into `transcription_versions`
- `get_versions(entry_id)` — Returns all versions for a history entry, ordered by timestamp

### New Tauri Commands

- `post_process_history_entry(id: i64) -> Result<String, String>` — Fetches entry, runs `post_process_transcription()` with current settings, saves version, updates entry, emits `"history-updated"` event
- `change_history_post_process_enabled_setting(enabled: bool) -> Result<(), String>` — Toggles the new setting (lives in `commands/history.rs`)
- `get_transcription_versions(entry_id: i64) -> Result<Vec<TranscriptionVersion>, String>` — Returns version history for an entry

### New Setting

- `history_post_process_enabled: bool` (default: `false`) added to `AppSettings` in `settings.rs`

### Key Implementation Note

`post_process_transcription()` in `actions.rs` is already decoupled from the recording flow — it only needs `&AppSettings` and `&str`. It can be called directly from the new command with no refactoring needed.

## Error Handling

- **No provider/API key configured:** Toast error "Post-processing provider not configured", button restored
- **API failure (network, rate limit, bad key):** Toast with error message, button restored, entry unchanged
- **Empty transcription text:** Button disabled on that entry
- **Concurrent processing:** Allowed — each entry's loading state is independent

## Files to Modify

**Rust (backend):**

- `src-tauri/src/settings.rs` — Add `history_post_process_enabled` field
- `src-tauri/src/managers/history.rs` — Add migration, update methods, version methods
- `src-tauri/src/commands/history.rs` — Add new commands
- `src-tauri/src/lib.rs` — Register new commands

**TypeScript (frontend):**

- `src/bindings.ts` — Will be auto-generated by tauri-specta
- `src/stores/settingsStore.ts` — Add updater for new setting
- `src/components/settings/history/HistorySettings.tsx` — Add post-process button, toggle, version display
- `src/components/settings/advanced/AdvancedSettings.tsx` — Add new toggle to Experimental section
- New: `src/components/settings/HistoryPostProcessToggle.tsx` — Toggle component
- `src/i18n/locales/en/translation.json` — Add translation keys
- `src/i18n/locales/es/translation.json` — Add translation keys (or leave for follow-up)
- `src/i18n/locales/fr/translation.json` — Add translation keys (or leave for follow-up)
- `src/i18n/locales/vi/translation.json` — Add translation keys (or leave for follow-up)

## Future Work (Out of Scope)

These ideas were discussed during brainstorming and are natural follow-ups:

- Model comparison — run different models on the same transcription
- Thumbs up/down feedback on post-processing results
- Prompt auto-tuning — analyze raw transcription history to find speech patterns and adjust prompts
- Memory layer — liked results inform future post-processing behavior
