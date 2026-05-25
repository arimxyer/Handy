use crate::actions::{post_process_transcription, process_transcription_output};
use crate::managers::{
    history::{HistoryEntry, HistoryManager, PaginatedHistory, TranscriptionVersion},
    transcription::TranscriptionManager,
};
use crate::settings::LLMPrompt;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn get_history_entries(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    source: Option<String>,
    cursor: Option<i64>,
    limit: Option<usize>,
) -> Result<PaginatedHistory, String> {
    history_manager
        .get_history_entries(source.as_deref(), cursor, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn toggle_history_entry_saved(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<HistoryEntry, String> {
    history_manager
        .toggle_saved_status(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_audio_file_path(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    file_name: String,
) -> Result<String, String> {
    let path = history_manager.get_audio_file_path(&file_name);
    path.to_str()
        .ok_or_else(|| "Invalid file path".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn delete_history_entry(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
) -> Result<(), String> {
    history_manager
        .delete_entry(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn retry_history_entry_transcription(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    transcription_manager: State<'_, Arc<TranscriptionManager>>,
    id: i64,
) -> Result<HistoryEntry, String> {
    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry {} not found", id))?;

    let audio_path = history_manager.get_audio_file_path(&entry.file_name);
    let samples = crate::audio_toolkit::read_wav_samples(&audio_path)
        .map_err(|e| format!("Failed to load audio: {}", e))?;

    if samples.is_empty() {
        return Err("Recording has no audio samples".to_string());
    }

    transcription_manager.initiate_model_load();

    let tm = Arc::clone(&transcription_manager);
    let transcription = tauri::async_runtime::spawn_blocking(move || tm.transcribe(samples))
        .await
        .map_err(|e| format!("Transcription task panicked: {}", e))?
        .map_err(|e| e.to_string())?;

    if transcription.is_empty() {
        return Err("Recording contains no speech".to_string());
    }

    let processed =
        process_transcription_output(&app, &transcription, entry.post_process_requested).await;
    history_manager
        .update_transcription(
            id,
            transcription,
            processed.post_processed_text,
            processed.post_process_prompt,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_limit(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    limit: usize,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_limit = limit;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn update_recording_retention_period(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    period: String,
) -> Result<(), String> {
    use crate::settings::RecordingRetentionPeriod;

    let retention_period = match period.as_str() {
        "never" => RecordingRetentionPeriod::Never,
        "preserve_limit" => RecordingRetentionPeriod::PreserveLimit,
        "days3" => RecordingRetentionPeriod::Days3,
        "weeks2" => RecordingRetentionPeriod::Weeks2,
        "months3" => RecordingRetentionPeriod::Months3,
        _ => return Err(format!("Invalid retention period: {}", period)),
    };

    let mut settings = crate::settings::get_settings(&app);
    settings.recording_retention_period = retention_period;
    crate::settings::write_settings(&app, settings);

    history_manager
        .cleanup_old_entries()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn change_history_post_process_enabled_setting(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app);
    settings.history_post_process_enabled = enabled;
    crate::settings::write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn post_process_history_entry(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    override_provider_id: Option<String>,
    override_base_url: Option<String>,
    override_api_key: Option<String>,
    override_model_id: Option<String>,
    override_prompt_text: Option<String>,
    update_entry: Option<bool>,
) -> Result<HistoryEntry, String> {
    // Enforce three-level feature gate on the backend
    let settings = crate::settings::get_settings(&app);
    if !settings.experimental_enabled
        || !settings.post_process_enabled
        || !settings.history_post_process_enabled
    {
        return Err("HISTORY_POST_PROCESS_DISABLED".to_string());
    }

    // Get the history entry
    let entry = history_manager
        .get_entry_by_id(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("History entry {} not found", id))?;

    if entry.transcription_text.trim().is_empty() {
        return Err("TRANSCRIPTION_EMPTY".to_string());
    }

    // Build effective settings by applying drawer overrides on top of persisted settings
    let mut effective_settings = settings.clone();

    if let Some(ref provider_id) = override_provider_id {
        effective_settings.post_process_provider_id = provider_id.clone();
    }

    let effective_provider_id = effective_settings.post_process_provider_id.clone();

    if let Some(ref base_url) = override_base_url {
        if let Some(provider) = effective_settings.post_process_provider_mut(&effective_provider_id)
        {
            provider.base_url = base_url.clone();
        }
    }

    if let Some(ref api_key) = override_api_key {
        effective_settings
            .post_process_api_keys
            .insert(effective_provider_id.clone(), api_key.clone());
    }

    if let Some(ref model_id) = override_model_id {
        effective_settings
            .post_process_models
            .insert(effective_provider_id.clone(), model_id.clone());
    }

    // For prompt text override, inject a synthetic prompt into the settings
    // so that post_process_transcription picks it up via the normal path.
    if let Some(ref prompt_text) = override_prompt_text {
        let synthetic_id = "__drawer_override__".to_string();
        effective_settings.post_process_prompts.push(LLMPrompt {
            id: synthetic_id.clone(),
            name: "Drawer Override".to_string(),
            prompt: prompt_text.clone(),
        });
        effective_settings.post_process_selected_prompt_id = Some(synthetic_id);
    }

    // Run post-processing with effective settings
    let processed_text = post_process_transcription(&effective_settings, &entry.transcription_text)
        .await
        .ok_or_else(|| "POST_PROCESS_FAILED".to_string())?;

    // Determine the prompt text that was used (for version history)
    let effective_prompt_text = if let Some(ref prompt_text) = override_prompt_text {
        prompt_text.clone()
    } else {
        effective_settings
            .post_process_selected_prompt_id
            .as_ref()
            .and_then(|prompt_id| {
                effective_settings
                    .post_process_prompts
                    .iter()
                    .find(|p| &p.id == prompt_id)
                    .map(|p| p.prompt.clone())
            })
            .unwrap_or_default()
    };

    // Save version and update entry atomically
    let effective_model_id = effective_settings
        .post_process_models
        .get(&effective_provider_id)
        .map(|s| s.as_str());
    if update_entry.unwrap_or(true) {
        history_manager
            .save_version_and_update(
                id,
                &processed_text,
                &effective_prompt_text,
                effective_model_id,
            )
            .map_err(|e| e.to_string())
    } else {
        history_manager
            .save_version(
                id,
                &processed_text,
                &effective_prompt_text,
                effective_model_id,
            )
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn restore_version(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    entry_id: i64,
    version_id: Option<i64>,
) -> Result<HistoryEntry, String> {
    history_manager
        .restore_version(entry_id, version_id)
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("VERSION_NOT_FOUND") {
                "VERSION_NOT_FOUND".to_string()
            } else {
                msg
            }
        })
}

#[tauri::command]
#[specta::specta]
pub async fn get_transcription_versions(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    entry_id: i64,
) -> Result<Vec<TranscriptionVersion>, String> {
    history_manager
        .get_versions(entry_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn update_history_entry_text(
    _app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
    id: i64,
    field: String,
    new_text: String,
) -> Result<HistoryEntry, String> {
    let target = match field.as_str() {
        "transcription" | "post_processed" => field.as_str(),
        _ => return Err(format!("Invalid field: {}", field)),
    };

    history_manager
        .update_entry_text(id, target, &new_text)
        .map_err(|e| e.to_string())
}
