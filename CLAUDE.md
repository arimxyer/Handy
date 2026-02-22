# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Fork:** This is the [arimxyer/Handy](https://github.com/arimxyer/Handy) insiders fork of [cjpais/Handy](https://github.com/cjpais/Handy). `main` mirrors upstream; `insiders` carries our extensions.

## Development Commands

**Prerequisites:** [Rust](https://rustup.rs/) (latest stable), [Bun](https://bun.sh/), [mise](https://mise.jdx.dev/)

```bash
# Install dependencies
mise run bun install

# Development
mise run dev                # Start Tauri dev server
mise run build              # Build for production

# Code quality
mise run lint               # ESLint for frontend
mise run lint:fix           # ESLint with auto-fix
mise run format             # Prettier + cargo fmt
mise run format:check       # Check formatting without changes
mise run clippy             # Cargo clippy on backend
mise run cargo:check        # Fast compile check (no build)
mise run cargo:fmt          # Format Rust code
mise run cargo:test         # Run Rust unit tests

# Testing
mise run test               # Playwright tests
mise run test:ui            # Playwright tests with UI

# Fork workflow
mise run sync-upstream      # Sync main with upstream
mise run export-patches     # Export insiders patches
mise run apply-patches      # Apply patches to current branch

# All available tasks
mise tasks
```

**Model Setup (Required for Development):**

```bash
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://blob.handy.computer/silero_vad_v4.onnx
```

## Architecture Overview

Handy is a cross-platform desktop speech-to-text app built with Tauri 2.x (Rust backend + React/TypeScript frontend).

### Backend Structure (src-tauri/src/)

- `lib.rs` - Main entry point, Tauri setup, plugin/manager initialization
- `main.rs` - CLI argument parsing before Tauri launch
- `settings.rs` - Application settings (AppSettings struct, persistence)
- `managers/` - Core business logic:
  - `audio.rs` - Audio recording and device management
  - `model.rs` - Model downloading and management
  - `transcription.rs` - Speech-to-text processing pipeline
  - `history.rs` - Transcription history storage (SQLite)
- `commands/` - Tauri command handlers:
  - `audio.rs`, `history.rs`, `models.rs`, `transcription.rs` - Core commands
  - `insights.rs` - Speech pattern analysis commands (insiders)
- `audio_toolkit/` - Low-level audio processing:
  - `audio/` - Device enumeration, recording, resampling
  - `vad/` - Voice Activity Detection (Silero VAD)
- `actions.rs` - Post-transcription actions (clipboard, paste, post-process)
- `clipboard.rs` - Clipboard operations
- `cli.rs` - CLI argument definitions (clap derive)
- `input.rs` - Text input/typing simulation
- `llm_client.rs` - OpenAI-compatible LLM client for post-processing
- `overlay.rs` - Recording overlay window management
- `shortcut/` - Global keyboard shortcut handling
- `signal_handle.rs` - Unix signal handlers for remote control
- `transcription_coordinator.rs` - Orchestrates recording → transcription → output
- `tray.rs` - System tray menu and icon management

### Frontend Structure (src/)

- `App.tsx` - Main component with onboarding flow
- `bindings.ts` - Auto-generated Tauri type bindings (via tauri-specta)
- `components/settings/` - Settings UI (35+ files)
  - `insights/` - Speech insights UI (insiders)
  - `history/` - History settings, version viewer, post-process drawer (insiders)
- `components/model-selector/` - Model management interface
- `components/onboarding/` - First-run experience
- `hooks/useSettings.ts` - Settings state management hook
- `hooks/useOsType.ts` - Platform detection hook
- `hooks/usePostProcessDrawer.ts` - Post-process drawer state (insiders)
- `stores/settingsStore.ts` - Zustand store for settings
- `overlay/` - Recording overlay window code

### Key Patterns

**Manager Pattern:** Core functionality organized into managers (Audio, Model, Transcription) initialized at startup and managed via Tauri state.

**Command-Event Architecture:** Frontend → Backend via Tauri commands; Backend → Frontend via events.

**Pipeline Processing:** Audio → VAD → Whisper/Parakeet → Text output → Clipboard/Paste

**State Flow:** Zustand → Tauri Command → Rust State → Persistence (tauri-plugin-store)

## Insiders Features

These features exist on the `insiders` branch only:

- **History post-processing** — Re-run LLM post-processing on past transcriptions with version tracking
- **Version history viewer** — Browse and restore previous versions of any transcription
- **Post-process config drawer** — Compare results across different models
- **Speech pattern insights** — Analyze speech patterns with structured LLM output, history, and prompt enhancement

Key insiders files: `commands/insights.rs`, `llm_client.rs`, `InsightsSettings.tsx`, `useInsightsProviderState.ts`, `VersionHistory.tsx`, `PostProcessDrawer.tsx`, `usePostProcessDrawer.ts`

## Internationalization (i18n)

All user-facing strings must use i18next translations. ESLint enforces this (no hardcoded strings in JSX).

**Adding new text:**

1. Add key to `src/i18n/locales/en/translation.json`
2. Use in component: `const { t } = useTranslation(); t('key.path')`

17 supported locales: ar, cs, de, en (source), es, fr, it, ja, ko, pl, pt, ru, tr, uk, vi, zh, zh-TW

## Code Style

**Rust:**

- Run `mise run cargo:fmt` and `mise run clippy` before committing
- Handle errors explicitly (avoid unwrap in production)
- Use descriptive names, add doc comments for public APIs

**TypeScript/React:**

- Strict TypeScript, avoid `any` types
- Functional components with hooks
- Tailwind CSS for styling
- Path aliases: `@/` → `./src/`

## Commit Guidelines

Use conventional commits:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation
- `refactor:` code refactoring
- `chore:` maintenance

## Fork Workflow

```bash
# Sync main with upstream, then rebase insiders
mise run sync-upstream
git checkout insiders && git rebase main
```

- `main` mirrors upstream exactly — never commit directly to main
- `insiders` carries all experimental features rebased on main
- Patches can be exported/applied via `mise run export-patches` / `mise run apply-patches`

## CLI Parameters

Handy supports command-line parameters on all platforms for integration with scripts, window managers, and autostart configurations.

**Implementation files:** `cli.rs` (clap definitions), `main.rs` (parsing), `lib.rs` (applying overrides), `signal_handle.rs` (shared toggle logic)

| Flag                     | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `--toggle-transcription` | Toggle recording on/off on a running instance                   |
| `--toggle-post-process`  | Toggle recording with post-processing on/off                    |
| `--cancel`               | Cancel the current operation on a running instance              |
| `--start-hidden`         | Launch without showing the main window                          |
| `--no-tray`              | Launch without the system tray icon                             |
| `--debug`                | Enable debug mode with verbose (Trace) logging                  |

CLI flags are runtime-only overrides — they do NOT modify persisted settings. Remote control flags work via `tauri_plugin_single_instance`.

## Debug Mode

Access debug features: `Cmd+Shift+D` (macOS) or `Ctrl+Shift+D` (Windows/Linux)

## Platform Notes

- **macOS**: Metal acceleration, accessibility permissions required
- **Windows**: Vulkan acceleration, code signing
- **Linux**: OpenBLAS + Vulkan, limited Wayland support, overlay disabled by default. Requires `libasound2-dev` for building.
