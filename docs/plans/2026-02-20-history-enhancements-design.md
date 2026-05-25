# History Enhancements Design

**Date:** 2026-02-20
**Base:** PR #851 (history post-process button + version history viewer)
**Scope:** Single PR covering all four features

## Features

### Feature 1: Post-Process Drawer

A slide-in right panel in the History tab for quick model/prompt switching without navigating to the Post-Process settings tab.

**Behavior:**

- Activated via a "Post-Process Config" button in the History tab header
- Slides in from the right, overlaying the history list partially
- Changes are temporary overrides by default (session-scoped)
- "Save as Default" toggle persists changes to global settings
- Reuses existing provider/model/prompt components from PostProcessingSettings

**Drawer contents (top to bottom):**

1. Provider dropdown (reuses `ProviderSelect`)
2. API Key input
3. Model selector (reuses `ModelSelect` with `isCreatable`)
4. Prompt selector dropdown
5. Prompt textarea for on-the-fly editing (+ New button)
6. Save as Default toggle
7. Compare Models section (see Feature 4)

**State management:**

- New `usePostProcessDrawer` hook wrapping existing settings
- Temporary state stored in Zustand (not persisted until "Save as Default" toggled)
- Drawer open/close state is local component state

### Feature 2: Insights Tab

A separate top-level settings tab that analyzes transcription history and provides speech pattern insights with prompt improvement suggestions.

**Location:** New entry in the sidebar navigation, below History.

**API Configuration:**

- Separate provider/model/key settings from post-process (stored as `insights_provider_id`, `insights_model_id`, etc.)
- Allows using a different (potentially more capable) model for analysis

**Analysis scope:**

- Configurable: "Last N entries" slider (default: 50) or "All history" toggle
- Analyzes `transcription_text` (original speech) for patterns

**Report sections:**

1. Speech patterns summary (filler words, sentence structure tendencies)
2. Common topics/vocabulary
3. Prompt improvement suggestions based on observed patterns

**Action buttons on each suggestion:**

- "Improve Current Prompt" - applies suggestion to the active post-process prompt
- "Create New Prompt" - creates a new prompt incorporating the suggestion

**Gating:** Requires `experimental_enabled` + `post_process_enabled` (inherits existing feature gates).

### Feature 3: Model Metadata in Version History

Store and display the model name that generated each post-processed version.

**Backend changes:**

- New `model_name TEXT` column in `transcription_versions` table (migration M6)
- Populated from the active model setting at post-process time
- Nullable for backward compatibility with existing versions

**Frontend changes:**

- Small model name chip displayed in each VersionCard header, next to the timestamp
- Chip styling: `cornerRadius:4 fill:bg-elevated padding:[2,8] fontSize:11 text-muted`
- Only shown when `model_name` is present

**Type changes:**

- `TranscriptionVersion` struct gains `model_name: Option<String>`
- Bindings auto-update via tauri-specta

### Feature 4: Parallel Model Comparison (Design Only)

Toggle in the drawer's Compare Models section to run multiple models in parallel on the same transcription text.

**Scope:** Design and UI mockups only. Implementation deferred to a follow-up PR.

**UX flow:**

1. Enable "Compare Models" toggle in drawer
2. Add models via "+ Add Model" (inline form with provider/key/model fields)
3. Each model chip has an on/off toggle to control which models participate
4. Primary model indicated by pink border
5. Hit sparkle button on a history entry - all enabled models process in parallel
6. Results appear as a grouped batch in version history with a batch label
7. User picks their favorite via "Restore" button

**Version history display for parallel results:**

- Batch label at top: "Parallel comparison - N models - timestamp"
- Each version card shows model name chip
- Active version highlighted with pink border/bg
- Inactive versions show "Restore" button

**Add Model inline form:**

- Expands within the model list when "+ Add Model" clicked
- Fields: Provider dropdown, Base URL, API Key, Model selector
- Auto-fills API key if provider already exists in global settings
- Cancel/Add action buttons

## Technical Notes

- All new i18n keys added under `settings.history.*` and `settings.insights.*`
- Drawer uses existing component patterns from `PostProcessingSettings`
- Insights tab follows the same `SettingContainer` layout patterns
- DB migration M6 is additive (nullable column) - no breaking changes
- Parallel comparison backend deferred; only UI/types designed now
