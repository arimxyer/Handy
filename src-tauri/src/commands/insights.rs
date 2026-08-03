use crate::actions::post_process_transcription;
use crate::managers::history::HistoryManager;
use crate::settings::{get_settings, write_settings, LLMPrompt};
use log::debug;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct InsightsPattern {
    pub pattern: String,
    pub examples: Vec<String>,
    pub frequency: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct InsightsSection {
    pub title: String,
    pub severity: String,
    pub summary: String,
    pub patterns: Vec<InsightsPattern>,
    pub prompt_suggestion: String,
}

/// Wrapper for structured JSON output so the schema has a top-level object
#[derive(Clone, Debug, Serialize, Deserialize)]
struct InsightsStructuredOutput {
    sections: Vec<InsightsSection>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct InsightsResult {
    pub analysis: String,
    pub sections: Option<Vec<InsightsSection>>,
    pub model_name: String,
    pub provider_id: String,
    pub entries_analyzed: u32,
    pub timestamp: i64,
    pub earliest_entry_date: i64,
    pub latest_entry_date: i64,
}

fn build_freeform_prompt(texts: &[String]) -> String {
    let combined = texts.join("\n---\n");
    format!(
        "Analyze these speech-to-text transcriptions for patterns.\n\
         Identify:\n\
         1) Common filler words and verbal tics\n\
         2) Sentence structure tendencies\n\
         3) Common topics and vocabulary\n\
         4) Specific prompt improvements for cleaning up this person's speech patterns\n\n\
         For each suggestion, explain what pattern you noticed and provide a concrete prompt instruction.\n\n\
         Transcriptions:\n{}",
        combined
    )
}

fn build_structured_system_prompt() -> String {
    "You are a speech pattern analyst. Analyze the provided speech-to-text transcriptions \
     and identify patterns across these categories:\n\
     - Filler words and verbal tics (e.g. \"um\", \"like\", \"you know\")\n\
     - Sentence structure tendencies (run-on sentences, fragments, passive voice)\n\
     - Common topics and vocabulary patterns\n\
     - Specific prompt improvements for cleaning up this person's speech\n\n\
     For each section, assess severity (\"high\", \"medium\", or \"low\") based on how \
     frequently and noticeably the pattern appears. Provide concrete examples from the \
     transcriptions and a specific prompt instruction that could help correct each pattern."
        .to_string()
}

fn build_structured_user_content(texts: &[String]) -> String {
    let combined = texts.join("\n---\n");
    format!("Transcriptions to analyze:\n{}", combined)
}

fn build_insights_json_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "Section title (e.g. 'Filler Words', 'Sentence Structure')"
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": "How prominent this pattern is"
                        },
                        "summary": {
                            "type": "string",
                            "description": "Brief summary of the finding"
                        },
                        "patterns": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "pattern": {
                                        "type": "string",
                                        "description": "The specific pattern observed"
                                    },
                                    "examples": {
                                        "type": "array",
                                        "items": { "type": "string" },
                                        "description": "Direct quotes from the transcriptions"
                                    },
                                    "frequency": {
                                        "type": "string",
                                        "enum": ["very common", "common", "occasional"],
                                        "description": "How often this pattern appears"
                                    }
                                },
                                "required": ["pattern", "examples", "frequency"],
                                "additionalProperties": false
                            }
                        },
                        "prompt_suggestion": {
                            "type": "string",
                            "description": "A concrete prompt instruction to help correct this pattern"
                        }
                    },
                    "required": ["title", "severity", "summary", "patterns", "prompt_suggestion"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["sections"],
        "additionalProperties": false
    })
}

#[tauri::command]
#[specta::specta]
pub async fn analyze_speech_patterns(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<InsightsResult, String> {
    let settings = get_settings(&app);

    // Feature gate: require both experimental and post-process enabled
    if !settings.experimental_enabled || !settings.post_process_enabled {
        return Err("INSIGHTS_DISABLED".to_string());
    }

    // Get history entries
    let page = history_manager
        .get_history_entries(Some("voice"), None, None)
        .await
        .map_err(|e| e.to_string())?;
    let entries = page.entries;

    if entries.is_empty() {
        return Err("NO_HISTORY_ENTRIES".to_string());
    }

    // Scope based on settings — collect both texts and timestamps
    let scoped_entries: Vec<_> = if settings.insights_use_all_history {
        entries
            .iter()
            .filter(|e| !e.transcription_text.trim().is_empty())
            .collect()
    } else {
        entries
            .iter()
            .take(settings.insights_entry_count as usize)
            .filter(|e| !e.transcription_text.trim().is_empty())
            .collect()
    };

    if scoped_entries.is_empty() {
        return Err("NO_TRANSCRIPTION_TEXTS".to_string());
    }

    let texts: Vec<String> = scoped_entries
        .iter()
        .map(|e| e.transcription_text.clone())
        .collect();

    let entries_analyzed = scoped_entries.len() as u32;
    let earliest_entry_date = scoped_entries
        .iter()
        .map(|e| e.timestamp)
        .min()
        .unwrap_or(0);
    let latest_entry_date = scoped_entries
        .iter()
        .map(|e| e.timestamp)
        .max()
        .unwrap_or(0);

    // Build effective settings: use insights provider/key/model if configured,
    // otherwise fall back to post-process settings
    let mut effective_settings = settings.clone();

    // Determine which provider to use for insights
    let insights_provider_id = if settings.insights_provider_id.is_empty() {
        settings.post_process_provider_id.clone()
    } else {
        settings.insights_provider_id.clone()
    };

    effective_settings.post_process_provider_id = insights_provider_id.clone();

    // Apply insights API key if set for this provider
    if let Some(api_key) = settings.insights_api_keys.get(&insights_provider_id) {
        if !api_key.is_empty() {
            effective_settings
                .post_process_api_keys
                .insert(insights_provider_id.clone(), api_key.clone());
        }
    }

    // Determine effective model
    let effective_model = if let Some(model) = settings.insights_models.get(&insights_provider_id) {
        if !model.is_empty() {
            effective_settings
                .post_process_models
                .insert(insights_provider_id.clone(), model.clone());
            model.clone()
        } else {
            effective_settings
                .post_process_models
                .get(&insights_provider_id)
                .cloned()
                .unwrap_or_default()
        }
    } else {
        effective_settings
            .post_process_models
            .get(&insights_provider_id)
            .cloned()
            .unwrap_or_default()
    };

    // Check if provider supports structured output
    let provider = effective_settings.active_post_process_provider().cloned();

    let supports_structured = provider
        .as_ref()
        .map(|p| p.supports_structured_output)
        .unwrap_or(false);

    let (analysis, sections) = if supports_structured {
        // Structured path: use JSON schema enforcement
        debug!(
            "Insights: using structured output path for provider '{}'",
            insights_provider_id
        );

        let provider_ref = provider.as_ref().ok_or("No provider configured")?;
        let api_key = effective_settings
            .post_process_api_keys
            .get(&insights_provider_id)
            .cloned()
            .unwrap_or_default();

        let system_prompt = build_structured_system_prompt();
        let user_content = build_structured_user_content(&texts);
        let json_schema = build_insights_json_schema();
        match crate::llm_client::send_chat_completion_with_schema(
            provider_ref,
            api_key,
            &effective_model,
            user_content,
            Some(system_prompt),
            Some(json_schema),
            true,
        )
        .await
        {
            Ok(Some(content)) => {
                // Try to parse as structured output
                match serde_json::from_str::<InsightsStructuredOutput>(&content) {
                    Ok(parsed) => {
                        debug!(
                            "Insights: parsed {} structured sections",
                            parsed.sections.len()
                        );
                        (content.clone(), Some(parsed.sections))
                    }
                    Err(e) => {
                        debug!("Insights: structured parse failed ({}), using raw text", e);
                        (content, None)
                    }
                }
            }
            Ok(None) => {
                return Err("INSIGHTS_ANALYSIS_FAILED".to_string());
            }
            Err(e) => {
                debug!(
                    "Insights: structured output request failed ({}), falling back to freeform",
                    e
                );
                // Fall through to freeform path
                let analysis_prompt = build_freeform_prompt(&texts);
                let synthetic_id = "__insights_analysis__".to_string();
                effective_settings.post_process_prompts.push(LLMPrompt {
                    id: synthetic_id.clone(),
                    name: "Insights Analysis".to_string(),
                    prompt: "${output}".to_string(),
                });
                effective_settings.post_process_selected_prompt_id = Some(synthetic_id);

                let text = post_process_transcription(&effective_settings, &analysis_prompt)
                    .await
                    .ok_or_else(|| "INSIGHTS_ANALYSIS_FAILED".to_string())?;
                (text, None)
            }
        }
    } else {
        // Freeform path: use existing post_process_transcription pipeline
        debug!(
            "Insights: using freeform output path for provider '{}'",
            insights_provider_id
        );

        let analysis_prompt = build_freeform_prompt(&texts);
        let synthetic_id = "__insights_analysis__".to_string();

        effective_settings.post_process_prompts.push(LLMPrompt {
            id: synthetic_id.clone(),
            name: "Insights Analysis".to_string(),
            prompt: "${output}".to_string(),
        });
        effective_settings.post_process_selected_prompt_id = Some(synthetic_id);

        let text = post_process_transcription(&effective_settings, &analysis_prompt)
            .await
            .ok_or_else(|| "INSIGHTS_ANALYSIS_FAILED".to_string())?;
        (text, None)
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let result = InsightsResult {
        analysis,
        sections,
        model_name: effective_model,
        provider_id: insights_provider_id,
        entries_analyzed,
        timestamp: now,
        earliest_entry_date,
        latest_entry_date,
    };

    // Persist the result into the history vec (most-recent first, max 10)
    const MAX_INSIGHTS_HISTORY: usize = 10;
    let mut updated_settings = get_settings(&app);
    updated_settings.insights_history.insert(0, result.clone());
    updated_settings
        .insights_history
        .truncate(MAX_INSIGHTS_HISTORY);
    write_settings(&app, updated_settings);

    Ok(result)
}

#[tauri::command]
#[specta::specta]
pub async fn estimate_insights_tokens(
    app: AppHandle,
    history_manager: State<'_, Arc<HistoryManager>>,
) -> Result<u32, String> {
    let settings = get_settings(&app);

    let page = history_manager
        .get_history_entries(Some("voice"), None, None)
        .await
        .map_err(|e| e.to_string())?;
    let entries = page.entries;

    let texts: Vec<String> = if settings.insights_use_all_history {
        entries
            .iter()
            .filter(|e| !e.transcription_text.trim().is_empty())
            .map(|e| e.transcription_text.clone())
            .collect()
    } else {
        entries
            .iter()
            .take(settings.insights_entry_count as usize)
            .filter(|e| !e.transcription_text.trim().is_empty())
            .map(|e| e.transcription_text.clone())
            .collect()
    };

    if texts.is_empty() {
        return Ok(0);
    }

    let prompt = build_freeform_prompt(&texts);
    let bpe = tiktoken_rs::cl100k_base().map_err(|e| e.to_string())?;
    let tokens = bpe.encode_with_special_tokens(&prompt);

    Ok(tokens.len() as u32)
}

#[tauri::command]
#[specta::specta]
pub fn change_insights_provider_id(app: AppHandle, value: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_provider_id = value;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_insights_model(
    app: AppHandle,
    provider_id: String,
    value: String,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_models.insert(provider_id, value);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_insights_api_key(
    app: AppHandle,
    provider_id: String,
    value: String,
) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_api_keys.insert(provider_id, value);
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_insights_entry_count(app: AppHandle, value: u32) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_entry_count = value;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn change_insights_use_all_history(app: AppHandle, value: bool) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_use_all_history = value;
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn clear_insights_history(app: AppHandle) -> Result<(), String> {
    let mut settings = get_settings(&app);
    settings.insights_history.clear();
    write_settings(&app, settings);
    Ok(())
}
