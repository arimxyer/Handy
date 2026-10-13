# Wayland overlay rendering repair

Verified on 2026-10-13 with KDE Wayland, AMD RX 9070 XT, and WebKitGTK 2.54.1.

## Cause and timing

The user observed flicker before the Handy 0.9.8 upgrade.
Pacman upgraded WebKitGTK from 2.52.6 to 2.54.1 on October 7.
Handy's older and newer builds both forced `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup.
WebKit 2.54 changed the fallback renderer and its damage handling.
The interaction erased unchanged card and text pixels while animated pixels survived.
The captured window already contained those missing pixels. Final monitor scanout alone could not explain the fault.

A temporary launch with extracted 2.52.6 libraries did not complete frontend startup.
That version comparison is inconclusive. It is not evidence that the old library rendered correctly.

## Repair

`src-tauri/src/linux_renderer.rs` selects DMA-BUF by default only when all conditions apply:

- Runtime WebKit is 2.54 or newer.
- The selected GTK backend uses Wayland.
- At least one DRM GPU exists, and all detected GPU vendors are AMD.

Explicit `WEBKIT_DISABLE_DMABUF_RENDERER` values remain unchanged.
Older WebKit, X11, mixed or untested GPU vendors, and unknown devices retain the previous fallback.
The repair changes neither native transparency nor overlay styling.
It does not change desktop settings, transcription, or user data.

## Validation

The deterministic replay uses fixed text, simulated audio levels, and a copied profile.
It includes moving waveform, silence, and text-update phases.
KDE portal capture records only the selected overlay window.

Failing capture: 1,983 lossless frames. Offline calibration identified 1,487 major card losses among 1,688 steady-state frames.
Every decoded frame matched its timestamped pixel hash.
The initial dot-only detector baseline was rejected and replaced with a complete reference card.

Repaired capture: 2,103 frames, no recorder errors, a valid complete-card baseline, and zero detected card or text dropouts.
Fixed text remained intact during both movement and silence.
The user also confirmed that the repaired candidate worked without flicker.

Renderer policy tests passed for the tested AMD Wayland case and conservative fallback cases.
Build, formatting, and clippy passed. Existing unrelated clippy warnings remain.

Evidence on this host:

- `/tmp/handy-overlay-capture/live-replay-4/REPORT.md`
- `/tmp/handy-overlay-capture/live-replay-4/validated-pixel-summary.json`
- `/tmp/handy-overlay-capture/dmabuf-repair-1/summary.json`
- `/tmp/handy-overlay-capture/dmabuf-repair-1/overlay.mkv`

## Remaining scope

The pixel acceptance used the regular-window diagnostic overlay.
The normal dev launch restores GTK layer shell and the copied profile.
The repair does not establish equivalent GPU behavior on Intel, NVIDIA, mixed-vendor, or X11 systems.
The installed package remains unchanged until a separate build and installation step.
