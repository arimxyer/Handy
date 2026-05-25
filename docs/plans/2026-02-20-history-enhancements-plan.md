# History Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a post-process drawer to the History tab, an Insights tab for speech analysis, model metadata in version history, and UI scaffolding for parallel model comparison.

**Architecture:** Builds on PR #851's history post-process infrastructure. Feature 3 (model metadata) ships first as a simple DB migration + display change. Feature 1 (drawer) reuses existing PostProcessingSettings components in a slide-in panel. Feature 2 (insights) adds a new sidebar tab with its own API config. Feature 4 (parallel comparison) is UI-only scaffolding in the drawer.

**Tech Stack:** Rust (rusqlite, tauri-specta), React/TypeScript, Zustand, Tailwind CSS, i18next

**Worktree:** `/home/arimayer/dev/PRs/Handy/.worktrees/history-post-process`

---

## Task 1: Add model_name column to transcription_versions (Backend)

**Files:**

- Modify: `src-tauri/src/managers/history.rs` (migrations array ~line 21, TranscriptionVersion struct ~line 63, save_version_and_update ~line 532, get_versions ~line 603)

**Step 1: Add Migration M6**

Add a 6th migration to the `MIGRATIONS` array (~line 44):

```rust
// After M5 (index creation)
M::up("ALTER TABLE transcription_versions ADD COLUMN model_name TEXT;"),
```

**Step 2: Update TranscriptionVersion struct**

Add `model_name` field (~line 63):

```rust
pub struct TranscriptionVersion {
    pub id: i64,
    pub history_entry_id: i64,
    pub text: String,
    pub prompt: Option<String>,
    pub model_name: Option<String>,
    pub timestamp: i64,
}
```

**Step 3: Update save_version_and_update to accept model_name**

Change signature and INSERT (~line 532):

```rust
pub fn save_version_and_update(
    &self,
    id: i64,
    text: &str,
    prompt: &str,
    model_name: Option<&str>,
) -> Result<()> {
```

Update the INSERT statement to include `model_name`:

```rust
tx.execute(
    "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, timestamp)
     VALUES (?1, ?2, ?3, ?4, ?5)",
    params![id, text, prompt, model_name, now],
)?;
```

**Step 4: Update get_versions query**

Update the SELECT in `get_versions` (~line 603) to include `model_name`:

```rust
"SELECT id, history_entry_id, text, prompt, model_name, timestamp
 FROM transcription_versions WHERE history_entry_id = ?1
 ORDER BY timestamp ASC"
```

And the row mapping:

```rust
Ok(TranscriptionVersion {
    id: row.get(0)?,
    history_entry_id: row.get(1)?,
    text: row.get(2)?,
    prompt: row.get(3)?,
    model_name: row.get(4)?,
    timestamp: row.get(5)?,
})
```

**Step 5: Update all callers of save_version_and_update**

In `src-tauri/src/commands/history.rs` (~line 162), the `post_process_history_entry` command calls `save_version_and_update`. Update it to pass the model name from settings:

```rust
let model_id = settings.post_process_models
    .get(&settings.post_process_provider_id)
    .map(|s| s.as_str());

history_manager.save_version_and_update(id, &processed_text, &prompt_text, model_id)?;
```

**Step 6: Run format and verify compilation**

```bash
cd src-tauri && cargo fmt && cargo clippy
```

**Step 7: Commit**

```bash
git add src-tauri/src/managers/history.rs src-tauri/src/commands/history.rs
git commit -m "feat: store model_name in transcription versions (migration M6)"
```

---

## Task 2: Display model name in VersionCard (Frontend)

**Files:**

- Modify: `src/components/settings/history/VersionHistory.tsx` (~line 239, VersionCard component)
- Modify: `src/i18n/locales/en/translation.json` (add new keys)

**Step 1: Verify bindings regenerated**

After Task 1, run `bun run tauri dev` briefly or check that `src/bindings.ts` now includes `model_name?: string | null` on `TranscriptionVersion`. If not, regenerate bindings.

**Step 2: Add model chip to VersionCard**

In `VersionHistory.tsx`, update the `VersionCard` component (~line 239). Add a model chip between the timestamp and the active badge/restore button in the header:

```tsx
const VersionCard: React.FC<VersionCardProps> = ({
  version,
  entryId,
  isActive,
  isLatest,
  language,
}) => {
  const { t } = useTranslation();
  const formattedTime = formatDateTime(String(version.timestamp), language);

  return (
    <div
      className={`rounded-md border p-3 ${
        isActive
          ? "border-logo-primary/50 bg-logo-primary/10"
          : "border-mid-gray/20"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-logo-primary" : "bg-text/30"
            }`}
          />
          <span
            className={`text-xs font-medium ${
              isActive ? "text-logo-primary" : "text-text/60"
            }`}
          >
            {formattedTime}
          </span>
          {version.model_name && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40">
              {version.model_name}
            </span>
          )}
        </div>
        {isActive ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-logo-primary text-white">
            {t("settings.history.activeVersion")}
          </span>
        ) : (
          <RestoreButton entryId={entryId} versionId={version.id} />
        )}
      </div>
      {/* ... rest unchanged */}
```

**Step 3: Run lint**

```bash
bun run lint
```

**Step 4: Commit**

```bash
git add src/components/settings/history/VersionHistory.tsx
git commit -m "feat: display model name chip in version history cards"
```

---

## Task 3: Post-Process Drawer - usePostProcessDrawer hook

**Files:**

- Create: `src/hooks/usePostProcessDrawer.ts`

**Step 1: Create the drawer state hook**

This hook manages temporary overrides for the drawer. It reads current settings as defaults and stores overrides in local state.

```typescript
import { useState, useCallback, useMemo } from "react";
import { useSettings } from "./useSettings";
import type { LLMPrompt } from "@/bindings";

interface DrawerOverrides {
  providerId: string | null;
  apiKey: string | null;
  modelId: string | null;
  selectedPromptId: string | null;
  promptText: string | null;
}

export function usePostProcessDrawer() {
  const { getSetting } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [overrides, setOverrides] = useState<DrawerOverrides>({
    providerId: null,
    apiKey: null,
    modelId: null,
    selectedPromptId: null,
    promptText: null,
  });

  // Effective values: override if set, else fall back to global setting
  const effectiveProviderId =
    overrides.providerId ?? getSetting("post_process_provider_id") ?? "";
  const effectiveModelId =
    overrides.modelId ??
    (getSetting("post_process_models") as Record<string, string> | undefined)?.[
      effectiveProviderId
    ] ??
    "";
  const effectivePromptId =
    overrides.selectedPromptId ??
    getSetting("post_process_selected_prompt_id") ??
    "";

  const prompts =
    (getSetting("post_process_prompts") as LLMPrompt[] | undefined) ?? [];
  const selectedPrompt = prompts.find((p) => p.id === effectivePromptId);
  const effectivePromptText =
    overrides.promptText ?? selectedPrompt?.prompt ?? "";

  const setOverride = useCallback(
    <K extends keyof DrawerOverrides>(key: K, value: DrawerOverrides[K]) => {
      setOverrides((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetOverrides = useCallback(() => {
    setOverrides({
      providerId: null,
      apiKey: null,
      modelId: null,
      selectedPromptId: null,
      promptText: null,
    });
  }, []);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    resetOverrides();
  }, [resetOverrides]);

  return {
    isOpen,
    open,
    close,
    overrides,
    setOverride,
    resetOverrides,
    effectiveProviderId,
    effectiveModelId,
    effectivePromptId,
    effectivePromptText,
    prompts,
  };
}
```

**Step 2: Run lint**

```bash
bun run lint
```

**Step 3: Commit**

```bash
git add src/hooks/usePostProcessDrawer.ts
git commit -m "feat: add usePostProcessDrawer hook for temporary overrides"
```

---

## Task 4: Post-Process Drawer - UI Component

**Files:**

- Create: `src/components/settings/history/PostProcessDrawer.tsx`
- Modify: `src/components/settings/history/HistorySettings.tsx` (~line 45, add drawer toggle button and drawer render)
- Modify: `src/i18n/locales/en/translation.json`

**Step 1: Add i18n keys**

Add to `settings.history` in `src/i18n/locales/en/translation.json`:

```json
"drawer": {
  "title": "Post-Process Config",
  "description": "Override model and prompt for history post-processing. Changes are temporary unless saved.",
  "provider": "Provider",
  "apiKey": "API Key",
  "model": "Model",
  "prompt": "Prompt",
  "promptText": "Prompt Text",
  "promptTextPlaceholder": "Edit the prompt instructions...",
  "newPrompt": "+ New",
  "saveAsDefault": "Save as Default",
  "saveAsDefaultDescription": "Persist to global settings",
  "compareModels": "Compare Models",
  "compareModelsDescription": "Run multiple models in parallel",
  "compareNote": "Each model runs independently. Pick your favorite from the results.",
  "addModel": "+ Add Model",
  "primary": "Primary"
}
```

**Step 2: Create PostProcessDrawer component**

Create `src/components/settings/history/PostProcessDrawer.tsx`. This is a slide-in right panel that reuses the same field patterns as PostProcessingSettings but with temporary overrides:

```tsx
import React from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles } from "lucide-react";

interface PostProcessDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  // Pass through the hook values
  effectiveProviderId: string;
  effectiveModelId: string;
  effectivePromptId: string;
  effectivePromptText: string;
  prompts: Array<{ id: string; name: string; prompt: string }>;
  onOverride: (key: string, value: string | null) => void;
  onSaveAsDefault: () => void;
}

export const PostProcessDrawer: React.FC<PostProcessDrawerProps> = ({
  isOpen,
  onClose,
  effectiveProviderId,
  effectiveModelId,
  effectivePromptId,
  effectivePromptText,
  prompts,
  onOverride,
  onSaveAsDefault,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-background border-l border-mid-gray/20 shadow-xl z-50 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-mid-gray/20">
        <div className="flex items-center gap-2">
          <Sparkles width={14} height={14} className="text-logo-primary" />
          <span className="text-sm font-semibold">
            {t("settings.history.drawer.title")}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text/50 hover:text-logo-primary transition-colors cursor-pointer"
        >
          <X width={16} height={16} />
        </button>
      </div>

      {/* Description */}
      <p className="px-4 pt-3 text-xs text-text/50 leading-relaxed">
        {t("settings.history.drawer.description")}
      </p>

      {/* Fields */}
      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Provider */}
        <DrawerField label={t("settings.history.drawer.provider")}>
          {/* Reuse ProviderSelect or a simple dropdown */}
          {/* Implementation: use existing usePostProcessProviderState hook values */}
          <select
            value={effectiveProviderId}
            onChange={(e) => onOverride("providerId", e.target.value)}
            className="w-full text-sm bg-background border border-mid-gray/30 rounded-md px-3 py-2 text-text"
          >
            {/* Populated from settings.post_process_providers */}
          </select>
        </DrawerField>

        {/* Model */}
        <DrawerField label={t("settings.history.drawer.model")}>
          <input
            type="text"
            value={effectiveModelId}
            onChange={(e) => onOverride("modelId", e.target.value)}
            className="w-full text-sm bg-background border border-mid-gray/30 rounded-md px-3 py-2 text-text"
          />
        </DrawerField>

        {/* Prompt selector */}
        <DrawerField label={t("settings.history.drawer.prompt")}>
          <select
            value={effectivePromptId}
            onChange={(e) => onOverride("selectedPromptId", e.target.value)}
            className="w-full text-sm bg-background border border-mid-gray/30 rounded-md px-3 py-2 text-text"
          >
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </DrawerField>

        {/* Prompt text */}
        <DrawerField label={t("settings.history.drawer.promptText")}>
          <textarea
            value={effectivePromptText}
            onChange={(e) => onOverride("promptText", e.target.value)}
            rows={6}
            className="w-full text-xs bg-background border border-mid-gray/30 rounded-md px-3 py-2 text-text leading-relaxed resize-y"
            placeholder={t("settings.history.drawer.promptTextPlaceholder")}
          />
        </DrawerField>

        {/* Save as Default toggle */}
        <div className="border-t border-mid-gray/20 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">
                {t("settings.history.drawer.saveAsDefault")}
              </p>
              <p className="text-xs text-text/50">
                {t("settings.history.drawer.saveAsDefaultDescription")}
              </p>
            </div>
            {/* Toggle - implementation connects to onSaveAsDefault */}
          </div>
        </div>
      </div>
    </div>
  );
};

PostProcessDrawer.displayName = "PostProcessDrawer";

interface DrawerFieldProps {
  label: string;
  children: React.ReactNode;
}

const DrawerField: React.FC<DrawerFieldProps> = ({ label, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-semibold text-text">{label}</label>
    {children}
  </div>
);
```

Note: This is a starting scaffold. The actual implementation should reuse existing components (`ProviderSelect`, `ModelSelect`) by extracting their core logic or passing override props. The exact integration depends on how those components access settings internally.

**Step 3: Integrate drawer into HistorySettings**

In `src/components/settings/history/HistorySettings.tsx`, add a "Post-Process Config" button to the header (~line 205) and render the drawer:

```tsx
// Add import
import { PostProcessDrawer } from "./PostProcessDrawer";
import { usePostProcessDrawer } from "@/hooks/usePostProcessDrawer";

// Inside HistorySettings component, add:
const drawer = usePostProcessDrawer();

// In the header area, add button:
{
  historyPostProcessEnabled && (
    <Button
      onClick={drawer.open}
      variant="secondary"
      size="sm"
      className="flex items-center gap-2"
    >
      <Sparkles className="w-4 h-4" />
      <span>{t("settings.history.drawer.title")}</span>
    </Button>
  );
}

// After the main content div, render the drawer:
<PostProcessDrawer
  isOpen={drawer.isOpen}
  onClose={drawer.close}
  effectiveProviderId={drawer.effectiveProviderId}
  effectiveModelId={drawer.effectiveModelId}
  effectivePromptId={drawer.effectivePromptId}
  effectivePromptText={drawer.effectivePromptText}
  prompts={drawer.prompts}
  onOverride={(key, value) => drawer.setOverride(key as any, value)}
  onSaveAsDefault={() => {
    /* TODO: persist overrides to global settings */
  }}
/>;
```

**Step 4: Run lint and format**

```bash
bun run lint:fix && bun run format
```

**Step 5: Commit**

```bash
git add src/components/settings/history/PostProcessDrawer.tsx src/components/settings/history/HistorySettings.tsx src/hooks/usePostProcessDrawer.ts src/i18n/locales/en/translation.json
git commit -m "feat: add post-process config drawer to history tab"
```

---

## Task 5: Wire drawer overrides into post_process_history_entry

**Files:**

- Modify: `src-tauri/src/commands/history.rs` (~line 118, post_process_history_entry)
- Modify: `src/components/settings/history/HistorySettings.tsx` (pass drawer overrides when calling post-process)

**Step 1: Add optional override params to the command**

Update `post_process_history_entry` in `src-tauri/src/commands/history.rs` to accept optional overrides:

```rust
#[tauri::command]
#[specta::specta]
pub async fn post_process_history_entry(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    override_provider_id: Option<String>,
    override_api_key: Option<String>,
    override_model_id: Option<String>,
    override_prompt_text: Option<String>,
) -> Result<String, String> {
```

When overrides are present, construct temporary settings from them instead of reading from persisted settings. Fall back to persisted settings for any non-overridden value.

**Step 2: Update frontend call to pass overrides**

In `HistorySettings.tsx`, the `handlePostProcess` function (~line 285) should check if the drawer has active overrides and pass them:

```typescript
const result = await commands.postProcessHistoryEntry(
  entry.id,
  drawer.overrides.providerId ?? null,
  drawer.overrides.apiKey ?? null,
  drawer.overrides.modelId ?? null,
  drawer.overrides.promptText ?? null,
);
```

**Step 3: Update model_name passed to save_version_and_update**

Use the effective model name (override or settings) when saving the version:

```rust
let effective_model = override_model_id
    .as_deref()
    .or_else(|| settings.post_process_models.get(&effective_provider_id).map(|s| s.as_str()));

history_manager.save_version_and_update(id, &processed_text, &prompt_text, effective_model)?;
```

**Step 4: Format and verify**

```bash
cd src-tauri && cargo fmt && cargo clippy
bun run lint
```

**Step 5: Commit**

```bash
git add src-tauri/src/commands/history.rs src/components/settings/history/HistorySettings.tsx
git commit -m "feat: wire drawer overrides into post-process command"
```

---

## Task 6: Compare Models UI scaffolding in drawer

**Files:**

- Modify: `src/components/settings/history/PostProcessDrawer.tsx`
- Modify: `src/i18n/locales/en/translation.json`

**Step 1: Add Compare Models section to drawer**

Below the "Save as Default" toggle in `PostProcessDrawer.tsx`, add the Compare Models section. This is UI-only (no backend wiring yet):

- Toggle to enable/disable compare mode
- List of model chips with on/off toggles
- Primary model indicator (pink border)
- "+ Add Model" button (opens inline form)
- Info banner explaining parallel comparison

State is local to the component (useState for compare models list, toggle states).

**Step 2: Run lint**

```bash
bun run lint
```

**Step 3: Commit**

```bash
git add src/components/settings/history/PostProcessDrawer.tsx src/i18n/locales/en/translation.json
git commit -m "feat: add compare models UI scaffolding to drawer (design only)"
```

---

## Task 7: Insights Tab - Backend command

**Files:**

- Create: `src-tauri/src/commands/insights.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add module)
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src-tauri/src/settings.rs` (add insights settings fields)

**Step 1: Add insights settings to AppSettings**

In `src-tauri/src/settings.rs`, add to the `AppSettings` struct:

```rust
#[serde(default)]
pub insights_provider_id: String,

#[serde(default)]
pub insights_api_keys: HashMap<String, String>,

#[serde(default)]
pub insights_models: HashMap<String, String>,

#[serde(default = "default_insights_entry_count")]
pub insights_entry_count: u32,

#[serde(default)]
pub insights_use_all_history: bool,
```

Add the default function:

```rust
fn default_insights_entry_count() -> u32 {
    50
}
```

**Step 2: Create insights command**

Create `src-tauri/src/commands/insights.rs`:

```rust
use tauri::{AppHandle, State};
use std::sync::Arc;
use crate::managers::history::HistoryManager;
use crate::settings;

#[tauri::command]
#[specta::specta]
pub async fn analyze_speech_patterns(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<String, String> {
    let s = settings::read_settings(&app);

    if !s.experimental_enabled || !s.post_process_enabled {
        return Err("INSIGHTS_DISABLED".to_string());
    }

    // Get entries based on scope setting
    let entries = history_manager.get_entries()
        .map_err(|e| format!("Failed to get entries: {}", e))?;

    let scope = if s.insights_use_all_history {
        entries
    } else {
        entries.into_iter().take(s.insights_entry_count as usize).collect()
    };

    // Collect original transcription texts
    let texts: Vec<&str> = scope.iter()
        .map(|e| e.transcription_text.as_str())
        .collect();

    // Build analysis prompt
    let analysis_prompt = build_analysis_prompt(&texts);

    // Call LLM (reuse post_process infrastructure)
    let provider_id = if s.insights_provider_id.is_empty() {
        &s.post_process_provider_id
    } else {
        &s.insights_provider_id
    };

    // Use the same LLM call pattern as post_process_transcription
    // but with the analysis prompt and insights provider/model
    // ... (implementation details follow post_process_transcription pattern)

    Ok(analysis_prompt) // placeholder
}

fn build_analysis_prompt(texts: &[&str]) -> String {
    let combined = texts.join("\n---\n");
    format!(
        "Analyze these speech-to-text transcriptions for patterns. \
         Identify: 1) Common filler words and verbal tics, \
         2) Sentence structure tendencies, \
         3) Common topics/vocabulary. \
         Then suggest specific prompt improvements for cleaning up this person's speech patterns.\n\n\
         Transcriptions:\n{}",
        combined
    )
}
```

**Step 3: Register command**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod insights;
```

Add to the `collect_commands![]` in `src-tauri/src/lib.rs`.

**Step 4: Add setting change commands**

Add commands for changing insights settings (follow the existing pattern from `change_post_process_*` commands in `src-tauri/src/shortcut/mod.rs`):

```rust
#[tauri::command]
#[specta::specta]
pub fn change_insights_provider_id(app: AppHandle, value: String) -> Result<(), String> {
    let mut settings = settings::read_settings(&app);
    settings.insights_provider_id = value;
    settings::write_settings(&app, settings).map_err(|e| e.to_string())
}
```

Repeat for `insights_api_keys`, `insights_models`, `insights_entry_count`, `insights_use_all_history`.

**Step 5: Format and verify**

```bash
cd src-tauri && cargo fmt && cargo clippy
```

**Step 6: Commit**

```bash
git add src-tauri/src/commands/insights.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/settings.rs
git commit -m "feat: add insights backend command and settings"
```

---

## Task 8: Insights Tab - Frontend component

**Files:**

- Create: `src/components/settings/insights/InsightsSettings.tsx`
- Modify: `src/components/Sidebar.tsx` (~line 34, add to SECTIONS_CONFIG)
- Modify: `src/i18n/locales/en/translation.json`

**Step 1: Add i18n keys**

Add to `src/i18n/locales/en/translation.json`:

```json
"sidebar": {
  "insights": "Insights"
},
"settings": {
  "insights": {
    "title": "Speech Insights",
    "description": "Analyze your transcription history for speech patterns and get prompt improvement suggestions.",
    "api": {
      "title": "API Configuration",
      "description": "Configure a separate model for analysis (or uses post-process model if empty)."
    },
    "scope": {
      "title": "Analysis Scope",
      "entryCount": "Number of entries to analyze",
      "useAllHistory": "Use all history"
    },
    "analyze": "Analyze Speech Patterns",
    "analyzing": "Analyzing...",
    "results": {
      "title": "Analysis Results",
      "patterns": "Speech Patterns",
      "suggestions": "Prompt Suggestions",
      "improvePrompt": "Improve Current Prompt",
      "createPrompt": "Create New Prompt"
    },
    "errors": {
      "disabled": "Insights requires experimental and post-process features enabled.",
      "failed": "Analysis failed. Please check your API configuration.",
      "empty": "No transcription history to analyze."
    }
  }
}
```

**Step 2: Create InsightsSettings component**

Create `src/components/settings/insights/InsightsSettings.tsx`:

The component structure follows the existing settings patterns:

- API config section (provider/key/model) reusing the same field patterns
- Scope config section (slider for entry count, "use all" toggle)
- "Analyze" button
- Results display area with action buttons

Use `SettingsGroup` and `SettingContainer` wrappers consistent with other settings pages.

**Step 3: Add to Sidebar**

In `src/components/Sidebar.tsx`, add to `SECTIONS_CONFIG` after `history`:

```typescript
insights: {
  labelKey: "sidebar.insights",
  icon: Lightbulb, // from lucide-react
  component: InsightsSettings,
  enabled: (settings) =>
    (settings?.experimental_enabled ?? false) &&
    (settings?.post_process_enabled ?? false),
},
```

Import `Lightbulb` from lucide-react and `InsightsSettings` from the new file.

**Step 4: Run lint and format**

```bash
bun run lint:fix && bun run format
```

**Step 5: Commit**

```bash
git add src/components/settings/insights/ src/components/Sidebar.tsx src/i18n/locales/en/translation.json
git commit -m "feat: add Insights tab with speech pattern analysis"
```

---

## Task 9: Final integration and polish

**Files:**

- All modified files from previous tasks

**Step 1: Run full lint and format**

```bash
bun run lint && bun run format:check
cd src-tauri && cargo fmt --check && cargo clippy
```

**Step 2: Test the full flow manually**

1. Open Handy, go to History tab
2. Verify model name appears in version cards for new post-processed entries
3. Open drawer, change model/prompt, post-process an entry
4. Verify the version card shows the overridden model name
5. Open Insights tab, configure API, run analysis
6. Verify compare models UI renders in drawer (non-functional)

**Step 3: Fix any lint/format issues**

```bash
bun run lint:fix && bun run format
cd src-tauri && cargo fmt
```

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: lint and polish for history enhancements"
```

---

## Dependency Order

```
Task 1 (model_name backend)
  └── Task 2 (model_name frontend)
  └── Task 5 (wire drawer overrides - needs model_name passing)

Task 3 (drawer hook) ──┐
                       ├── Task 4 (drawer UI) ── Task 5 (wire overrides) ── Task 6 (compare UI)
i18n updates ──────────┘

Task 7 (insights backend) ── Task 8 (insights frontend)

Task 9 (integration) depends on all above
```

Tasks 1-2 and 3-4 can be worked on in parallel. Task 7-8 is independent of 1-6.
