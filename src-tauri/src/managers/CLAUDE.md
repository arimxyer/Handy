# Managers

Long-lived stateful services initialized at app startup in `lib.rs` and stored in Tauri managed state.

## Files

- `audio.rs` — Audio device enumeration, recording lifecycle, microphone management. Wraps `cpal` for cross-platform audio I/O.
- `model.rs` — Model downloading (HTTP with progress events), file management, discovery of custom Whisper GGML models.
- `transcription.rs` — Speech-to-text processing. Loads Whisper/Parakeet models, runs inference, applies word corrections and language-specific text processing.
- `history.rs` — SQLite-based transcription history. Stores transcriptions with metadata, supports version tracking for post-processed results.
- `transcription_mock.rs` — Test mock for transcription manager.

## Pattern

Each manager is initialized in `lib.rs` setup closure and registered via `app.manage(Arc::new(Mutex::new(manager)))`. Access in commands via `app.state::<Arc<Mutex<Manager>>>()`.
