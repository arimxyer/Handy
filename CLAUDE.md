# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Fork:** This is the [arimxyer/Handy](https://github.com/arimxyer/Handy) insiders fork of [cjpais/Handy](https://github.com/cjpais/Handy). `main` mirrors upstream; `insiders` carries our extensions.

## Current Fork State

- `insiders` is merged through upstream `v0.8.3` at `f6eeed0` (`chore: upgrade insiders to Handy v0.8.3`).
- The local Linux install was upgraded from this commit and the real profile database migrated from `user_version=8` to `9` on 2026-05-25.
- A pre-upgrade rollback backup is retained at `/home/arimayer/backups/handy-upgrade-20260525-122035` with the old app data and old `/usr/bin/handy` + `/usr/lib/Handy`.
- Do not delete or reset `~/.local/share/com.pais.handy/history.db` without explicit user confirmation; transcription history and recordings are user data.

## Development Commands

**Prerequisites:** [Rust](https://rustup.rs/) (latest stable), [Bun](https://bun.sh/), [mise](https://mise.jdx.dev/)

**Linux System Dependencies (Arch/CachyOS):**

```bash
sudo pacman -S cmake vulkan-headers vulkan-icd-loader webkit2gtk-4.1 gtk-layer-shell libayatana-appindicator fuse2 ydotool
```

On Ubuntu/Debian, see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux).

```bash
# Install dependencies
mise run install

# Development
mise run dev                # Start Tauri dev server
mise run build              # Build for production (all bundles)
mise run build:local        # Build local deb without updater signing (skip AppImage)

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

- `components/settings/` — Settings UI (60+ files, one per setting/section)
- `components/model-selector/` — Model download/selection interface
- `components/onboarding/` — First-run experience
- `stores/` — Zustand stores (settings, model state)
- `hooks/` — React hooks (settings, platform detection)
- `overlay/` — Separate Tauri window for recording indicator
- `i18n/` — Internationalization (i18next, 20 locales)
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
# Sync main with upstream, then integrate insiders in an isolated worktree/branch
mise run sync-upstream
git worktree add -b upgrade/insiders-<target> /tmp/handy-insiders-<target> insiders
```

- `main` mirrors upstream exactly — never commit directly to main
- `insiders` carries all experimental features; integrate upstream upgrades on a separate branch/worktree first
- Before running a newer build against the real profile, stop Handy and back up `~/.local/share/com.pais.handy` plus the installed `/usr/bin/handy` and `/usr/lib/Handy`
- First smoke-test migrations against a copied profile using temporary `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME`
- Patches can be exported/applied via `mise run export-patches` / `mise run apply-patches` when useful, but they are not the only upgrade path

## Linux Install (from source)

After `mise run build`, the raw binary (`src-tauri/target/release/handy`) cannot run standalone — it needs Tauri resource files (tray icons, sounds, VAD model) to be co-located at the expected path.

**Install from the deb bundle** (works on any distro):

```bash
cd /tmp
ar x /path/to/Handy_*_amd64.deb data.tar.gz
tar xzf data.tar.gz
sudo install -m 0755 usr/bin/handy /usr/bin/handy
sudo rm -rf /usr/lib/Handy
sudo cp -a usr/lib/Handy /usr/lib/Handy
sudo cp -a usr/share/icons/hicolor/* /usr/share/icons/hicolor/
sudo cp -a usr/share/applications/Handy.desktop /usr/share/applications/Handy.desktop
sudo chown -R root:root /usr/lib/Handy /usr/share/applications/Handy.desktop /usr/share/icons/hicolor
```

After rebuilding, only the binary needs re-copying: `sudo cp src-tauri/target/release/handy /usr/bin/`

**AppImage bundling** may fail on rolling-release distros (Arch, CachyOS) because linuxdeploy's bundled `strip` is too old for newer system libraries. The deb/rpm bundles and the binary itself still build fine. Use `mise run build:local` to skip the AppImage step and updater signing for local installs.

**Database migration mismatch:** If Handy panics at startup with `DatabaseTooFarAhead`, it means a newer build wrote migrations to `~/.local/share/com.pais.handy/history.db` that the current binary doesn't recognize. Fix by rebuilding/installing from the branch with newer migrations, or restore the profile from backup together with the older binary. Do not delete the DB unless the user explicitly accepts losing transcription history.

**whisper-rs Vulkan bindings:** Do not reintroduce `.cargo/config.toml` with `WHISPER_DONT_GENERATE_BINDINGS=1`. With upstream `v0.8.3` / `whisper-rs 0.16`, Linux Vulkan builds need regenerated bindings for the `ggml_backend_vk_*` symbols.

### Wayland/KDE Clipboard Tools

The app uses platform-specific tools for text input and clipboard. On KDE Wayland, the preference order is:

1. `kwtype` (KDE Fake Input protocol — best for special characters, not in pacman, build from [source](https://github.com/Sporif/KWtype))
2. `ydotool` (uinput-based, works on both Wayland and X11 — `sudo pacman -S ydotool`)
3. `wl-copy`/`wl-paste` (clipboard only — `sudo pacman -S wl-clipboard`)

See `src-tauri/src/clipboard.rs` for the full fallback chain.
