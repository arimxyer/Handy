# Audio Toolkit

Low-level audio processing utilities used by the managers.

## Files

- `audio/` — Device enumeration (`devices.rs`), recording (`recorder.rs`), resampling (`resampler.rs`)
- `vad/` — Voice Activity Detection using Silero VAD ONNX model. Filters silence from recordings before transcription.
- `text.rs` — Text post-processing: word corrections, language-specific transformations (e.g., Chinese punctuation via ferrous-opencc)
- `constants.rs` — Audio constants (sample rates, buffer sizes)
- `utils.rs` — Audio utility functions

## Gotchas

- The Silero VAD model (`silero_vad_v4.onnx`) must be present in `src-tauri/resources/models/` for development. Download with: `curl -o src-tauri/resources/models/silero_vad_v4.onnx https://blob.handy.computer/silero_vad_v4.onnx`
- Resampling is required because Whisper expects 16kHz mono audio but recording devices vary.
