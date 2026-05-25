# Backend (Rust)

Tauri 2.x backend for Handy. All Tauri commands are defined in `commands/` and registered in `lib.rs`.

## Key Files

- `lib.rs` — App entry point: plugin registration, manager init, command registration, window event handling
- `main.rs` — CLI arg parsing (clap) before Tauri launch
- `settings.rs` — `AppSettings` struct with serde, persistence via tauri-plugin-store. All settings fields use `#[serde(default)]` for backwards compatibility when adding new fields.
- `transcription_coordinator.rs` — Orchestrates the full pipeline: recording → VAD → transcription → post-process → output
- `actions.rs` — Post-transcription actions (clipboard copy, paste, LLM post-processing)
- `llm_client.rs` — OpenAI-compatible HTTP client for post-processing and insights
- `clipboard.rs` — Platform-aware clipboard operations
- `input.rs` — Text input simulation (typing, pasting) across platforms
- `overlay.rs` — Recording overlay window positioning and visibility
- `tray.rs` / `tray_i18n.rs` — System tray menu, icon state, localized labels
- `cli.rs` — CLI flag definitions (clap derive): `--toggle-transcription`, `--start-hidden`, etc.
- `signal_handle.rs` — Unix signal handlers (SIGUSR1/SIGUSR2) for remote control
- `audio_feedback.rs` — Start/stop recording sound playback
- `apple_intelligence.rs` — macOS Apple Intelligence availability check
- `utils.rs` — Shared utility functions
- `helpers/` — Platform-specific helpers:
  - `clamshell.rs` — Clamshell (closed-lid) mode detection for macOS microphone switching

## Patterns

- **Manager pattern**: `managers/` contains long-lived state (Audio, Model, Transcription, History) stored in Tauri managed state via `app.manage()`
- **Command handlers**: `commands/` modules define `#[tauri::command]` + `#[specta::specta]` functions. Adding a new command requires registering it in the `collect_commands!` macro in `lib.rs`.
- **Settings changes**: Modify `AppSettings` in `settings.rs`, add `#[serde(default)]` for new fields, update `get_default_settings()`, add a command in the appropriate `commands/` file, and update `bindings.ts` on the frontend.
