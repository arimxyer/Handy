#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
use crate::apple_intelligence;
use crate::audio_feedback::{play_feedback_sound, play_feedback_sound_blocking, SoundType};
use crate::audio_toolkit::{is_microphone_access_denied, is_no_input_device_error};
use crate::managers::audio::AudioRecordingManager;
use crate::managers::history::HistoryManager;
use crate::managers::transcription::TranscriptionManager;
use crate::settings::{get_settings, AppSettings, APPLE_INTELLIGENCE_PROVIDER_ID};
use crate::shortcut;
use crate::tray::{change_tray_icon, TrayIconState};
use crate::utils::{
    self, show_processing_overlay, show_recording_overlay, show_text_processing_overlay,
    show_transcribing_overlay,
};
use crate::TranscriptionCoordinator;
use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct RecordingErrorEvent {
    error_type: String,
    detail: Option<String>,
}

/// Drop guard that notifies the [`TranscriptionCoordinator`] when the
/// transcription pipeline finishes — whether it completes normally or panics.
struct FinishGuard(AppHandle);
impl Drop for FinishGuard {
    fn drop(&mut self) {
        if let Some(c) = self.0.try_state::<TranscriptionCoordinator>() {
            c.notify_processing_finished();
        }
    }
}

// Shortcut Action Trait
pub trait ShortcutAction: Send + Sync {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str);
}

// Transcribe Action
struct TranscribeAction {
    post_process: bool,
}

/// Field name for structured output JSON schema
const TRANSCRIPTION_FIELD: &str = "transcription";

/// Strip invisible Unicode characters that some LLMs may insert
fn strip_invisible_chars(s: &str) -> String {
    s.replace(['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'], "")
}

/// Build a system prompt from the user's prompt template.
/// Removes `${output}` placeholder since the transcription is sent as the user message.
fn build_system_prompt(prompt_template: &str) -> String {
    prompt_template.replace("${output}", "").trim().to_string()
}

pub async fn post_process_transcription(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    let provider = match settings.active_post_process_provider().cloned() {
        Some(provider) => provider,
        None => {
            debug!("Post-processing enabled but no provider is selected");
            return None;
        }
    };

    let model = settings
        .post_process_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.trim().is_empty() {
        debug!(
            "Post-processing skipped because provider '{}' has no model configured",
            provider.id
        );
        return None;
    }

    let selected_prompt_id = match &settings.post_process_selected_prompt_id {
        Some(id) => id.clone(),
        None => {
            debug!("Post-processing skipped because no prompt is selected");
            return None;
        }
    };

    let prompt = match settings
        .post_process_prompts
        .iter()
        .find(|prompt| prompt.id == selected_prompt_id)
    {
        Some(prompt) => prompt.prompt.clone(),
        None => {
            debug!(
                "Post-processing skipped because prompt '{}' was not found",
                selected_prompt_id
            );
            return None;
        }
    };

    if prompt.trim().is_empty() {
        debug!("Post-processing skipped because the selected prompt is empty");
        return None;
    }

    debug!(
        "Starting LLM post-processing with provider '{}' (model: {})",
        provider.id, model
    );

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    // Disable reasoning for providers where post-processing rarely benefits from it.
    // - custom: top-level reasoning_effort (works for local OpenAI-compat servers)
    // - openrouter: nested reasoning object; exclude:true also keeps reasoning text
    //   out of the response so it can't pollute structured-output JSON parsing
    let (reasoning_effort, reasoning) = match provider.id.as_str() {
        "custom" => (Some("none".to_string()), None),
        "openrouter" => (
            None,
            Some(crate::llm_client::ReasoningConfig {
                effort: Some("none".to_string()),
                exclude: Some(true),
            }),
        ),
        _ => (None, None),
    };

    if provider.supports_structured_output {
        debug!("Using structured outputs for provider '{}'", provider.id);

        let system_prompt = build_system_prompt(&prompt);
        let user_content = transcription.to_string();

        // Handle Apple Intelligence separately since it uses native Swift APIs
        if provider.id == APPLE_INTELLIGENCE_PROVIDER_ID {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            {
                if !apple_intelligence::check_apple_intelligence_availability() {
                    debug!(
                        "Apple Intelligence selected but not currently available on this device"
                    );
                    return None;
                }

                let token_limit = model.trim().parse::<i32>().unwrap_or(0);
                return match apple_intelligence::process_text_with_system_prompt(
                    &system_prompt,
                    &user_content,
                    token_limit,
                ) {
                    Ok(result) => {
                        if result.trim().is_empty() {
                            debug!("Apple Intelligence returned an empty response");
                            None
                        } else {
                            let result = strip_invisible_chars(&result);
                            debug!(
                                "Apple Intelligence post-processing succeeded. Output length: {} chars",
                                result.len()
                            );
                            Some(result)
                        }
                    }
                    Err(err) => {
                        error!("Apple Intelligence post-processing failed: {}", err);
                        None
                    }
                };
            }

            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            {
                debug!("Apple Intelligence provider selected on unsupported platform");
                return None;
            }
        }

        // Define JSON schema for transcription output
        let json_schema = serde_json::json!({
            "type": "object",
            "properties": {
                (TRANSCRIPTION_FIELD): {
                    "type": "string",
                    "description": "The cleaned and processed transcription text"
                }
            },
            "required": [TRANSCRIPTION_FIELD],
            "additionalProperties": false
        });

        match crate::llm_client::send_chat_completion_with_schema(
            &provider,
            api_key.clone(),
            &model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
            reasoning_effort.clone(),
            reasoning.clone(),
        )
        .await
        {
            Ok(Some(content)) => {
                // Parse the JSON response to extract the transcription field
                match serde_json::from_str::<serde_json::Value>(&content) {
                    Ok(json) => {
                        if let Some(transcription_value) =
                            json.get(TRANSCRIPTION_FIELD).and_then(|t| t.as_str())
                        {
                            let result = strip_invisible_chars(transcription_value);
                            debug!(
                                "Structured output post-processing succeeded for provider '{}'. Output length: {} chars",
                                provider.id,
                                result.len()
                            );
                            return Some(result);
                        } else {
                            error!("Structured output response missing 'transcription' field");
                            return Some(strip_invisible_chars(&content));
                        }
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse structured output JSON: {}. Returning raw content.",
                            e
                        );
                        return Some(strip_invisible_chars(&content));
                    }
                }
            }
            Ok(None) => {
                error!("LLM API response has no content");
                return None;
            }
            Err(e) => {
                warn!(
                    "Structured output failed for provider '{}': {}. Falling back to legacy mode.",
                    provider.id, e
                );
                // Fall through to legacy mode below
            }
        }
    }

    // Legacy mode: Replace ${output} variable in the prompt with the actual text
    let processed_prompt = prompt.replace("${output}", transcription);
    debug!("Processed prompt length: {} chars", processed_prompt.len());

    match crate::llm_client::send_chat_completion(
        &provider,
        api_key,
        &model,
        processed_prompt,
        reasoning_effort,
        reasoning,
    )
    .await
    {
        Ok(Some(content)) => {
            let content = strip_invisible_chars(&content);
            debug!(
                "LLM post-processing succeeded for provider '{}'. Output length: {} chars",
                provider.id,
                content.len()
            );
            Some(content)
        }
        Ok(None) => {
            error!("LLM API response has no content");
            None
        }
        Err(e) => {
            error!(
                "LLM post-processing failed for provider '{}': {}. Falling back to original transcription.",
                provider.id,
                e
            );
            None
        }
    }
}

async fn maybe_convert_chinese_variant(
    settings: &AppSettings,
    transcription: &str,
) -> Option<String> {
    // Check if language is set to Simplified or Traditional Chinese
    let is_simplified = settings.selected_language == "zh-Hans";
    let is_traditional = settings.selected_language == "zh-Hant";

    if !is_simplified && !is_traditional {
        debug!("selected_language is not Simplified or Traditional Chinese; skipping translation");
        return None;
    }

    debug!(
        "Starting Chinese translation using OpenCC for language: {}",
        settings.selected_language
    );

    // Use OpenCC to convert based on selected language
    let config = if is_simplified {
        // Convert Traditional Chinese to Simplified Chinese
        BuiltinConfig::Tw2sp
    } else {
        // Convert Simplified Chinese to Traditional Chinese
        BuiltinConfig::S2tw
    };

    match OpenCC::from_config(config) {
        Ok(converter) => {
            let converted = converter.convert(transcription);
            debug!(
                "OpenCC translation completed. Input length: {}, Output length: {}",
                transcription.len(),
                converted.len()
            );
            Some(converted)
        }
        Err(e) => {
            error!("Failed to initialize OpenCC converter: {}. Falling back to original transcription.", e);
            None
        }
    }
}

pub(crate) struct ProcessedTranscription {
    pub final_text: String,
    pub post_processed_text: Option<String>,
    pub post_process_prompt: Option<String>,
}

pub(crate) async fn process_transcription_output(
    app: &AppHandle,
    transcription: &str,
    post_process: bool,
) -> ProcessedTranscription {
    let settings = get_settings(app);
    let mut final_text = transcription.to_string();
    let mut post_processed_text: Option<String> = None;
    let mut post_process_prompt: Option<String> = None;

    if let Some(converted_text) = maybe_convert_chinese_variant(&settings, transcription).await {
        final_text = converted_text;
    }

    if post_process {
        if let Some(processed_text) = post_process_transcription(&settings, &final_text).await {
            post_processed_text = Some(processed_text.clone());
            final_text = processed_text;

            if let Some(prompt_id) = &settings.post_process_selected_prompt_id {
                if let Some(prompt) = settings
                    .post_process_prompts
                    .iter()
                    .find(|prompt| &prompt.id == prompt_id)
                {
                    post_process_prompt = Some(prompt.prompt.clone());
                }
            }
        }
    } else if final_text != transcription {
        post_processed_text = Some(final_text.clone());
    }

    ProcessedTranscription {
        final_text,
        post_processed_text,
        post_process_prompt,
    }
}

impl ShortcutAction for TranscribeAction {
    fn start(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        let start_time = Instant::now();
        debug!("TranscribeAction::start called for binding: {}", binding_id);

        // Load model in the background
        let tm = app.state::<Arc<TranscriptionManager>>();
        let rm = app.state::<Arc<AudioRecordingManager>>();

        // Load ASR model and VAD model in parallel
        tm.initiate_model_load();
        let rm_clone = Arc::clone(&rm);
        std::thread::spawn(move || {
            if let Err(e) = rm_clone.preload_vad() {
                debug!("VAD pre-load failed: {}", e);
            }
        });

        let binding_id = binding_id.to_string();
        change_tray_icon(app, TrayIconState::Recording);
        show_recording_overlay(app);

        // Get the microphone mode to determine audio feedback timing
        let settings = get_settings(app);
        let is_always_on = settings.always_on_microphone;
        debug!("Microphone mode - always_on: {}", is_always_on);

        let mut recording_error: Option<String> = None;
        if is_always_on {
            // Always-on mode: Play audio feedback immediately, then apply mute after sound finishes
            debug!("Always-on mode: Playing audio feedback immediately");
            let rm_clone = Arc::clone(&rm);
            let app_clone = app.clone();
            // The blocking helper exits immediately if audio feedback is disabled,
            // so we can always reuse this thread to ensure mute happens right after playback.
            std::thread::spawn(move || {
                play_feedback_sound_blocking(&app_clone, SoundType::Start);
                rm_clone.apply_mute();
            });

            if let Err(e) = rm.try_start_recording(&binding_id) {
                debug!("Recording failed: {}", e);
                recording_error = Some(e);
            }
        } else {
            // On-demand mode: Start recording first, then play audio feedback, then apply mute
            // This allows the microphone to be activated before playing the sound
            debug!("On-demand mode: Starting recording first, then audio feedback");
            let recording_start_time = Instant::now();
            match rm.try_start_recording(&binding_id) {
                Ok(()) => {
                    debug!("Recording started in {:?}", recording_start_time.elapsed());
                    // Small delay to ensure microphone stream is active
                    let app_clone = app.clone();
                    let rm_clone = Arc::clone(&rm);
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        debug!("Handling delayed audio feedback/mute sequence");
                        // Helper handles disabled audio feedback by returning early, so we reuse it
                        // to keep mute sequencing consistent in every mode.
                        play_feedback_sound_blocking(&app_clone, SoundType::Start);
                        rm_clone.apply_mute();
                    });
                }
                Err(e) => {
                    debug!("Failed to start recording: {}", e);
                    recording_error = Some(e);
                }
            }
        }

        if recording_error.is_none() {
            // Dynamically register the cancel shortcut in a separate task to avoid deadlock
            shortcut::register_cancel_shortcut(app);
        } else {
            // Starting failed (for example due to blocked microphone permissions).
            // Revert UI state so we don't stay stuck in the recording overlay.
            utils::hide_recording_overlay(app);
            change_tray_icon(app, TrayIconState::Idle);
            if let Some(err) = recording_error {
                let error_type = if is_microphone_access_denied(&err) {
                    "microphone_permission_denied"
                } else if is_no_input_device_error(&err) {
                    "no_input_device"
                } else {
                    "unknown"
                };
                let _ = app.emit(
                    "recording-error",
                    RecordingErrorEvent {
                        error_type: error_type.to_string(),
                        detail: Some(err),
                    },
                );
            }
        }

        debug!(
            "TranscribeAction::start completed in {:?}",
            start_time.elapsed()
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, _shortcut_str: &str) {
        // Unregister the cancel shortcut when transcription stops
        shortcut::unregister_cancel_shortcut(app);

        let stop_time = Instant::now();
        debug!("TranscribeAction::stop called for binding: {}", binding_id);

        let ah = app.clone();
        let rm = Arc::clone(&app.state::<Arc<AudioRecordingManager>>());
        let tm = Arc::clone(&app.state::<Arc<TranscriptionManager>>());
        let hm = Arc::clone(&app.state::<Arc<HistoryManager>>());

        change_tray_icon(app, TrayIconState::Transcribing);
        show_transcribing_overlay(app);

        // Unmute before playing audio feedback so the stop sound is audible
        rm.remove_mute();

        // Play audio feedback for recording stop
        play_feedback_sound(app, SoundType::Stop);

        let binding_id = binding_id.to_string(); // Clone binding_id for the async task
        let post_process = self.post_process;

        tauri::async_runtime::spawn(async move {
            let _guard = FinishGuard(ah.clone());
            debug!(
                "Starting async transcription task for binding: {}",
                binding_id
            );

            let stop_recording_time = Instant::now();
            if let Some(samples) = rm.stop_recording(&binding_id) {
                debug!(
                    "Recording stopped and samples retrieved in {:?}, sample count: {}",
                    stop_recording_time.elapsed(),
                    samples.len()
                );

                if samples.is_empty() {
                    debug!("Recording produced no audio samples; skipping persistence");
                    utils::hide_recording_overlay(&ah);
                    change_tray_icon(&ah, TrayIconState::Idle);
                } else {
                    // Save WAV concurrently with transcription
                    let sample_count = samples.len();
                    let file_name = format!("handy-{}.wav", chrono::Utc::now().timestamp());
                    let wav_path = hm.recordings_dir().join(&file_name);
                    let wav_path_for_verify = wav_path.clone();
                    let samples_for_wav = samples.clone();
                    let wav_handle = tauri::async_runtime::spawn_blocking(move || {
                        crate::audio_toolkit::save_wav_file(&wav_path, &samples_for_wav)
                    });

                    // Transcribe concurrently with WAV save
                    let transcription_time = Instant::now();
                    let transcription_result = tm.transcribe(samples);

                    // Await WAV save and verify
                    let wav_saved = match wav_handle.await {
                        Ok(Ok(())) => {
                            match crate::audio_toolkit::verify_wav_file(
                                &wav_path_for_verify,
                                sample_count,
                            ) {
                                Ok(()) => true,
                                Err(e) => {
                                    error!("WAV verification failed: {}", e);
                                    false
                                }
                            }
                        }
                        Ok(Err(e)) => {
                            error!("Failed to save WAV file: {}", e);
                            false
                        }
                        Err(e) => {
                            error!("WAV save task panicked: {}", e);
                            false
                        }
                    };

                    match transcription_result {
                        Ok(transcription) => {
                            debug!(
                                "Transcription completed in {:?}: '{}'",
                                transcription_time.elapsed(),
                                transcription
                            );

                            if post_process {
                                show_processing_overlay(&ah);
                            }
                            let processed =
                                process_transcription_output(&ah, &transcription, post_process)
                                    .await;

                            // Save to history if WAV was saved
                            if wav_saved {
                                if let Err(err) = hm.save_entry(
                                    file_name,
                                    transcription,
                                    post_process,
                                    processed.post_processed_text.clone(),
                                    processed.post_process_prompt.clone(),
                                ) {
                                    error!("Failed to save history entry: {}", err);
                                }
                            }

                            if processed.final_text.is_empty() {
                                utils::hide_recording_overlay(&ah);
                                change_tray_icon(&ah, TrayIconState::Idle);
                            } else {
                                let ah_clone = ah.clone();
                                let paste_time = Instant::now();
                                let final_text = processed.final_text;
                                ah.run_on_main_thread(move || {
                                    match utils::paste(final_text, ah_clone.clone()) {
                                        Ok(()) => debug!(
                                            "Text pasted successfully in {:?}",
                                            paste_time.elapsed()
                                        ),
                                        Err(e) => {
                                            error!("Failed to paste transcription: {}", e);
                                            let _ = ah_clone.emit("paste-error", ());
                                        }
                                    }
                                    utils::hide_recording_overlay(&ah_clone);
                                    change_tray_icon(&ah_clone, TrayIconState::Idle);
                                })
                                .unwrap_or_else(|e| {
                                    error!("Failed to run paste on main thread: {:?}", e);
                                    utils::hide_recording_overlay(&ah);
                                    change_tray_icon(&ah, TrayIconState::Idle);
                                });
                            }
                        }
                        Err(err) => {
                            debug!("Global Shortcut Transcription error: {}", err);
                            // Save entry with empty text so user can retry
                            if wav_saved {
                                if let Err(save_err) = hm.save_entry(
                                    file_name,
                                    String::new(),
                                    post_process,
                                    None,
                                    None,
                                ) {
                                    error!("Failed to save failed history entry: {}", save_err);
                                }
                            }
                            utils::hide_recording_overlay(&ah);
                            change_tray_icon(&ah, TrayIconState::Idle);
                        }
                    }
                }
            } else {
                debug!("No samples retrieved from recording stop");
                utils::hide_recording_overlay(&ah);
                change_tray_icon(&ah, TrayIconState::Idle);
            }
        });

        debug!(
            "TranscribeAction::stop completed in {:?}",
            stop_time.elapsed()
        );
    }
}

// Cancel Action
struct CancelAction;

impl ShortcutAction for CancelAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        utils::cancel_current_operation(app);
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for cancel
    }
}

// Test Action
struct TestAction;

impl ShortcutAction for TestAction {
    fn start(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Started - {} (App: {})", // Changed "Pressed" to "Started" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }

    fn stop(&self, app: &AppHandle, binding_id: &str, shortcut_str: &str) {
        log::info!(
            "Shortcut ID '{}': Stopped - {} (App: {})", // Changed "Released" to "Stopped" for consistency
            binding_id,
            shortcut_str,
            app.package_info().name
        );
    }
}

// Text Operations Action
struct TextOpsAction;

/// Write text to clipboard using the best available method.
fn write_text_to_clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if crate::utils::is_wayland() {
            // Use wl-copy on Wayland for reliability
            let status = std::process::Command::new("wl-copy")
                .arg("--")
                .arg(text)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map_err(|e| format!("Failed to execute wl-copy: {}", e))?;
            if status.success() {
                return Ok(());
            }
            // Fall through to Tauri clipboard
        }
    }
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))
}

/// Get the currently selected text. On Wayland, reads the primary selection
/// (which contains whatever is highlighted) without needing to simulate Ctrl+C.
/// Falls back to Ctrl+C copy approach on other platforms.
fn get_selected_text(app: &AppHandle) -> String {
    #[cfg(target_os = "linux")]
    {
        if crate::utils::is_wayland() {
            // Primary selection contains highlighted text without needing Ctrl+C
            match std::process::Command::new("wl-paste")
                .args(["--primary", "--no-newline"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    let text = String::from_utf8_lossy(&output.stdout).to_string();
                    if !text.trim().is_empty() {
                        info!("Text ops: got {} chars from primary selection", text.len());
                        return text;
                    }
                    info!("Text ops: primary selection is empty");
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!("Text ops: wl-paste --primary failed: {}", stderr.trim());
                }
                Err(e) => info!("Text ops: wl-paste not found: {}", e),
            }
        }
    }

    // Fallback: try Ctrl+C to copy selection into clipboard, then read it
    let original_clipboard = read_clipboard_text(app);
    if let Err(e) = send_copy_keystroke(app) {
        error!("Text ops: failed to send Ctrl+C: {}", e);
        return String::new();
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    let clipboard_text = read_clipboard_text(app);
    if clipboard_text == original_clipboard {
        info!("Text ops: clipboard unchanged after Ctrl+C");
        return String::new();
    }
    info!(
        "Text ops: got {} chars via Ctrl+C copy",
        clipboard_text.len()
    );
    clipboard_text
}

/// Read clipboard text, preferring wl-paste on Wayland for reliability.
fn read_clipboard_text(app: &AppHandle) -> String {
    #[cfg(target_os = "linux")]
    {
        if crate::utils::is_wayland() {
            if let Ok(output) = std::process::Command::new("wl-paste")
                .arg("--no-newline")
                .output()
            {
                if output.status.success() {
                    return String::from_utf8_lossy(&output.stdout).to_string();
                }
            }
        }
    }
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().unwrap_or_default()
}

/// Send Ctrl+C (or Cmd+C on macOS) using platform-appropriate tools.
/// On Linux Wayland, uses ydotool or other native tools instead of Enigo.
fn send_copy_keystroke(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if crate::utils::is_wayland() {
            // Try ydotool first (keycodes: ctrl=29, c=46)
            match std::process::Command::new("ydotool")
                .args(["key", "29:1", "46:1", "46:0", "29:0"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    info!("Text ops: sent Ctrl+C via ydotool");
                    return Ok(());
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!(
                        "Text ops: ydotool failed (exit {:?}): {}",
                        output.status.code(),
                        stderr.trim()
                    );
                }
                Err(e) => info!("Text ops: ydotool not found: {}", e),
            }
            // Try dotool
            match std::process::Command::new("sh")
                .arg("-c")
                .arg("echo key ctrl+c | dotool")
                .output()
            {
                Ok(output) if output.status.success() => {
                    info!("Text ops: sent Ctrl+C via dotool");
                    return Ok(());
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!(
                        "Text ops: dotool failed (exit {:?}): {}",
                        output.status.code(),
                        stderr.trim()
                    );
                }
                Err(e) => info!("Text ops: dotool not found: {}", e),
            }
            // Try wtype — may not work on KDE for text typing, but key combos might work
            match std::process::Command::new("wtype")
                .args(["-M", "ctrl", "-k", "c"])
                .output()
            {
                Ok(output) if output.status.success() => {
                    info!("Text ops: sent Ctrl+C via wtype");
                    return Ok(());
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    info!(
                        "Text ops: wtype failed (exit {:?}): {}",
                        output.status.code(),
                        stderr.trim()
                    );
                }
                Err(e) => info!("Text ops: wtype not found: {}", e),
            }
            // Fall through to Enigo as last resort
            info!("Text ops: no Wayland copy tool succeeded, trying Enigo");
        }
    }

    // macOS / Windows / X11 Linux fallback: use Enigo
    use crate::input::EnigoState;
    let enigo_state = app
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    let mut enigo = enigo_state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock Enigo: {}", e))?;

    use enigo::Keyboard;
    #[cfg(target_os = "macos")]
    let (modifier, c_key) = (enigo::Key::Meta, enigo::Key::Other(8));
    #[cfg(target_os = "windows")]
    let (modifier, c_key) = (enigo::Key::Control, enigo::Key::Other(0x43));
    #[cfg(target_os = "linux")]
    let (modifier, c_key) = (enigo::Key::Control, enigo::Key::Unicode('c'));

    enigo
        .key(modifier, enigo::Direction::Press)
        .map_err(|e| format!("Failed to press modifier: {}", e))?;
    enigo
        .key(c_key, enigo::Direction::Click)
        .map_err(|e| format!("Failed to click C key: {}", e))?;
    std::thread::sleep(std::time::Duration::from_millis(50));
    enigo
        .key(modifier, enigo::Direction::Release)
        .map_err(|e| format!("Failed to release modifier: {}", e))?;

    info!("Text ops: sent Ctrl+C via Enigo");
    Ok(())
}

impl ShortcutAction for TextOpsAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        info!("TextOpsAction::start triggered");
        let settings = get_settings(app);

        if !settings.text_ops_enabled {
            info!("Text ops shortcut pressed but feature is disabled");
            return;
        }

        // Get pinned prompt (fall back to selected, then first)
        let prompt = settings
            .text_ops_pinned_prompt_id
            .as_ref()
            .or(settings.text_ops_selected_prompt_id.as_ref())
            .and_then(|id| settings.text_ops_prompts.iter().find(|p| &p.id == id))
            .or_else(|| settings.text_ops_prompts.first());

        let prompt = match prompt {
            Some(p) => p.clone(),
            None => {
                info!("Text ops: no prompt available");
                return;
            }
        };

        let provider = match settings.active_text_ops_provider().cloned() {
            Some(p) => p,
            None => {
                info!("Text ops: no provider configured");
                return;
            }
        };

        let model = settings
            .text_ops_models
            .get(&provider.id)
            .cloned()
            .unwrap_or_default();

        if model.is_empty() {
            info!("Text ops: no model selected for provider '{}'", provider.id);
            return;
        }

        let api_key = settings
            .post_process_api_keys
            .get(&provider.id)
            .cloned()
            .unwrap_or_default();

        info!(
            "Text ops: using prompt '{}', provider '{}', model '{}'",
            prompt.name, provider.id, model
        );

        let output_behavior = settings.text_ops_output_behavior;
        let app_clone = app.clone();
        let prompt_name = prompt.name.clone();
        let system_prompt = prompt.prompt.replace("${output}", "").trim().to_string();
        let (reasoning_effort, reasoning) = match provider.id.as_str() {
            "custom" => (Some("none".to_string()), None),
            "openrouter" => (
                None,
                Some(crate::llm_client::ReasoningConfig {
                    effort: Some("none".to_string()),
                    exclude: Some(true),
                }),
            ),
            _ => (None, None),
        };

        // Copy selected text first (Ctrl+C), then read clipboard and process
        // This runs on a background thread so we can sleep without blocking
        std::thread::spawn(move || {
            // Try to get selected text — prefer primary selection (no Ctrl+C needed),
            // fall back to copying via keystroke
            let clipboard_text = get_selected_text(&app_clone);

            if clipboard_text.trim().is_empty() {
                info!("Text ops: no text selected, aborting");
                return;
            }

            info!(
                "Text ops: captured {} chars, sending to LLM",
                clipboard_text.len()
            );
            show_text_processing_overlay(&app_clone);
            change_tray_icon(&app_clone, TrayIconState::Transcribing);

            let app_for_task = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                let result = crate::llm_client::send_chat_completion_with_schema(
                    &provider,
                    api_key,
                    &model,
                    clipboard_text.clone(),
                    Some(system_prompt),
                    None,
                    reasoning_effort,
                    reasoning,
                )
                .await;

                match result {
                    Ok(Some(result_text)) => {
                        info!(
                            "Text ops: LLM returned {} chars, output behavior: {:?}",
                            result_text.len(),
                            output_behavior
                        );

                        // Save to history
                        if let Some(hm) = app_for_task.try_state::<Arc<HistoryManager>>() {
                            if let Err(e) = hm.save_text_operation(
                                clipboard_text,
                                result_text.clone(),
                                prompt_name,
                            ) {
                                error!("Failed to save text operation to history: {}", e);
                            }
                        }

                        // Output result based on behavior setting
                        use crate::settings::TextOpsOutputBehavior;
                        match output_behavior {
                            TextOpsOutputBehavior::CopyToClipboard => {
                                // Write result to clipboard only
                                if let Err(e) = write_text_to_clipboard(&app_for_task, &result_text)
                                {
                                    error!("Text ops: failed to copy to clipboard: {}", e);
                                } else {
                                    info!("Text ops: result copied to clipboard");
                                }
                                utils::hide_recording_overlay(&app_for_task);
                                change_tray_icon(&app_for_task, TrayIconState::Idle);
                            }
                            TextOpsOutputBehavior::ReplaceSelection => {
                                // Hide overlay first so the original app regains focus
                                utils::hide_recording_overlay(&app_for_task);
                                change_tray_icon(&app_for_task, TrayIconState::Idle);

                                // Small delay to let the original app regain focus
                                std::thread::sleep(std::time::Duration::from_millis(100));

                                // Paste over the selected text
                                let ah = app_for_task.clone();
                                app_for_task
                                    .run_on_main_thread(move || {
                                        match utils::paste(result_text, ah.clone()) {
                                            Ok(()) => info!(
                                                "Text ops: result pasted (replaced selection)"
                                            ),
                                            Err(e) => {
                                                error!("Failed to paste text ops result: {}", e)
                                            }
                                        }
                                    })
                                    .unwrap_or_else(|e| {
                                        error!("Failed to run paste on main thread: {:?}", e);
                                    });
                            }
                        }
                    }
                    Ok(None) => {
                        error!("Text ops: no content returned from provider");
                        utils::hide_recording_overlay(&app_for_task);
                        change_tray_icon(&app_for_task, TrayIconState::Idle);
                    }
                    Err(e) => {
                        error!("Text ops processing failed: {}", e);
                        utils::hide_recording_overlay(&app_for_task);
                        change_tray_icon(&app_for_task, TrayIconState::Idle);
                    }
                }
            });
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop for text ops
    }
}

// Text Operations Picker Action
struct TextOpsPickerAction;

impl ShortcutAction for TextOpsPickerAction {
    fn start(&self, app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        info!("TextOpsPickerAction::start triggered");
        let settings = get_settings(app);

        if !settings.text_ops_enabled {
            info!("Text ops picker shortcut pressed but feature is disabled");
            return;
        }

        let app_clone = app.clone();
        std::thread::spawn(move || {
            // Get selected text
            let selected_text = get_selected_text(&app_clone);
            if selected_text.trim().is_empty() {
                info!("Text ops picker: no text selected, aborting");
                return;
            }

            info!(
                "Text ops picker: got {} chars, showing picker",
                selected_text.len()
            );

            // Store pending text
            if let Some(state) = app_clone.try_state::<crate::picker::TextOpsPendingText>() {
                if let Ok(mut pending) = state.0.lock() {
                    *pending = Some(selected_text);
                }
            }

            // Show picker window
            crate::picker::show_prompt_picker(&app_clone);
        });
    }

    fn stop(&self, _app: &AppHandle, _binding_id: &str, _shortcut_str: &str) {
        // Nothing to do on stop
    }
}

// Static Action Map
pub static ACTION_MAP: Lazy<HashMap<String, Arc<dyn ShortcutAction>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    map.insert(
        "transcribe".to_string(),
        Arc::new(TranscribeAction {
            post_process: false,
        }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "transcribe_with_post_process".to_string(),
        Arc::new(TranscribeAction { post_process: true }) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "cancel".to_string(),
        Arc::new(CancelAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "test".to_string(),
        Arc::new(TestAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "text_ops".to_string(),
        Arc::new(TextOpsAction) as Arc<dyn ShortcutAction>,
    );
    map.insert(
        "text_ops_picker".to_string(),
        Arc::new(TextOpsPickerAction) as Arc<dyn ShortcutAction>,
    );
    map
});
