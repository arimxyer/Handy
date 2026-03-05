use crate::managers::history::HistoryManager;
use crate::settings::{get_settings, write_settings, LLMPrompt};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
#[specta::specta]
pub async fn process_text(
    text: String,
    prompt_id: String,
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
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

    let prompt = settings
        .text_ops_prompts
        .iter()
        .find(|p| p.id == prompt_id)
        .ok_or_else(|| format!("Prompt with id '{}' not found", prompt_id))?;

    let prompt_name = prompt.name.clone();

    // Strip ${output} placeholder from prompt template to get system prompt
    let system_prompt = prompt.prompt.replace("${output}", "").trim().to_string();

    let result = crate::llm_client::send_chat_completion_with_schema(
        &provider,
        api_key,
        &model,
        text.clone(),
        Some(system_prompt),
        None,
    )
    .await?;

    let result_text = result.ok_or_else(|| "No content returned from provider".to_string())?;

    // Save to history
    if let Err(e) = history_manager.save_text_operation(
        text,
        result_text.clone(),
        prompt_name,
    ) {
        log::error!("Failed to save text operation to history: {}", e);
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
pub fn change_text_ops_provider_setting(
    provider_id: String,
    app: AppHandle,
) -> Result<(), String> {
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
    write_settings(&app, settings);
    Ok(())
}
