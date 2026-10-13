//! Development-only deterministic overlay input. Does not use audio or history.

use crate::managers::transcription::StreamTextEvent;
use crate::overlay;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_specta::Event;

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn start_if_requested(handle: &AppHandle) {
    let Some(trigger) = std::env::var_os("HANDY_DEBUG_OVERLAY_REPLAY_TRIGGER") else {
        return;
    };
    let trigger = PathBuf::from(trigger);
    let handle = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(3));
        overlay::show_streaming_overlay(&handle);
        std::thread::sleep(Duration::from_millis(600));
        overlay::emit_recording_ready(&handle);
        let _ = StreamTextEvent {
            committed: "Overlay capture ready. Fixed diagnostic text.".into(),
            tentative: String::new(),
        }
        .emit(&handle);
        eprintln!("[overlay-replay] ready timestamp_ms={}", timestamp_ms());

        // The capture process creates this file after its first frame arrives.
        while !trigger.is_file() {
            std::thread::sleep(Duration::from_millis(100));
        }
        if let Err(error) = std::fs::remove_file(&trigger) {
            eprintln!("[overlay-replay] trigger removal failed: {error}");
            return;
        }

        let start = Instant::now();
        let mut last_phase = "";
        let mut last_word = 0;
        while start.elapsed() < Duration::from_secs(30) {
            let elapsed = start.elapsed().as_secs_f64();
            let phase = if elapsed < 10.0 {
                "fixed-text-moving-wave"
            } else if elapsed < 20.0 {
                "fixed-text-silent-wave"
            } else {
                "updating-text-moving-wave"
            };
            if phase != last_phase {
                eprintln!(
                    "[overlay-replay] phase={} timestamp_ms={} elapsed_ms={}",
                    phase,
                    timestamp_ms(),
                    start.elapsed().as_millis()
                );
                last_phase = phase;
            }
            let levels: Vec<f32> = (0..16)
                .map(|i| {
                    if (10.0..20.0).contains(&elapsed) {
                        0.0
                    } else {
                        (0.25 + 0.2 * (elapsed * 7.0 + i as f64 * 0.7).sin()) as f32
                    }
                })
                .collect();
            let _ = handle.emit_to("recording_overlay", "mic-level", levels);
            if elapsed >= 20.0 {
                let word = ((elapsed - 20.0) * 2.0) as usize + 1;
                if word != last_word {
                    let _ = StreamTextEvent {
                        committed: format!("Fixed diagnostic text. Update {word}."),
                        tentative: String::new(),
                    }
                    .emit(&handle);
                    last_word = word;
                }
            }
            std::thread::sleep(Duration::from_millis(33));
        }
        eprintln!("[overlay-replay] complete timestamp_ms={}", timestamp_ms());
        overlay::hide_recording_overlay(&handle);
    });
}
