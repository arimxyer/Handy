# Inline Edit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline editing of both raw transcription and post-processed text in history entries, with version tracking for undo.

**Architecture:** New DB migration adds `target` column to `transcription_versions`. New `update_entry_text` method and Tauri command handle the edit-save flow. Frontend adds edit state to `HistoryEntryComponent` with textarea swap and save/cancel buttons.

**Tech Stack:** Rust (rusqlite, tauri-specta), React/TypeScript, Tailwind CSS, i18next

**Design doc:** `docs/plans/2026-03-02-inline-edit-design.md`

---

### Task 1: Database Migration — Add `target` Column

**Files:**
- Modify: `src-tauri/src/managers/history.rs:21-48` (MIGRATIONS array)

**Step 1: Add migration M7**

Add to the `MIGRATIONS` array after the existing M6 (`model_name` column):

```rust
M::up("ALTER TABLE transcription_versions ADD COLUMN target TEXT NOT NULL DEFAULT 'post_processed';"),
```

**Step 2: Update `TranscriptionVersion` struct**

In `src-tauri/src/managers/history.rs:63-71`, add the `target` field:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TranscriptionVersion {
    pub id: i64,
    pub history_entry_id: i64,
    pub text: String,
    pub prompt: Option<String>,
    pub model_name: Option<String>,
    pub target: String,
    pub timestamp: i64,
}
```

**Step 3: Update all version query mappings**

Every place that reads from `transcription_versions` needs to include `target`. There are three locations:

1. `get_versions()` at line 611-628 — add `target` to the SELECT and the struct mapping:

```rust
pub fn get_versions(&self, history_entry_id: i64) -> Result<Vec<TranscriptionVersion>> {
    let conn = self.get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT id, history_entry_id, text, prompt, model_name, target, timestamp FROM transcription_versions WHERE history_entry_id = ?1 ORDER BY timestamp ASC",
    )?;

    let rows = stmt.query_map(params![history_entry_id], |row| {
        Ok(TranscriptionVersion {
            id: row.get("id")?,
            history_entry_id: row.get("history_entry_id")?,
            text: row.get("text")?,
            prompt: row.get("prompt")?,
            model_name: row.get("model_name")?,
            target: row.get("target")?,
            timestamp: row.get("timestamp")?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}
```

2. `restore_version()` at line 585-591 — add `target` to the SELECT so we know which column to restore to:

```rust
Some(vid) => {
    // Look up the version
    let (text, prompt, target): (String, Option<String>, String) = conn
        .query_row(
            "SELECT text, prompt, target FROM transcription_versions WHERE id = ?1 AND history_entry_id = ?2",
            params![vid, entry_id],
            |row| Ok((row.get("text")?, row.get("prompt")?, row.get("target")?)),
        )
        .map_err(|_| anyhow::anyhow!("VERSION_NOT_FOUND"))?;

    if target == "transcription" {
        conn.execute(
            "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
            params![text, entry_id],
        )?;
    } else {
        conn.execute(
            "UPDATE transcription_history SET post_processed_text = ?1, post_process_prompt = ?2 WHERE id = ?3",
            params![text, prompt, entry_id],
        )?;
    }
}
```

3. `save_version_and_update()` at line 545-548 — add `target` column to the INSERT (default `'post_processed'` for existing callers):

```rust
tx.execute(
    "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![id, text, Some(prompt), model_name, "post_processed", timestamp],
)?;
```

**Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib managers::history`

Expected: Tests pass. The migration applies cleanly, and existing tests still work because the new column has a default value.

**Step 5: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "feat: add target column to transcription_versions for edit tracking"
```

---

### Task 2: Update Existing Tests for `target` Field

**Files:**
- Modify: `src-tauri/src/managers/history.rs:642-989` (tests module)

**Step 1: Update test helpers that read versions**

Every test that reads from `transcription_versions` or constructs `TranscriptionVersion` structs needs the `target` field. Update the `save_and_get_versions` test (line 772) to include `target` in the query:

```rust
let versions: Vec<TranscriptionVersion> = stmt
    .query_map(params![1], |row| {
        Ok(TranscriptionVersion {
            id: row.get("id")?,
            history_entry_id: row.get("history_entry_id")?,
            text: row.get("text")?,
            prompt: row.get("prompt")?,
            model_name: row.get("model_name")?,
            target: row.get("target")?,
            timestamp: row.get("timestamp")?,
        })
    })
```

And add assertion that `target` defaults to `"post_processed"`:

```rust
assert_eq!(versions[0].target, "post_processed");
```

**Step 2: Run tests**

Run: `cd src-tauri && cargo test --lib managers::history`

Expected: All existing tests pass with `target` field included.

**Step 3: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "test: update history tests for target field"
```

---

### Task 3: Add `update_entry_text` Method to HistoryManager

**Files:**
- Modify: `src-tauri/src/managers/history.rs` (add method after `save_version_and_update`)

**Step 1: Write the test**

Add to the tests module:

```rust
#[test]
fn update_entry_text_post_processed() {
    let mut conn = setup_migrated_conn();
    insert_entry(&conn, 100, "raw text", Some("enhanced text"));

    let timestamp = 200i64;
    let tx = conn.transaction().expect("begin transaction");
    tx.execute(
        "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![1, "manually edited", Option::<String>::None, Some("Manual edit"), "post_processed", timestamp],
    )
    .expect("insert version");
    tx.execute(
        "UPDATE transcription_history SET post_processed_text = ?1 WHERE id = ?2",
        params!["manually edited", 1],
    )
    .expect("update entry");
    tx.commit().expect("commit");

    let entry = HistoryManager::get_latest_entry_with_conn(&conn)
        .expect("fetch entry")
        .expect("entry exists");
    assert_eq!(entry.post_processed_text.as_deref(), Some("manually edited"));
    assert_eq!(entry.transcription_text, "raw text"); // unchanged

    let version_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM transcription_versions WHERE history_entry_id = 1",
            [],
            |row| row.get(0),
        )
        .expect("count versions");
    assert_eq!(version_count, 1);

    // Check target field
    let target: String = conn
        .query_row(
            "SELECT target FROM transcription_versions WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("get target");
    assert_eq!(target, "post_processed");
}

#[test]
fn update_entry_text_transcription() {
    let mut conn = setup_migrated_conn();
    insert_entry(&conn, 100, "raw text", None);

    let timestamp = 200i64;
    let tx = conn.transaction().expect("begin transaction");
    tx.execute(
        "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![1, "corrected raw text", Option::<String>::None, Some("Manual edit"), "transcription", timestamp],
    )
    .expect("insert version");
    tx.execute(
        "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
        params!["corrected raw text", 1],
    )
    .expect("update entry");
    tx.commit().expect("commit");

    let entry = HistoryManager::get_latest_entry_with_conn(&conn)
        .expect("fetch entry")
        .expect("entry exists");
    assert_eq!(entry.transcription_text, "corrected raw text");
}
```

**Step 2: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib managers::history`

Expected: PASS (these tests exercise the SQL directly, same pattern as existing tests)

**Step 3: Add the `update_entry_text` method**

Add after `save_version_and_update` (around line 566):

```rust
/// Save a manual text edit with version tracking.
/// `target` must be `"transcription"` or `"post_processed"`.
pub fn update_entry_text(&self, id: i64, target: &str, new_text: &str) -> Result<()> {
    let mut conn = self.get_connection()?;
    let timestamp = Utc::now().timestamp();

    let tx = conn.transaction()?;

    // Insert version record for undo
    tx.execute(
        "INSERT INTO transcription_versions (history_entry_id, text, prompt, model_name, target, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, new_text, Option::<String>::None, Some("Manual edit"), target, timestamp],
    )?;

    // Update the appropriate column
    match target {
        "transcription" => {
            tx.execute(
                "UPDATE transcription_history SET transcription_text = ?1 WHERE id = ?2",
                params![new_text, id],
            )?;
        }
        "post_processed" => {
            tx.execute(
                "UPDATE transcription_history SET post_processed_text = ?1 WHERE id = ?2",
                params![new_text, id],
            )?;
        }
        _ => {
            return Err(anyhow::anyhow!("Invalid target: {}", target));
        }
    }

    tx.commit()?;

    debug!("Saved manual edit for entry {} (target: {})", id, target);

    // Emit history updated event
    if let Err(e) = self.app_handle.emit("history-updated", ()) {
        error!("Failed to emit history-updated event: {}", e);
    }

    Ok(())
}
```

**Step 4: Run tests**

Run: `cd src-tauri && cargo test --lib managers::history`

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src-tauri/src/managers/history.rs
git commit -m "feat: add update_entry_text method with version tracking"
```

---

### Task 4: Add Tauri Command

**Files:**
- Modify: `src-tauri/src/commands/history.rs` (add command after `restore_version`)
- Modify: `src-tauri/src/lib.rs:352` (register in `collect_commands!`)

**Step 1: Add the command**

Add after `restore_version` (around line 248) in `src-tauri/src/commands/history.rs`:

```rust
#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_text(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    field: String,
    new_text: String,
) -> Result<(), String> {
    let target = match field.as_str() {
        "transcription" | "post_processed" => field.as_str(),
        _ => return Err(format!("Invalid field: {}", field)),
    };

    history_manager
        .update_entry_text(id, target, &new_text)
        .map_err(|e| e.to_string())
}
```

**Step 2: Register the command**

In `src-tauri/src/lib.rs`, add after `commands::history::restore_version,` (line 352):

```rust
commands::history::update_history_entry_text,
```

**Step 3: Run compile check**

Run: `cd src-tauri && cargo check`

Expected: Compiles cleanly.

**Step 4: Commit**

```bash
git add src-tauri/src/commands/history.rs src-tauri/src/lib.rs
git commit -m "feat: add update_history_entry_text Tauri command"
```

---

### Task 5: Add i18n Keys

**Files:**
- Modify: `src/i18n/locales/en/translation.json` (add keys under `settings.history`)

**Step 1: Add the keys**

Add after `"versionNotFound": "Version not found"` (around line 415) in the `settings.history` section:

```json
"editTranscription": "Edit transcription",
"editSaved": "Edit saved",
"manualEdit": "Manual edit",
"transcriptionEdit": "Transcription edit",
```

**Step 2: Commit**

```bash
git add src/i18n/locales/en/translation.json
git commit -m "feat: add i18n keys for inline edit"
```

---

### Task 6: Frontend — Edit State in HistoryEntryComponent

**Files:**
- Modify: `src/components/settings/history/HistorySettings.tsx:264-456`

**Step 1: Add imports**

Add `Pencil` to the lucide-react imports (line 6-13):

```typescript
import {
  Copy,
  Star,
  Check,
  Trash2,
  FolderOpen,
  Sparkles,
  Loader2,
  Pencil,
} from "lucide-react";
```

**Step 2: Add edit state and handlers**

Inside `HistoryEntryComponent` (after line 278, the `showOriginal` state), add:

```typescript
const [isEditing, setIsEditing] = useState(false);
const [editText, setEditText] = useState("");

const handleStartEdit = () => {
  setEditText(displayText);
  setIsEditing(true);
};

const handleCancelEdit = () => {
  setIsEditing(false);
  setEditText("");
};

const handleSaveEdit = async () => {
  const trimmed = editText.trim();
  if (trimmed === displayText) {
    handleCancelEdit();
    return;
  }
  const field = hasEnhancedText && !showOriginal ? "post_processed" : "transcription";
  try {
    const result = await commands.updateHistoryEntryText(entry.id, field, trimmed);
    if (result.status === "error") {
      toast.error(result.error);
    } else {
      toast.success(t("settings.history.editSaved"));
    }
  } catch (error) {
    console.error("Failed to save edit:", error);
  } finally {
    setIsEditing(false);
    setEditText("");
  }
};

const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Escape") {
    handleCancelEdit();
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSaveEdit();
  }
};
```

**Step 3: Add edit button to action bar**

In the action bar `<div className="flex items-center gap-1">` (line 381), add the edit button before the copy button (before line 404):

```tsx
<button
  onClick={handleStartEdit}
  disabled={isEditing}
  className="text-text/50 hover:text-logo-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
  title={t("settings.history.editTranscription")}
>
  <Pencil width={16} height={16} />
</button>
```

**Step 4: Replace text display with conditional textarea**

Replace the `<p>` tag at line 449:

```tsx
{isEditing ? (
  <div className="flex flex-col gap-2">
    <textarea
      value={editText}
      onChange={(e) => setEditText(e.target.value)}
      onKeyDown={handleEditKeyDown}
      className="w-full text-sm text-text/90 bg-background border border-mid-gray/20 rounded-md p-2 resize-y focus:outline-none focus:border-logo-primary min-h-[60px]"
      autoFocus
    />
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={handleCancelEdit}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" size="sm" onClick={handleSaveEdit}>
        {t("common.save")}
      </Button>
    </div>
  </div>
) : (
  <p className="italic text-text/90 text-sm pb-2 select-text cursor-text">
    {displayText}
  </p>
)}
```

**Step 5: Disable other buttons while editing**

Add `disabled={isEditing}` and the disabled styling to the copy, star, delete, and post-process buttons. Add `disabled:opacity-30 disabled:cursor-not-allowed` to their classNames where not already present.

**Step 6: Generate bindings and verify**

Run: `mise run dev` (starts dev server, triggers specta binding generation)

Verify `src/bindings.ts` now includes `updateHistoryEntryText` command and `TranscriptionVersion` has the `target` field.

**Step 7: Test manually**

1. Open Handy → History tab
2. Click pencil icon on a history entry → textarea appears with text
3. Edit text, click Save → text updates, toast shows "Edit saved"
4. Click Cancel or press Escape → edit discards
5. Press Ctrl+Enter → saves
6. Expand version history → manual edit shows with pencil label
7. Restore to previous version → text reverts

**Step 8: Commit**

```bash
git add src/components/settings/history/HistorySettings.tsx
git commit -m "feat: add inline edit UI for history entries"
```

---

### Task 7: Frontend — Manual Edit Labels in VersionHistory

**Files:**
- Modify: `src/components/settings/history/VersionHistory.tsx:239-308` (VersionCard)

**Step 1: Add Pencil import**

Add `Pencil` to the lucide-react imports (line 9-16):

```typescript
import {
  ChevronUp,
  ChevronDown,
  History,
  Sparkles,
  Mic,
  RotateCcw,
  Loader2,
  Pencil,
} from "lucide-react";
```

**Step 2: Update VersionCard to show manual edit indicator**

In the VersionCard component (around line 273-277), replace the `model_name` chip:

```tsx
{version.model_name === "Manual edit" ? (
  <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40">
    <Pencil width={10} height={10} />
    {version.target === "transcription"
      ? t("settings.history.transcriptionEdit")
      : t("settings.history.manualEdit")}
  </span>
) : version.model_name ? (
  <span className="text-[11px] px-1.5 py-0.5 rounded bg-mid-gray/10 text-text/40">
    {version.model_name}
  </span>
) : null}
```

**Step 3: Test manually**

1. Edit a transcription → expand version history → see "Transcription edit" chip with pencil icon
2. Edit post-processed text → expand version history → see "Manual edit" chip with pencil icon
3. Restore a manual edit version → text reverts correctly based on target field

**Step 4: Commit**

```bash
git add src/components/settings/history/VersionHistory.tsx
git commit -m "feat: show manual edit labels in version history timeline"
```

---

### Task 8: Run Full Check

**Step 1: Format and lint**

Run: `mise run format && mise run lint && mise run clippy`

Fix any issues.

**Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test`

Expected: All tests pass.

**Step 3: Compile check**

Run: `mise run cargo:check`

Expected: Compiles cleanly.

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "chore: fix lint and formatting"
```
