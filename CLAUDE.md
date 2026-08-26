# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Fork:** This is the [arimxyer/Handy](https://github.com/arimxyer/Handy) insiders fork of [cjpais/Handy](https://github.com/cjpais/Handy). `main` mirrors upstream; `insiders` carries our extensions.

## Current Fork State

- `insiders` is merged through the exact upstream `v0.9.6` tag (merge `c7be006`, integrated on isolated branch `upgrade/insiders-v0.9.6`, 2026-08-26). The six commits then on `upstream/main` after the tag were deliberately excluded. `insiders-version.json` reads `0.9.6-insiders.1`, and that build is installed as of 2026-08-26. The manifest is bumped per fork build precisely so two builds of the same upstream version stay distinguishable in the tray and in the backup inventory.
- Upstream added **no** history migrations between v0.8.3 and v0.9.6, so the fork's migrations 5–12 append after upstream's 1–4 and the live profile stays at `user_version=12`. The v0.9.6 candidate was exercised against a copied live profile before installation and again after installation: `integrity_check` stayed `ok`, and row counts stayed unchanged at 724 history / 236 versions / 23 tabs.
- v0.9.6 advances `settings_schema_version` from 1 to 2. The live and copied-profile migrations made exactly three expected settings changes: add `filler_word_removal_enabled: true`, stamp schema 2, and clear the legacy integer `transcribe_gpu_device: -1` to `null` because transcribe.cpp 0.2 uses opaque device handles. No other settings changed.
- The insiders updater is intentionally **notification-only**. It still checks upstream's update feed, but clicking an available update opens the matching `cjpais/Handy` GitHub release page; it never downloads, installs, or relaunches into an official upstream artifact. Insiders upgrades continue through this merge/build/install workflow.
- `settings.models.filters.translation` means upstream's tooltip ("Filter models that support translation to English"), not the fork's old chip label. The fork's `filters.all` / `filters.multiLanguage` keys are currently unreferenced — left in place only because the catalog union merge does not apply deletions, not because anything decided to keep them.
- `check:translations` fails for `da`/`hi`/`ne`/`nl`: the fork's ~311 added keys were only ever written into the other 20 locales. Pre-existing, not caused by an upgrade.
- The 0.9.4 upgrade rewrote settings in place: `whisper_accelerator`/`whisper_gpu_device` were renamed to `transcribe_*`, 11 keys were added (`settings_schema_version`, `overlay_style`, `theme`, `vad_enabled`, …), and the stale bare model id `turbo` was cleared and auto-replaced (`model.rs:1494`) because upstream 0.9.x moved to a HuggingFace-style model catalog. The v0.9.6 catalog contains 69 entries.
- Rollback material in `/home/arimayer/backups`, newest first:
  - `Handy_0.9.6-insiders.1_amd64.deb` — what is installed; reinstall from this. The deb's internal package version remains upstream-compatible `0.9.6`; the filename and embedded insiders manifest distinguish the fork build.
  - `handy-preupgrade-20260826/` — complete stopped pre-upgrade profile plus the matching installed 0.9.5 binary and `/usr/lib/Handy` runtime. Its database is v12/integrity-ok with 724 history / 236 versions / 23 tabs.
  - `Handy_0.9.5-insiders.3_amd64.deb` — one release back and the normal binary/runtime rollback target.
  - `Handy_0.9.5-insiders.2_amd64.deb` and `Handy_0.9.5-insiders.1_amd64.deb` — same upstream base, progressively fewer paste changes (`.2` drops the dotool fix, `.1` drops the upstream cherry-picks too). A/B partners for `.3`, not rollback targets in their own right.
  - `handy-premerge-20260809/` — settings + history.db taken immediately before the 0.9.5 install.
  - `handy-insiders-0.9.4-insiders.1` + `Handy_0.9.4-insiders.1_amd64.deb`. Roll back with the deb, not the bare binary: `/usr/lib/Handy` now holds 0.9.6's runtime libs and the binary cannot run without matching ones.
  - `handy-premerge-20260802/` (settings + history.db at the 0.9.4 upgrade) and `handy-insiders-0.8.3-insiders.1`.
  - Anything older than 0.9.4 has no matching `/usr/lib/Handy` on disk — rebuild that tag from git rather than restoring a directory. The May 2026 `handy-upgrade-*` snapshots were deleted on 2026-08-02 as strict subsets of live data.
- Do not delete or reset `~/.local/share/com.pais.handy/history.db` without explicit user confirmation; transcription history and recordings are user data.

**Streaming / Live overlay:** the Live overlay only appears when `overlay_style == Live` **and** a stream is actually running, and streaming requires `LoadedEngine::TranscribeCpp` — a catalog GGUF model with `capabilities.streaming: true` (8 of the 69 qualify). Legacy `.bin`/ONNX models, including `parakeet-tdt-0.6b-v3-int8` and even the GGUF `parakeet-tdt-0.6b-v3`, never stream, and the overlay silently falls back to the compact pill.

**Lockfile:** resolve `src-tauri/Cargo.lock` conflicts by taking upstream's file verbatim and letting cargo add the fork's crates on top — never `cargo generate-lockfile`, which drifted 231 of 727 crates off upstream's tested set and broke the Tauri npm/crate version pairings. `bun.lock` gets the same treatment (`git checkout <tag> -- bun.lock`, then `bun install`), and it must be resolved _before_ `.nix/bun.nix` and `.nix/bun-lock-hash`: both are regenerated by the `postinstall` hook (`scripts/check-nix-deps.ts`), never hand-merged.

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

**Vulkan build dependency:** since v0.9.x, inference goes through `transcribe-cpp-sys` (cmake + GGML), not `whisper-rs`. Its Vulkan backend needs `spirv-headers` installed, or the build script dies with `Could not find a package configuration file provided by "SPIRV-Headers"`. It is not pulled in by `vulkan-headers`.

**Overlay on Wayland:** the recording overlay is a gtk-layer-shell surface, and a layer surface takes its size from the GTK window's size _request_ — `set_size` (i.e. `gtk_window.resize()`) is silently ignored, committing a 0x0 surface that renders but never appears. See `apply_layer_shell_geometry()` in `overlay.rs`; placement is anchor + margin, never `set_position`. `HANDY_NO_GTK_LAYER_SHELL=1` forces the regular-window path for A/B testing (the overlay then lands centre-screen, since Wayland ignores client positioning).

### Wayland/KDE Clipboard Tools

The app uses platform-specific tools for text input and clipboard. There are **two separate chains** in `clipboard.rs`, and they do not have the same order — a correction to an earlier version of this section, which listed one order for both:

- **Key combos** (`try_send_key_combo_linux`, the Ctrl+V-style paste) — KDE Wayland: `dotool` → `ydotool`. Non-KDE Wayland: `wtype` → `dotool` → `ydotool`. X11: `xdotool` → `ydotool`. `kwtype` is **not** in this chain.
- **Direct typing** (`try_direct_typing_linux`, `PasteMethod::Direct` in Auto mode) — KDE Wayland: `kwtype` → `dotool` → `ydotool`. Non-KDE Wayland: `wtype` → `dotool` → `ydotool`. X11: `xdotool` → `ydotool`.

Either chain falls back to enigo when no candidate succeeds. `wl-copy`/`wl-paste` are not in either — they carry clipboard contents, not keystrokes. Install hints: `sudo pacman -S ydotool wl-clipboard`; `kwtype` is not in pacman and must be [built from source](https://github.com/Sporif/KWtype).

The fork's `is_ydotool_available()` additionally requires `pgrep ydotoold` to succeed, because the binary alone is useless without the daemon. Upstream's `e449f69` answers a neighbouring question — _which_ key syntax ydotool wants — by probing `ydotool key --help` and caching the verdict (0.1.x takes symbolic `ctrl+v`, 1.x takes raw keycodes `29:1 47:1 …`; Handy always sent raw). Both live on `insiders` (cherry-picked ahead of their upstream release) and they **compose rather than conflict**: the fork's daemon gate runs first, so upstream's probe only ever runs when ydotoold is up and can return real help text instead of a socket error.

What actually runs on this machine, verified 2026-08-09 rather than inferred: `paste_method` is `None` and `clipboard_handling` is `CopyToClipboard`, so no key injection happens at all. If a paste method were enabled, KDE Wayland skips `wtype` (no `zwp_virtual_keyboard_manager_v1`) and **`dotool` wins** — `ydotoold` is disabled and inactive, so the ydotool branch is unreachable. `wtype`, `dotool`, `xdotool`, `ydotool` (1.0.4), `wl-copy`, and `wl-paste` are all installed; `kwtype` is not. `/dev/uinput` is group `input` but ACL-writable by the user.

**Availability probes must prove the tool can work, not that it exists** — the lesson behind the `pgrep ydotoold` gate, now applied twice more:

- `is_dotool_available()` also checks that `/dev/uinput` opens for writing, because dotool writes there directly. Use an `open()`, never a mode-bit read: the node is usually `root:input` with an ACL granting the desktop user access, so permission bits report a false negative.
- No probe is sufficient on its own, so `run_key_combo_chain` logs a failing tool and continues to the next instead of aborting the paste. Access can be revoked, a daemon can die, a compositor can drop a protocol — all between the probe and the call. This is also what makes upstream's `e449f69` reachable for the first time: a broken dotool used to end the paste before ydotool was ever consulted.

Trade-off accepted here: a tool failing _after_ emitting part of a chord can be followed by another tool sending the same chord. Each sends a complete combination per invocation and failures are near-always a spawn error or non-zero exit with nothing delivered, so this beats failing outright. If a double-paste ever shows up, this is the first place to look.
