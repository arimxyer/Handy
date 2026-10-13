# Handy v0.9.8 insiders candidate

Date: 2026-10-13.

This candidate merges exact upstream tag `v0.9.8` (`14f6f0d31cb22a4268acfbddba3052820fd0a06e`) into insiders tip `27dd930347f6b8fb156409dc53be38d64db02e1a`.

Branch: `codex/insiders-v0.9.8`.

Candidate version: `0.9.8-insiders.1`. The deb package version remains `0.9.8`.

Initial candidate validation did not advance `insiders`, push to a remote, install the candidate, or change the live profile.

## Conflict resolution

- Preserve fork TextOps commands, document tabs, version history, insights, and completion notifications.
- Preserve the TextOps layout, drawer portal, grouped dropdown options, and store navigation.
- Add upstream onboarding preview, scroll reset, dropdown descriptions, and clipboard failure feedback.
- Preserve clipboard retry order, writable `/dev/uinput` check, and `ydotoold` check. Add upstream GNOME exclusion.
- Preserve the Linux titlebar repair. Add upstream macOS startup policy and Windows accelerator suppression.
- Use upstream centralized cancel-shortcut reconciliation. Preserve TextOps shortcut registration.
- Preserve fork settings and defaults. Add upstream shortcut activation and Chinese script migrations.
- Preserve notification-only updates. Add upstream system updater-disable support.
- Keep the fork AGENTS.md symlink and fork README content.
- Merge upstream translations over existing catalogs without removing fork keys. Add English fork fallbacks to new `ca` and `id` locales.
- Start both lockfiles from exact upstream files. Add fork dependencies through package managers.
- Pin `tauri-plugin-notification` to `=2.3.3` to avoid a newer Tauri dependency graph.
- Retain fork `uuid` 1.25.0 because the fork requires `^1.23.1`. All other upstream package versions remain present.
- Regenerate Nix metadata through the postinstall hook. Its hash remains unchanged because the resulting Bun lock matches the previous fork lock.

## Validation

| Check                                           | Result                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| Rust library tests with final lock              | 293 passed                                                    |
| TypeScript and Vite build                       | Passed                                                        |
| Frontend ESLint                                 | Passed                                                        |
| Cargo clippy, all targets                       | Completed with warnings, no errors                            |
| Cargo fmt check                                 | Passed                                                        |
| Conflict markers and unresolved index entries   | None                                                          |
| Whitespace outside generated bindings           | Passed                                                        |
| Keyboard assertions                             | Passed                                                        |
| Clipboard success/failure assertions            | Passed                                                        |
| Specta bindings export through new debug binary | No differences                                                |
| Independent source and React reviews            | No actionable regressions                                     |
| Translation key check                           | Known failure: `da`, `hi`, `ne`, `nl` each lack 311 fork keys |

Specta preserves its generated whitespace. The repository excludes `src/bindings.ts` from Prettier.

## Package

Artifact: `src-tauri/target/release/bundle/deb/Handy_0.9.8-insiders.1_amd64.deb`.

SHA-256: `772f6a872e6df427bc1b7b3aa8ea02b3e0952d91e562ac21f9cd2ff0dd2b5177`.

The artifact is a copy of the final Tauri deb with a fork-specific filename. Its internal package version is `0.9.8`.

## Copied-profile migration

The final extracted deb starts in hidden workspace `handy-v098-qa` with a separate DBus session and temporary XDG directories.

The test creates a coherent database copy with the SQLite backup API. It copies settings, recordings, models, and the selected Hugging Face cache without live-profile links.

Initial profile: schema 12, integrity `ok`, 678 history entries, 186 versions, and 23 tabs.

After startup, schema, integrity, all three user table counts, and ordered full-content hashes remain unchanged.

Initial settings changes:

- Remove legacy `push_to_talk: false`.
- Add `shortcut_activation: toggle`.
- Add `hold_threshold_ms: 300`.
- Add `vad_backend: silero`.
- Add `chinese_script: as_transcribed`.

All other initial settings fields remain unchanged. Dismissing What's New later changes `whats_new_last_seen_version` in the test copy only.

## Rendered app checks

The extracted release package renders General Settings, populated History, TextOps tabs and editor, and Text Settings.

The General page shows the migrated Toggle setting. TextOps retains saved documents, action buttons, and version controls. Text Settings retains provider and model settings with a masked API key.

Screenshots remain under `src-tauri/target/upgrade-evidence/`: `settings-initial.png`, `history.png`, `textops.png`, and `text-settings.png`.

Opening TextOps autosave updates one copied `document_tabs.updated_at` field. Document contents and table counts remain unchanged. The strict startup migration comparison occurs before this UI action.

## Inference and cleanup

A copied 12.39-second, mono, 16 kHz WAV produces nonempty output with both engines:

- ONNX: catalog id `parakeet-tdt-0.6b-v3`, copied INT8 model, exit 0.
- GGUF: `handy-computer/parakeet-unified-en-0.6b-gguf/parakeet-unified-en-0.6b-Q8_0.gguf`, exit 0.

Both commands use copied models, a copied Hugging Face cache, temporary XDG directories, and a separate DBus session. No model download or external AI request occurs. Transcript text remains private.

The hidden workspace and its owned processes stopped after QA. Host Handy remains running. Live settings hash and live database counts still match the initial baseline.

The detailed runtime report and initial migration JSON remain in `src-tauri/target/upgrade-evidence/`.

## Limits of initial upgrade validation

Microphone capture, streaming, live overlay, Wayland placement, global shortcuts, paste injection, external AI providers, and update actions remain untested.

The browser tests cover HTTP response and HTML structure. Native screenshots provide the rendered checks.

Clippy completes with warnings. The translation check retains the four pre-existing failures described above.

## Delivery status

On 2026-10-13, `insiders` advanced to tested merge `6f822c51`, and origin accepted the push. The merge has exact `v0.9.8` as its second parent. The original checkout remains clean after integration.

The installer created stopped backup `/home/arimayer/backups/handy-preupgrade-v0.9.8-20261013-145357-keze1eh4/` and installed the full deb. Its first restart failed because the archive runtime directory had mode `0700` after root ownership transfer. The original `verification.json` records that failure.

A desktop password helper authorized `sudo chmod -R a+rX /usr/lib/Handy`. The installed runtime now has mode `0755`, and the desktop user can load `libtranscribe.so.0.2`. The repaired installer normalizes permissions and checks shared libraries as the desktop user before restart.

The restarted `/usr/bin/handy` process runs as the desktop user and matches the tested binary SHA-256 `0398db639a31600db96bb11209f334d68019811d624e5b6d67caa7c35b9ca4b8`. Its embedded version is `0.9.8-insiders.1`.

Independent live checks pass: integrity `ok`, schema 12, exact schema and ordered content hashes unchanged, 678 history entries, 186 versions, and 23 tabs. Settings match the expected migration exactly and retain schema 2. Changed keys are `push_to_talk`, `shortcut_activation`, `hold_threshold_ms`, `vad_backend`, and `chinese_script`.

The backup's `post-repair-verification.json` records the successful checks separately from the failed initial report. The tested deb also remains at `/home/arimayer/backups/Handy_0.9.8-insiders.1_amd64.deb`.

No live-profile migration or installation occurred during candidate validation.

## Insiders.2 renderer repair installation

On 2026-10-13, source commit `b4462f7f` built `0.9.8-insiders.2` after repair `0b0b5013`.
Origin accepted the source update on `insiders`.
The repaired native replay captured 2,103 frames with zero detected card or text dropouts.
Renderer policy tests, the production build, and copied-profile startup validation passed.

Package SHA-256: `c82603ffc56847184bcf0052854f89f567de39d50f061adb6190e00691500ec9`.
Installed binary SHA-256: `d49617bf9f7d2fb3dc0af3d5c1081f80def771f313651bb731913ecaaf16a0e4`.
The binary embeds `0.9.8-insiders.2` and exactly matches the tested package.

The installer backed up the already stopped live profile and the complete `.1` installation.
Backup: `/home/arimayer/backups/handy-preupgrade-v0.9.8-insiders.2-20261013-172206-lvklfalu/`.
Its `verification.json` reports successful installation and restart.

Live database schema and ordered content hashes are exactly unchanged.
Integrity remains `ok`, schema 12, with 681 history entries, 186 versions, and 23 tabs.
All settings are exactly unchanged. This repair requires no migration.
Runtime directories have mode `0755`, and library checks pass as the desktop user.

The installed `/usr/bin/handy` runs as the desktop user on native Wayland with the normal live profile.
Its WebKit subprocess inherits `WEBKIT_DISABLE_DMABUF_RENDERER=0` from automatic renderer selection.
The normal GTK layer-shell path is enabled. No debug replay or layer-shell bypass remains.
The tested deb also remains at `/home/arimayer/backups/Handy_0.9.8-insiders.2_amd64.deb`.
