---
paths:
  - "src-tauri/src/cli.rs"
  - "src-tauri/src/main.rs"
  - "src-tauri/src/lib.rs"
  - "src-tauri/src/signal_handle.rs"
---

# CLI Parameters

Handy supports command-line parameters on all platforms for integration with scripts, window managers, and autostart configurations.

**Implementation files:** `cli.rs` (clap definitions), `main.rs` (parsing), `lib.rs` (applying overrides), `signal_handle.rs` (shared toggle logic)

| Flag                     | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `--toggle-transcription` | Toggle recording on/off on a running instance      |
| `--toggle-post-process`  | Toggle recording with post-processing on/off       |
| `--cancel`               | Cancel the current operation on a running instance |
| `--start-hidden`         | Launch without showing the main window             |
| `--no-tray`              | Launch without the system tray icon                |
| `--debug`                | Enable debug mode with verbose (Trace) logging     |

CLI flags are runtime-only overrides — they do NOT modify persisted settings. Remote control flags work via `tauri_plugin_single_instance`.
