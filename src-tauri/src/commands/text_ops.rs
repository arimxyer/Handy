use crate::managers::history::{DocumentTab, HistoryEntry, HistoryManager};
use crate::picker::TextOpsPendingText;
use crate::settings::{get_settings, write_settings, LLMPrompt, TextOpsOutputBehavior};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
#[specta::specta]
pub async fn process_text(
    text: String,
    prompt_id: String,
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<String, String> {
    let settings = get_settings(&app);
    let prompt = settings
        .text_ops_prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or_else(|| format!("Prompt with id '{}' not found", prompt_id))?;

    process_text_with_prompt_impl(
        text,
        prompt.prompt.clone(),
        prompt.name.clone(),
        false,
        app,
        history_manager.inner().as_ref(),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn process_text_with_prompt(
    text: String,
    prompt: String,
    prompt_name: Option<String>,
    skip_history_save: Option<bool>,
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<String, String> {
    let prompt_name = prompt_name
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Custom Instructions".to_string());

    process_text_with_prompt_impl(
        text,
        prompt,
        prompt_name,
        skip_history_save.unwrap_or(false),
        app,
        history_manager.inner().as_ref(),
    )
    .await
}

async fn process_text_with_prompt_impl(
    text: String,
    prompt: String,
    prompt_name: String,
    skip_history_save: bool,
    app: AppHandle,
    history_manager: &HistoryManager,
) -> Result<String, String> {
    let settings = get_settings(&app);

    let provider = settings
        .active_text_ops_provider()
        .ok_or_else(|| "No active text ops provider configured".to_string())?
        .clone();

    let model = settings
        .text_ops_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model selected for text operations provider".to_string());
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let system_prompt = prompt.replace("${output}", "").trim().to_string();
    let result = crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.clone(),
        Some(system_prompt),
        None,
        true,
    )
    .await
    .map_err(|e| {
        crate::overlay::hide_recording_overlay(&app);
        crate::tray::set_tray_state(&app, crate::tray::TrayIconState::Idle);
        e
    })?;

    let result_text = result.ok_or_else(|| {
        crate::overlay::hide_recording_overlay(&app);
        crate::tray::set_tray_state(&app, crate::tray::TrayIconState::Idle);
        "No content returned from provider".to_string()
    })?;

    if !skip_history_save {
        if let Err(e) = history_manager.save_text_operation(text, result_text.clone(), prompt_name)
        {
            log::error!("Failed to save text operation to history: {}", e);
        }
    }

    Ok(result_text)
}

#[tauri::command]
#[specta::specta]
pub fn add_text_ops_prompt(
    name: String,
    prompt: String,
    app: AppHandle,
) -> Result<LLMPrompt, String> {
    let mut settings = get_settings(&app);

    let id = format!("text_ops_prompt_{}", chrono::Utc::now().timestamp_millis());

    let new_prompt = LLMPrompt {
        id: id.clone(),
        name,
        prompt,
    };

    settings.text_ops_prompts.push(new_prompt.clone());
    write_settings(&app, settings);

    Ok(new_prompt)
}

#[tauri::command]
#[specta::specta]
pub fn update_text_ops_prompt(
    id: String,
    name: String,
    prompt: String,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = get_settings(&app);

    if let Some(existing) = settings.text_ops_prompts.iter_mut().find(|p| p.id == id) {
        existing.name = name;
        existing.prompt = prompt;
        write_settings(&app, settings);
        Ok(())
    } else {
        Err(format!("Prompt with id '{}' not found", id))
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_text_ops_prompt(id: String, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);

    let original_len = settings.text_ops_prompts.len();
    settings.text_ops_prompts.retain(|p| p.id != id);

    if settings.text_ops_prompts.len() == original_len {
        return Err(format!("Prompt with id '{}' not found", id));
    }

    // If the deleted prompt was selected, clear the selection
    if settings.text_ops_selected_prompt_id.as_ref() == Some(&id) {
        settings.text_ops_selected_prompt_id =
            settings.text_ops_prompts.first().map(|p| p.id.clone());
    }

    // If the deleted prompt was pinned, clear the pin
    if settings.text_ops_pinned_prompt_id.as_ref() == Some(&id) {
        settings.text_ops_pinned_prompt_id = None;
    }

    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_provider_setting(provider_id: String, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_provider_id = provider_id;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_model_setting(
    provider_id: String,
    model: String,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_models.insert(provider_id, model);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_text_ops_selected_prompt(prompt_id: String, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_selected_prompt_id = Some(prompt_id);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn set_text_ops_pinned_prompt(prompt_id: String, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_pinned_prompt_id = Some(prompt_id);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_enabled_setting(enabled: bool, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_enabled = enabled;
    write_settings(&app, settings.clone());

    // Register or unregister the text ops shortcuts
    for key in &["text_ops", "text_ops_picker"] {
        if let Some(binding) = settings.bindings.get(*key).cloned() {
            if enabled {
                let _ = crate::shortcut::register_shortcut(&app, binding);
            } else {
                let _ = crate::shortcut::unregister_shortcut(&app, binding);
            }
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_output_behavior(behavior: String, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_output_behavior = match behavior.as_str() {
        "copy_to_clipboard" => TextOpsOutputBehavior::CopyToClipboard,
        "replace_selection" => TextOpsOutputBehavior::ReplaceSelection,
        _ => return Err(format!("Unknown text ops output behavior: {}", behavior)),
    };
    write_settings(&app, settings);
    Ok(())
}

/// Called by the picker frontend when user selects a prompt.
/// Processes the pending text with the chosen prompt.
#[tauri::command]
#[specta::specta]
pub async fn execute_picker_prompt(
    prompt_id: String,
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<(), String> {
    // Hide picker immediately
    crate::picker::hide_prompt_picker(&app);

    // Get pending text
    let pending_text = {
        let state = app.state::<TextOpsPendingText>();
        let mut guard = state.0.lock().map_err(|e| format!("Lock error: {}", e))?;
        guard.take()
    };

    let text = pending_text.ok_or_else(|| "No pending text for picker".to_string())?;

    let settings = get_settings(&app);

    let provider = settings
        .active_text_ops_provider()
        .ok_or_else(|| "No active text ops provider configured".to_string())?
        .clone();

    let model = settings
        .text_ops_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model selected for text operations provider".to_string());
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let prompt = settings
        .text_ops_prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or_else(|| format!("Prompt with id '{}' not found", prompt_id))?;

    let prompt_name = prompt.name.clone();
    let system_prompt = prompt.prompt.replace("${output}", "").trim().to_string();
    // Show processing overlay
    crate::overlay::show_text_processing_overlay(&app);
    crate::tray::set_tray_state(&app, crate::tray::TrayIconState::Transcribing);

    let result = crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.clone(),
        Some(system_prompt),
        None,
        true,
    )
    .await?;

    let result_text = result.ok_or_else(|| "No content returned from provider".to_string())?;

    log::info!(
        "Picker text ops: LLM returned {} chars, output behavior: {:?}",
        result_text.len(),
        settings.text_ops_output_behavior
    );

    // Save to history
    if let Err(e) = history_manager.save_text_operation(text, result_text.clone(), prompt_name) {
        log::error!("Failed to save text operation to history: {}", e);
    }

    // Output based on behavior setting
    match settings.text_ops_output_behavior {
        TextOpsOutputBehavior::CopyToClipboard => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            #[cfg(target_os = "linux")]
            if crate::utils::is_wayland() {
                let status = std::process::Command::new("wl-copy")
                    .arg("--")
                    .arg(&result_text)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status();
                if status.map(|s| s.success()).unwrap_or(false) {
                    log::info!("Picker text ops: result copied to clipboard via wl-copy");
                } else {
                    let _ = app.clipboard().write_text(&result_text);
                }
            } else {
                let _ = app.clipboard().write_text(&result_text);
            }
            #[cfg(not(target_os = "linux"))]
            let _ = app.clipboard().write_text(&result_text);

            crate::overlay::hide_recording_overlay(&app);
            crate::tray::set_tray_state(&app, crate::tray::TrayIconState::Idle);
        }
        TextOpsOutputBehavior::ReplaceSelection => {
            let ah = app.clone();
            app.run_on_main_thread(move || {
                match crate::utils::paste(result_text, ah.clone()) {
                    Ok(()) => log::info!("Picker text ops: result pasted (replaced selection)"),
                    Err(e) => log::error!("Failed to paste picker text ops result: {}", e),
                }
                crate::overlay::hide_recording_overlay(&ah);
                crate::tray::set_tray_state(&ah, crate::tray::TrayIconState::Idle);
            })
            .map_err(|e| {
                crate::overlay::hide_recording_overlay(&app);
                crate::tray::set_tray_state(&app, crate::tray::TrayIconState::Idle);
                format!("Failed to run paste on main thread: {:?}", e)
            })?;
        }
    }

    Ok(())
}

/// Called by the picker frontend to dismiss without selecting.
#[tauri::command]
#[specta::specta]
pub fn dismiss_picker(app: AppHandle) -> Result<(), String> {
    crate::picker::hide_prompt_picker(&app);
    // Clear pending text
    if let Some(state) = app.try_state::<TextOpsPendingText>() {
        if let Ok(mut pending) = state.0.lock() {
            *pending = None;
        }
    }
    Ok(())
}

// --- Document Tab Commands ---

#[tauri::command]
#[specta::specta]
pub fn create_document_tab(
    title: Option<String>,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<DocumentTab, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let title = title.unwrap_or_else(|| "Untitled".to_string());
    history_manager
        .create_document_tab(id, title)
        .map_err(|e| format!("Failed to create tab: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn get_open_tabs(
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Vec<DocumentTab>, String> {
    history_manager
        .get_open_tabs()
        .map_err(|e| format!("Failed to get tabs: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn get_document_tab(
    id: String,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Option<DocumentTab>, String> {
    history_manager
        .get_document_tab(&id)
        .map_err(|e| format!("Failed to get tab: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn update_document_tab(
    id: String,
    content: String,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<(), String> {
    history_manager
        .update_document_tab(&id, &content)
        .map_err(|e| format!("Failed to update tab: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn rename_document_tab(
    id: String,
    title: String,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<(), String> {
    history_manager
        .rename_document_tab(&id, &title)
        .map_err(|e| format!("Failed to rename tab: {}", e))
}

#[tauri::command]
#[specta::specta]
pub fn close_document_tab(
    id: String,
    archive: bool,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<Option<HistoryEntry>, String> {
    history_manager
        .close_document_tab(&id, archive)
        .map_err(|e| format!("Failed to close tab: {}", e))
}

// --- New Settings Commands ---

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_autosave_setting(enabled: bool, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_autosave_enabled = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_autosave_delay_setting(delay_ms: u64, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_autosave_delay_ms = delay_ms;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_confirm_tab_close_setting(
    enabled: bool,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_confirm_tab_close = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_auto_archive_setting(enabled: bool, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_auto_archive_on_close = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_shortcut_creates_tab_setting(
    enabled: bool,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_shortcut_creates_tab = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_ai_position_setting(
    position: crate::settings::TextOpsAiPosition,
    app: AppHandle,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_ai_position = position;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_text_ops_auto_label_setting(enabled: bool, app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.text_ops_auto_label_enabled = enabled;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn ensure_tab_history_entry(
    tab_id: String,
    initial_text: String,
    history_manager: tauri::State<'_, std::sync::Arc<crate::managers::history::HistoryManager>>,
) -> Result<i64, String> {
    history_manager
        .ensure_tab_history_entry(&tab_id, &initial_text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn save_tab_version(
    tab_id: String,
    text: String,
    prompt: String,
    model_name: Option<String>,
    history_manager: tauri::State<'_, std::sync::Arc<crate::managers::history::HistoryManager>>,
) -> Result<i64, String> {
    history_manager
        .save_tab_version(&tab_id, &text, &prompt, model_name.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn generate_tab_label(text: String, app: AppHandle) -> Result<String, String> {
    let settings = get_settings(&app);

    let provider = settings
        .active_text_ops_provider()
        .ok_or_else(|| "No active text ops provider configured".to_string())?
        .clone();

    let model = settings
        .text_ops_models
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    if model.is_empty() {
        return Err("No model selected for text operations provider".to_string());
    }

    let api_key = settings
        .post_process_api_keys
        .get(&provider.id)
        .cloned()
        .unwrap_or_default();

    let truncated = if text.len() > 500 {
        &text[..500]
    } else {
        &text
    };

    let system_prompt = "Generate a concise 2-5 word title for this text. Return ONLY the title, no quotes or punctuation.".to_string();

    let result = crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        truncated.to_string(),
        Some(system_prompt),
        None,
        true,
    )
    .await
    .map_err(|e| e)?;

    result.ok_or_else(|| "No content returned from provider".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn mark_tab_auto_labeled(
    id: String,
    history_manager: tauri::State<'_, std::sync::Arc<crate::managers::history::HistoryManager>>,
) -> Result<(), String> {
    history_manager
        .mark_tab_auto_labeled(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn link_tab_to_history_entry(
    tab_id: String,
    entry_id: i64,
    history_manager: tauri::State<'_, std::sync::Arc<crate::managers::history::HistoryManager>>,
) -> Result<(), String> {
    history_manager
        .link_tab_to_history_entry(&tab_id, entry_id)
        .map_err(|e| e.to_string())
}
