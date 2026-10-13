# Handy overlay capture

The tool requests one window through the desktop portal.
The KDE dialog must permit the capture.
Select the Handy `Recording` window in that dialog.
The tool hides the cursor and rejects monitor streams.
The tool does not request persistent permission.

The tool needs Python GI, NumPy, GStreamer, PipeWire source support, and FFV1 encoding.

Use an isolated Handy development session with a copied profile.
Set `HANDY_DEBUG_OVERLAY_REPLAY_TRIGGER` to the trigger path when you launch that session.
The Linux debug build shows fixed diagnostic text and waits for that file.
The replay changes only overlay events. It does not use audio, models, or history.

Start the prepared replay capture:

```bash
python scripts/diagnostics/overlay_capture.py --seconds 35 --fps 60 --trigger /tmp/handy-overlay-dev-clybhvoc/replay.trigger --output /tmp/handy-overlay-capture/live-replay-1
```

After the first captured frame, the tool waits one second before it creates the replay trigger.
Use a new output directory for each capture.
If the trigger already exists, the tool stops before it opens the dialog.

The output directory contains:

- `overlay.mkv`: lossless FFV1 video with BGRA pixels.
- `frames.jsonl`: pixel metrics for each delivered frame.
- `summary.json`: frame rates, phase results, and candidate frame numbers.

The pixel metrics contain wall time, monotonic time, and GStreamer timestamps.
The metrics include alpha occupancy, card loss, text ink, accent pixels, and changed pixels.
The tool excludes expected entry and phase changes from candidate classification.
The tool measures actual delivered frames.
It does not add frames to reach the requested rate.

Check portal setup without a selection dialog:

```bash
python scripts/diagnostics/overlay_capture.py --preflight
```

Check the erased-card fixture:

```bash
python scripts/diagnostics/analyzer.py
```

Check video and metrics with generated frames:

```bash
python scripts/diagnostics/overlay_capture.py --synthetic --seconds 2 --output /tmp/handy-overlay-capture/new-synthetic-test
```

The generated-frame test delivered 121 frames at approximately 60 frames per second.
`ffprobe` confirmed FFV1, BGRA, 400x200 pixels, and a 60/1 frame rate.
The fixture erased the card and text while it kept the accent dot.
The analyzer reported full card loss, zero text ink, and all 49 accent pixels.
A size-guard test stored zero frames when the source exceeded the permitted size.
The portal preflight passed on this desktop with ScreenCast version 5.

Window capture does not include the final monitor scanout or the HDR display output.
The compositor can send fewer frames when the window changes less frequently.
Capture can also change compositor behavior.
Pixel changes identify candidates, but they do not prove display flicker.

Portal API reference: https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html

The analyzer needs a visible card in its baseline frame.
A missing or damaged baseline can invalidate the loss measurements.
Always inspect the saved video and baseline bounds before treating candidates as observed failures.
