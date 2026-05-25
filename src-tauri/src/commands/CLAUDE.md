# Commands

Tauri command handlers — the bridge between frontend and backend.

## Files

- `audio.rs` — Device listing, microphone selection, recording control
- `history.rs` — CRUD for transcription history, version management, post-processing
- `models.rs` — Model listing, downloading, deletion, status queries
- `transcription.rs` — Settings changes (language, model, post-process config, prompts)
- `insights.rs` — Speech pattern analysis, token estimation, insights config (insiders)
- `mod.rs` — Module declarations

## Adding a New Command

1. Define function with `#[tauri::command]` and `#[specta::specta]` attributes
2. Add to `mod.rs` if in a new file
3. Register in `collect_commands!` macro in `lib.rs`
4. Run `mise run dev` to auto-generate TypeScript bindings in `src/bindings.ts`
