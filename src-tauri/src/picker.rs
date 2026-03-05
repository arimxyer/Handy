use crate::input;
use log::info;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(not(target_os = "macos"))]
use log::debug;

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

const PICKER_WIDTH: f64 = 260.0;
const PICKER_HEIGHT: f64 = 320.0;

/// Stores the selected text while the picker is open, so the chosen prompt
/// can be applied to it after selection.
pub struct TextOpsPendingText(pub Mutex<Option<String>>);

/// Creates the prompt picker window (hidden by default).
#[cfg(not(target_os = "macos"))]
pub fn create_prompt_picker(app_handle: &AppHandle) {
    match WebviewWindowBuilder::new(
        app_handle,
        "prompt_picker",
        tauri::WebviewUrl::App("src/picker/index.html".into()),
    )
    .title("Prompt Picker")
    .resizable(false)
    .inner_size(PICKER_WIDTH, PICKER_HEIGHT)
    .shadow(true)
    .maximizable(false)
    .minimizable(false)
    .closable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(true)
    .visible(false)
    .build()
    {
        Ok(_window) => {
            debug!("Prompt picker window created successfully (hidden)");
        }
        Err(e) => {
            debug!("Failed to create prompt picker window: {}", e);
        }
    }
}

/// Creates the prompt picker window (hidden by default) — macOS version.
#[cfg(target_os = "macos")]
pub fn create_prompt_picker(app_handle: &AppHandle) {
    use tauri::WebviewWindowBuilder;
    match WebviewWindowBuilder::new(
        app_handle,
        "prompt_picker",
        tauri::WebviewUrl::App("src/picker/index.html".into()),
    )
    .title("Prompt Picker")
    .resizable(false)
    .inner_size(PICKER_WIDTH, PICKER_HEIGHT)
    .shadow(true)
    .maximizable(false)
    .minimizable(false)
    .closable(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(true)
    .visible(false)
    .build()
    {
        Ok(_window) => {
            log::debug!("Prompt picker window created successfully (hidden)");
        }
        Err(e) => {
            log::debug!("Failed to create prompt picker window: {}", e);
        }
    }
}

/// Shows the prompt picker near the cursor position.
pub fn show_prompt_picker(app_handle: &AppHandle) {
    if let Some(picker_window) = app_handle.get_webview_window("prompt_picker") {
        // Position near cursor
        if let Some((mouse_x, mouse_y)) = input::get_cursor_position(app_handle) {
            let x = mouse_x as f64 - PICKER_WIDTH / 2.0;
            let y = mouse_y as f64 - PICKER_HEIGHT - 10.0; // Above cursor
            // Ensure we don't go off-screen (negative coords)
            let x = if x < 0.0 { 0.0 } else { x };
            let y = if y < 0.0 {
                mouse_y as f64 + 20.0 // Below cursor if no room above
            } else {
                y
            };
            let _ = picker_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }

        let _ = picker_window.show();
        let _ = picker_window.set_focus();
        let _ = picker_window.emit("show-picker", ());
        info!("Prompt picker shown");
    }
}

/// Hides the prompt picker.
pub fn hide_prompt_picker(app_handle: &AppHandle) {
    if let Some(picker_window) = app_handle.get_webview_window("prompt_picker") {
        let _ = picker_window.hide();
    }
}
