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

/// Shows the prompt picker near the system tray area.
///
/// On macOS the tray lives in the top-right menu bar; on all other platforms
/// (Linux, Windows) it sits in the bottom-right taskbar/panel.
pub fn show_prompt_picker(app_handle: &AppHandle) {
    if let Some(picker_window) = app_handle.get_webview_window("prompt_picker") {
        // Position near the system tray corner of the current monitor.
        if let Ok(Some(monitor)) = picker_window.current_monitor() {
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            let scale = monitor.scale_factor();
            let mon_w = monitor_size.width as f64 / scale;
            let mon_h = monitor_size.height as f64 / scale;
            let mon_x = monitor_pos.x as f64 / scale;
            let mon_y = monitor_pos.y as f64 / scale;

            const EDGE_PADDING: f64 = 16.0;

            // On macOS the tray is top-right; everywhere else it is bottom-right.
            #[cfg(target_os = "macos")]
            let (x, y) = (
                mon_x + mon_w - PICKER_WIDTH - EDGE_PADDING,
                mon_y + EDGE_PADDING,
            );

            #[cfg(not(target_os = "macos"))]
            let (x, y) = (
                mon_x + mon_w - PICKER_WIDTH - EDGE_PADDING,
                mon_y + mon_h - PICKER_HEIGHT - EDGE_PADDING,
            );

            let _ = picker_window
                .set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y }));
        }

        let _ = picker_window.show();
        let _ = picker_window.set_focus();

        // Delay the event slightly so the webview has time to load on first show
        let window_clone = picker_window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = window_clone.emit("show-picker", ());
            info!("Prompt picker shown (event emitted)");
        });
    }
}

/// Hides the prompt picker.
pub fn hide_prompt_picker(app_handle: &AppHandle) {
    if let Some(picker_window) = app_handle.get_webview_window("prompt_picker") {
        let _ = picker_window.hide();
    }
}
