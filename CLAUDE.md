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

Handy is a cross-platform desktop speech-to-text app built with Tauri 2.x (Rust backend + React/TypeScript frontend). See subdirectory CLAUDE.md files for per-file details.

### Backend (`src-tauri/src/`)

- `managers/` — Long-lived stateful services (audio, model, transcription, history)
- `commands/` — Tauri command handlers (frontend-backend bridge)
- `audio_toolkit/` — Low-level audio processing and Voice Activity Detection
- `shortcut/` — Global keyboard shortcut handling
- `helpers/` — Platform-specific helpers (clamshell mode detection)
- Key entry points: `lib.rs` (app setup), `main.rs` (CLI parsing), `settings.rs` (AppSettings persistence), `transcription_coordinator.rs` (recording pipeline)

### Frontend (`src/`)

- `components/settings/` — Settings UI (35+ files, one per setting)
- `components/model-selector/` — Model download/selection interface
- `components/onboarding/` — First-run experience
- `stores/` — Zustand stores (settings, model state)
- `hooks/` — React hooks (settings, platform detection)
- `overlay/` — Separate Tauri window for recording indicator
- `i18n/` — Internationalization (i18next, 17 locales)
- `bindings.ts` — **Auto-generated** by tauri-specta. Do not edit manually.

### Key Patterns

**Manager Pattern:** Core functionality organized into managers (Audio, Model, Transcription, History) initialized at startup and managed via Tauri state.

**Command-Event Architecture:** Frontend → Backend via Tauri commands; Backend → Frontend via events.

**Pipeline:** Audio → VAD → Whisper/Parakeet → Text → Clipboard/Paste

**State Flow:** Zustand → Tauri Command → Rust State → Persistence (tauri-plugin-store)

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

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

## Fork Workflow

```bash
# Sync main with upstream, then rebase insiders
mise run sync-upstream
git checkout insiders && git rebase main
```

- `main` mirrors upstream exactly — never commit directly to main
- `insiders` carries all experimental features rebased on main
- Patches can be exported/applied via `mise run export-patches` / `mise run apply-patches`
