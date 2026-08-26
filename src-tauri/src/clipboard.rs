use crate::input::{self, EnigoState};
#[cfg(target_os = "linux")]
use crate::settings::TypingTool;
use crate::settings::{get_settings, AutoSubmitKey, ClipboardHandling, PasteMethod};
use enigo::{Direction, Enigo, Key, Keyboard};
use log::info;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[cfg(target_os = "linux")]
use crate::utils::{is_kde_wayland, is_wayland};

fn with_enigo<T>(
    app_handle: &AppHandle,
    f: impl FnOnce(&mut Enigo) -> Result<T, String>,
) -> Result<T, String> {
    let enigo_state = app_handle
        .try_state::<EnigoState>()
        .ok_or("Enigo state not initialized")?;
    let mut enigo = enigo_state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock Enigo: {}", e))?;
    f(&mut enigo)
}

/// Write text to the clipboard using the same Wayland-aware path as ordinary
/// transcription output. Text operations share this helper so both features
/// agree on Unicode-safe clipboard behavior.
pub(crate) fn write_text_to_clipboard(app_handle: &AppHandle, text: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    if is_wayland() && is_wl_copy_available() {
        info!("Using wl-copy for clipboard write on Wayland");
        return write_clipboard_via_wl_copy(text);
    }

    app_handle
        .clipboard()
        .write_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))
}

fn finish_clipboard_paste(
    paste_result: Result<(), String>,
    paste_delay_after_ms: u64,
    restore_clipboard: impl FnOnce(),
) -> Result<(), String> {
    std::thread::sleep(Duration::from_millis(paste_delay_after_ms));
    restore_clipboard();
    paste_result
}

/// Pastes text using the clipboard: saves current content, writes text, sends paste keystroke, restores clipboard.
fn paste_via_clipboard(
    text: &str,
    app_handle: &AppHandle,
    paste_method: &PasteMethod,
    paste_delay_ms: u64,
    paste_delay_after_ms: u64,
) -> Result<(), String> {
    let clipboard = app_handle.clipboard();
    let saved_text = clipboard.read_text().ok().filter(|t| !t.is_empty());
    // Only probe for an image when there is no text to restore. Text is by far the
    // common case, and reading an image decodes the full bitmap, so this keeps the
    // text path exactly as cheap as it was before.
    let saved_image = if saved_text.is_none() {
        clipboard.read_image().ok().map(|image| image.to_owned())
    } else {
        None
    };

    // Write text to clipboard first
    write_text_to_clipboard(app_handle, text)?;

    std::thread::sleep(Duration::from_millis(paste_delay_ms));

    // Capture key injection errors so the original clipboard is restored before
    // propagating them to the caller.
    let paste_result = (|| -> Result<(), String> {
        // Send paste key combo
        #[cfg(target_os = "linux")]
        let key_combo_sent = try_send_key_combo_linux(paste_method)?;

        #[cfg(not(target_os = "linux"))]
        let key_combo_sent = false;

        // Fall back to enigo if no native tool handled it
        if !key_combo_sent {
            with_enigo(app_handle, |enigo| match paste_method {
                // The legacy path cannot detect a mistimed chord, so it keeps the
                // conservative 100ms modifier hold.
                PasteMethod::CtrlV => input::send_paste_ctrl_v(enigo, 100),
                PasteMethod::CtrlShiftV => input::send_paste_ctrl_shift_v(enigo, 100),
                PasteMethod::ShiftInsert => input::send_paste_shift_insert(enigo, 100),
                _ => Err("Invalid paste method for clipboard paste".into()),
            })?;
        }

        Ok(())
    })();

    finish_clipboard_paste(paste_result, paste_delay_after_ms, || {
        // Restore original clipboard content even when key injection failed.
        // Text takes priority so this path stays identical to the previous behavior;
        // an image is only restored when the clipboard held no text at all, which is
        // the case that used to silently wipe screenshots.
        if let Some(clipboard_content) = saved_text {
            let _ = write_text_to_clipboard(app_handle, &clipboard_content);
        } else if let Some(image) = saved_image {
            info!("Restoring image to clipboard");
            let _ = clipboard.write_image(&image);
        } else {
            // Nothing was there to begin with — don't leave the transcription behind.
            let _ = clipboard.clear();
        }
    })
}

/// A key-injection tool: display name, availability probe, sender.
#[cfg(target_os = "linux")]
type KeyComboTool = (
    &'static str,
    fn() -> bool,
    fn(&PasteMethod) -> Result<(), String>,
);

/// Walks `candidates` in order and returns whether one of them sent the combo.
///
/// An installed tool can still fail at run time — revoked uinput access, a
/// daemon that died mid-session, a compositor that dropped a protocol. Each
/// failure is logged and the chain continues, so one broken tool no longer
/// fails the paste outright; enigo remains the caller's fallback once every
/// candidate is exhausted.
#[cfg(target_os = "linux")]
fn run_key_combo_chain(candidates: &[KeyComboTool], paste_method: &PasteMethod) -> bool {
    for (name, is_available, send_key_combo) in candidates {
        if !is_available() {
            continue;
        }
        info!("Using {} for key combo", name);
        match send_key_combo(paste_method) {
            Ok(()) => return true,
            Err(error) => log::warn!(
                "{} could not send the key combo ({}); trying the next tool",
                name,
                error
            ),
        }
    }

    false
}

/// Attempts to send a key combination using Linux-native tools.
/// Returns `Ok(true)` if a native tool handled it, `Ok(false)` to fall back to enigo.
#[cfg(target_os = "linux")]
fn try_send_key_combo_linux(paste_method: &PasteMethod) -> Result<bool, String> {
    const WTYPE: KeyComboTool = ("wtype", is_wtype_available, send_key_combo_via_wtype);
    const DOTOOL: KeyComboTool = ("dotool", is_dotool_available, send_key_combo_via_dotool);
    const YDOTOOL: KeyComboTool = ("ydotool", is_ydotool_available, send_key_combo_via_ydotool);
    const XDOTOOL: KeyComboTool = ("xdotool", is_xdotool_available, send_key_combo_via_xdotool);

    let candidates: &[KeyComboTool] = if is_wayland() {
        // wtype doesn't work on KDE (no zwp_virtual_keyboard_manager_v1 support).
        if is_kde_wayland() {
            &[DOTOOL, YDOTOOL]
        } else {
            &[WTYPE, DOTOOL, YDOTOOL]
        }
    } else {
        &[XDOTOOL, YDOTOOL]
    };

    Ok(run_key_combo_chain(candidates, paste_method))
}

/// Attempts to type text directly using Linux-native tools.
/// Returns `Ok(true)` if a native tool handled it, `Ok(false)` to fall back to enigo.
#[cfg(target_os = "linux")]
fn try_direct_typing_linux(text: &str, preferred_tool: TypingTool) -> Result<bool, String> {
    // If user specified a tool, try only that one
    if preferred_tool != TypingTool::Auto {
        return match preferred_tool {
            TypingTool::Wtype if is_wtype_available() => {
                info!("Using user-specified wtype");
                type_text_via_wtype(text)?;
                Ok(true)
            }
            TypingTool::Kwtype if is_kwtype_available() => {
                info!("Using user-specified kwtype");
                type_text_via_kwtype(text)?;
                Ok(true)
            }
            TypingTool::Dotool if is_dotool_available() => {
                info!("Using user-specified dotool");
                type_text_via_dotool(text)?;
                Ok(true)
            }
            TypingTool::Ydotool if is_ydotool_available() => {
                info!("Using user-specified ydotool");
                type_text_via_ydotool(text)?;
                Ok(true)
            }
            TypingTool::Xdotool if is_xdotool_available() => {
                info!("Using user-specified xdotool");
                type_text_via_xdotool(text)?;
                Ok(true)
            }
            _ => Err(format!(
                "Typing tool {:?} is not available on this system",
                preferred_tool
            )),
        };
    }

    // Auto mode - existing fallback chain
    if is_wayland() {
        // KDE Wayland: prefer kwtype (uses KDE Fake Input protocol, supports umlauts)
        if is_kde_wayland() && is_kwtype_available() {
            info!("Using kwtype for direct text input on KDE Wayland");
            type_text_via_kwtype(text)?;
            return Ok(true);
        }
        // Wayland: prefer wtype, then dotool, then ydotool
        // Note: wtype doesn't work on KDE (no zwp_virtual_keyboard_manager_v1 support)
        if !is_kde_wayland() && is_wtype_available() {
            info!("Using wtype for direct text input");
            type_text_via_wtype(text)?;
            return Ok(true);
        }
        if is_dotool_available() {
            info!("Using dotool for direct text input");
            type_text_via_dotool(text)?;
            return Ok(true);
        }
        if is_ydotool_available() {
            info!("Using ydotool for direct text input");
            type_text_via_ydotool(text)?;
            return Ok(true);
        }
    } else {
        // X11: prefer xdotool, then ydotool
        if is_xdotool_available() {
            info!("Using xdotool for direct text input");
            type_text_via_xdotool(text)?;
            return Ok(true);
        }
        if is_ydotool_available() {
            info!("Using ydotool for direct text input");
            type_text_via_ydotool(text)?;
            return Ok(true);
        }
    }

    Ok(false)
}

/// Returns the list of available typing tools on this system.
/// Always includes "auto" as the first entry.
#[cfg(target_os = "linux")]
pub fn get_available_typing_tools() -> Vec<String> {
    let mut tools = vec!["auto".to_string()];
    if is_wtype_available() {
        tools.push("wtype".to_string());
    }
    if is_kwtype_available() {
        tools.push("kwtype".to_string());
    }
    if is_dotool_available() {
        tools.push("dotool".to_string());
    }
    if is_ydotool_available() {
        tools.push("ydotool".to_string());
    }
    if is_xdotool_available() {
        tools.push("xdotool".to_string());
    }
    tools
}

/// Check if wtype is available (Wayland text input tool)
#[cfg(target_os = "linux")]
fn is_wtype_available() -> bool {
    Command::new("which")
        .arg("wtype")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Whether this process can actually open `/dev/uinput` for writing.
///
/// The node is usually `root:input` with an ACL granting the desktop user
/// access, so a mode-bit check would report a false negative. Opening it is
/// the only answer that honours ACLs, and it is harmless: creating a virtual
/// device needs ioctls we never issue, and uinput allows concurrent opens.
#[cfg(target_os = "linux")]
fn is_uinput_writable() -> bool {
    std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/uinput")
        .is_ok()
}

/// Check if dotool is available. Like ydotool, the binary on its own proves
/// nothing — dotool writes directly to `/dev/uinput`, so without access there
/// it is installed and useless.
#[cfg(target_os = "linux")]
fn is_dotool_available() -> bool {
    let binary_exists = Command::new("which")
        .arg("dotool")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !binary_exists {
        return false;
    }
    is_uinput_writable()
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum YdotoolKeySyntax {
    Symbolic,
    RawKeycodes,
}

#[cfg(target_os = "linux")]
const YDOTOOL_UNKNOWN_HELP_FALLBACK: YdotoolKeySyntax = YdotoolKeySyntax::RawKeycodes;

#[cfg(target_os = "linux")]
static YDOTOOL_KEY_SYNTAX: OnceLock<YdotoolKeySyntax> = OnceLock::new();

/// Classifies `ydotool key --help` output without relying on version or distro metadata.
#[cfg(target_os = "linux")]
fn classify_ydotool_key_syntax(help: &str) -> Option<YdotoolKeySyntax> {
    let help = help.to_ascii_lowercase();

    // Check modern markers first in case a future help message mentions the legacy syntax.
    if help.contains("syntax: <keycode>:<pressed>")
        || help.contains("[keycodes]")
        || help.contains("using raw keycodes")
    {
        Some(YdotoolKeySyntax::RawKeycodes)
    } else if help.contains("separated by plus (+)")
        || (help.contains("<key sequence>") && help.contains("alt+r"))
    {
        Some(YdotoolKeySyntax::Symbolic)
    } else {
        None
    }
}

/// Detects and caches a recognized ydotool key syntax. Unknown or failed probes are not cached,
/// allowing a transient daemon or PATH problem to recover on a later paste attempt.
#[cfg(target_os = "linux")]
fn detect_ydotool_key_syntax() -> YdotoolKeySyntax {
    if let Some(syntax) = YDOTOOL_KEY_SYNTAX.get() {
        return *syntax;
    }

    match Command::new("ydotool").args(["key", "--help"]).output() {
        Ok(output) => {
            // ydotool 0.x writes help to stderr and its exit status varies by build.
            let mut help = String::from_utf8_lossy(&output.stdout).into_owned();
            if !help.is_empty() && !output.stderr.is_empty() {
                help.push('\n');
            }
            help.push_str(&String::from_utf8_lossy(&output.stderr));

            if let Some(syntax) = classify_ydotool_key_syntax(&help) {
                *YDOTOOL_KEY_SYNTAX.get_or_init(|| {
                    info!("Detected ydotool key syntax: {:?}", syntax);
                    syntax
                })
            } else {
                // Preserve Handy's existing behavior and compatibility with current ydotool.
                log::warn!(
                    "Could not recognize ydotool key --help output (exit status {:?}); using raw-keycode syntax",
                    output.status.code()
                );
                YDOTOOL_UNKNOWN_HELP_FALLBACK
            }
        }
        Err(error) => {
            log::warn!(
                "Could not query ydotool key syntax: {}; using raw-keycode syntax",
                error
            );
            YDOTOOL_UNKNOWN_HELP_FALLBACK
        }
    }
}

/// Check if ydotool is available (uinput-based, works on both Wayland and X11)
#[cfg(target_os = "linux")]
fn is_ydotool_available() -> bool {
    let binary_exists = Command::new("which")
        .arg("ydotool")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if !binary_exists {
        return false;
    }

    // The client binary cannot inject input without the daemon socket.
    Command::new("pgrep")
        .arg("ydotoold")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn is_xdotool_available() -> bool {
    Command::new("which")
        .arg("xdotool")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Check if kwtype is available (KDE Wayland virtual keyboard input tool)
#[cfg(target_os = "linux")]
fn is_kwtype_available() -> bool {
    Command::new("which")
        .arg("kwtype")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Check if wl-copy is available (Wayland clipboard tool)
#[cfg(target_os = "linux")]
fn is_wl_copy_available() -> bool {
    Command::new("which")
        .arg("wl-copy")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Type text directly via wtype on Wayland.
#[cfg(target_os = "linux")]
fn type_text_via_wtype(text: &str) -> Result<(), String> {
    let output = Command::new("wtype")
        .arg("--") // Protect against text starting with -
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute wtype: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("wtype failed: {}", stderr));
    }

    Ok(())
}

/// Type text directly via xdotool on X11.
#[cfg(target_os = "linux")]
fn type_text_via_xdotool(text: &str) -> Result<(), String> {
    let output = Command::new("xdotool")
        .arg("type")
        .arg("--clearmodifiers")
        .arg("--")
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute xdotool: {}", e))?;

    // `--clearmodifiers` restores the modifiers that were held when xdotool
    // started. If the user releases one while xdotool is typing, that synthetic
    // restore can leave the modifier latched on the XTEST keyboard (#1817).
    // Release both sides of Handy's supported push-style modifiers to clear any
    // stale restore. Lock keys are intentionally excluded because key events
    // toggle them.
    //
    // The release is unconditional, so it can make a modifier that is still
    // physically held appear released until the next physical event. This is
    // preferable to leaving a synthetic modifier latched system-wide.
    //
    // Clean up before checking the typing status because xdotool may have
    // changed modifier state before returning an error. Cleanup remains
    // best-effort because the text may already have been partially or fully
    // typed, but failures are logged so they can be diagnosed.
    match Command::new("xdotool")
        .arg("keyup")
        .args([
            "Control_L",
            "Control_R",
            "Shift_L",
            "Shift_R",
            "Alt_L",
            "Alt_R",
            "Super_L",
            "Super_R",
        ])
        .output()
    {
        Ok(cleanup_output) if !cleanup_output.status.success() => {
            let stderr = String::from_utf8_lossy(&cleanup_output.stderr);
            log::warn!(
                "xdotool modifier cleanup failed with status {:?}: {}",
                cleanup_output.status.code(),
                stderr.trim()
            );
        }
        Err(error) => log::warn!("Failed to execute xdotool modifier cleanup: {}", error),
        _ => {}
    }

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("xdotool failed: {}", stderr));
    }

    Ok(())
}

/// Type text directly via dotool (works on both Wayland and X11 via uinput).
#[cfg(target_os = "linux")]
fn type_text_via_dotool(text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new("dotool")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn dotool: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        // dotool uses "type <text>" command
        writeln!(stdin, "type {}", text)
            .map_err(|e| format!("Failed to write to dotool stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for dotool: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("dotool failed: {}", stderr));
    }

    Ok(())
}

/// Type text directly via ydotool (uinput-based, requires ydotoold daemon).
#[cfg(target_os = "linux")]
fn type_text_via_ydotool(text: &str) -> Result<(), String> {
    let output = Command::new("ydotool")
        .arg("type")
        .arg("--")
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute ydotool: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ydotool failed: {}", stderr));
    }

    Ok(())
}

/// Type text directly via kwtype (KDE Wayland virtual keyboard, uses KDE Fake Input protocol).
#[cfg(target_os = "linux")]
fn type_text_via_kwtype(text: &str) -> Result<(), String> {
    let output = Command::new("kwtype")
        .arg("--")
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute kwtype: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("kwtype failed: {}", stderr));
    }

    Ok(())
}

/// Write text to clipboard via wl-copy (Wayland clipboard tool).
/// Uses Stdio::null() to avoid blocking on repeated calls — wl-copy forks a
/// daemon that inherits piped fds, causing read_to_end to hang indefinitely.
#[cfg(target_os = "linux")]
fn write_clipboard_via_wl_copy(text: &str) -> Result<(), String> {
    use std::process::Stdio;
    let status = Command::new("wl-copy")
        .arg("--")
        .arg(text)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to execute wl-copy: {}", e))?;

    if !status.success() {
        return Err("wl-copy failed".into());
    }

    Ok(())
}

/// Send a key combination (e.g., Ctrl+V) via wtype on Wayland.
#[cfg(target_os = "linux")]
fn send_key_combo_via_wtype(paste_method: &PasteMethod) -> Result<(), String> {
    let args: Vec<&str> = match paste_method {
        PasteMethod::CtrlV => vec!["-M", "ctrl", "-k", "v", "-m", "ctrl"],
        PasteMethod::ShiftInsert => vec!["-M", "shift", "-k", "Insert", "-m", "shift"],
        PasteMethod::CtrlShiftV => vec![
            "-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl",
        ],
        _ => return Err("Unsupported paste method".into()),
    };

    let output = Command::new("wtype")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute wtype: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("wtype failed: {}", stderr));
    }

    Ok(())
}

/// Send a key combination (e.g., Ctrl+V) via dotool.
#[cfg(target_os = "linux")]
fn send_key_combo_via_dotool(paste_method: &PasteMethod) -> Result<(), String> {
    let command;
    match paste_method {
        PasteMethod::CtrlV => command = "echo key ctrl+v | dotool",
        PasteMethod::ShiftInsert => command = "echo key shift+insert | dotool",
        PasteMethod::CtrlShiftV => command = "echo key ctrl+shift+v | dotool",
        _ => return Err("Unsupported paste method".into()),
    }
    use std::process::Stdio;
    let status = Command::new("sh")
        .arg("-c")
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to execute dotool: {}", e))?;
    if !status.success() {
        return Err("dotool failed".into());
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn ydotool_key_args(
    paste_method: &PasteMethod,
    syntax: YdotoolKeySyntax,
) -> Result<&'static [&'static str], String> {
    let args = match (paste_method, syntax) {
        (PasteMethod::CtrlV, YdotoolKeySyntax::Symbolic) => &["key", "ctrl+v"][..],
        (PasteMethod::CtrlShiftV, YdotoolKeySyntax::Symbolic) => &["key", "ctrl+shift+v"][..],
        (PasteMethod::ShiftInsert, YdotoolKeySyntax::Symbolic) => &["key", "shift+insert"][..],
        (PasteMethod::CtrlV, YdotoolKeySyntax::RawKeycodes) => {
            &["key", "29:1", "47:1", "47:0", "29:0"][..]
        }
        (PasteMethod::CtrlShiftV, YdotoolKeySyntax::RawKeycodes) => {
            &["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"][..]
        }
        (PasteMethod::ShiftInsert, YdotoolKeySyntax::RawKeycodes) => {
            &["key", "42:1", "110:1", "110:0", "42:0"][..]
        }
        _ => return Err("Unsupported paste method".into()),
    };

    Ok(args)
}

/// Send a key combination (e.g., Ctrl+V) via ydotool (requires ydotoold daemon).
#[cfg(target_os = "linux")]
fn send_key_combo_via_ydotool(paste_method: &PasteMethod) -> Result<(), String> {
    let syntax = detect_ydotool_key_syntax();
    let args = ydotool_key_args(paste_method, syntax)?;

    let output = Command::new("ydotool")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute ydotool: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ydotool failed: {}", stderr));
    }

    Ok(())
}

/// Send a key combination (e.g., Ctrl+V) via xdotool on X11.
#[cfg(target_os = "linux")]
fn send_key_combo_via_xdotool(paste_method: &PasteMethod) -> Result<(), String> {
    let key_combo = match paste_method {
        PasteMethod::CtrlV => "ctrl+v",
        PasteMethod::CtrlShiftV => "ctrl+shift+v",
        PasteMethod::ShiftInsert => "shift+Insert",
        _ => return Err("Unsupported paste method".into()),
    };

    let output = Command::new("xdotool")
        .arg("key")
        .arg("--clearmodifiers")
        .arg(key_combo)
        .output()
        .map_err(|e| format!("Failed to execute xdotool: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("xdotool failed: {}", stderr));
    }

    Ok(())
}

/// Pastes text by invoking an external script.
/// The script receives the text to paste as a single argument.
fn paste_via_external_script(text: &str, script_path: &str) -> Result<(), String> {
    info!("Pasting via external script: {}", script_path);

    let output = Command::new(script_path)
        .arg(text)
        .output()
        .map_err(|e| format!("Failed to execute external script '{}': {}", script_path, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "External script '{}' failed with exit code {:?}. stderr: {}, stdout: {}",
            script_path,
            output.status.code(),
            stderr.trim(),
            stdout.trim()
        ));
    }

    Ok(())
}

/// Types text directly by simulating individual key presses.
fn paste_direct(
    text: &str,
    app_handle: &AppHandle,
    #[cfg(target_os = "linux")] typing_tool: TypingTool,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if try_direct_typing_linux(text, typing_tool)? {
            return Ok(());
        }
        info!("Falling back to enigo for direct text input");
    }

    with_enigo(app_handle, |enigo| input::paste_text_direct(enigo, text))
}

pub(crate) fn send_return_key(enigo: &mut Enigo, key_type: AutoSubmitKey) -> Result<(), String> {
    match key_type {
        AutoSubmitKey::Enter => {
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
        }
        AutoSubmitKey::CtrlEnter => {
            enigo
                .key(Key::Control, Direction::Press)
                .map_err(|e| format!("Failed to press Control key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Control, Direction::Release)
                .map_err(|e| format!("Failed to release Control key: {}", e))?;
        }
        AutoSubmitKey::CmdEnter => {
            enigo
                .key(Key::Meta, Direction::Press)
                .map_err(|e| format!("Failed to press Meta/Cmd key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Press)
                .map_err(|e| format!("Failed to press Return key: {}", e))?;
            enigo
                .key(Key::Return, Direction::Release)
                .map_err(|e| format!("Failed to release Return key: {}", e))?;
            enigo
                .key(Key::Meta, Direction::Release)
                .map_err(|e| format!("Failed to release Meta/Cmd key: {}", e))?;
        }
    }

    Ok(())
}

fn should_send_auto_submit(auto_submit: bool, paste_method: PasteMethod) -> bool {
    auto_submit && paste_method != PasteMethod::None
}

pub fn paste(text: String, app_handle: AppHandle) -> Result<(), String> {
    let settings = get_settings(&app_handle);
    let paste_method = settings.paste_method;
    let paste_delay_ms = settings.paste_delay_ms;
    let paste_delay_after_ms = settings.paste_delay_after_ms;

    // Append trailing space if setting is enabled
    let text = if settings.append_trailing_space {
        format!("{} ", text)
    } else {
        text
    };

    info!(
        "Using paste method: {:?}, delay before: {}ms, delay after: {}ms",
        paste_method, paste_delay_ms, paste_delay_after_ms
    );

    // Perform the paste operation
    match paste_method {
        PasteMethod::None => {
            info!("PasteMethod::None selected - skipping paste action");
        }
        PasteMethod::Direct => {
            paste_direct(
                &text,
                &app_handle,
                #[cfg(target_os = "linux")]
                settings.typing_tool,
            )?;
        }
        PasteMethod::CtrlV | PasteMethod::CtrlShiftV | PasteMethod::ShiftInsert => {
            // Debug-gated receipt-sequenced paste (#502): restore the clipboard
            // after the target actually reads the transcript, not on a timer.
            // On success it fully handles the paste (including auto-submit and
            // clipboard handling) asynchronously; on failure fall through to
            // the legacy path untouched.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            if settings.reliable_paste {
                let reliable_result = with_enigo(&app_handle, |enigo| {
                    crate::paste_tx::try_reliable_paste(
                        &text,
                        &app_handle,
                        &paste_method,
                        enigo,
                        settings.auto_submit,
                        settings.auto_submit_key,
                        settings.clipboard_handling,
                    )
                });
                match reliable_result {
                    Ok(()) => return Ok(()),
                    Err(e) => {
                        log::warn!("Reliable paste unavailable ({e}); falling back to legacy paste")
                    }
                }
            }
            paste_via_clipboard(
                &text,
                &app_handle,
                &paste_method,
                paste_delay_ms,
                paste_delay_after_ms,
            )?
        }
        PasteMethod::ExternalScript => {
            let script_path = settings
                .external_script_path
                .as_ref()
                .filter(|p| !p.is_empty())
                .ok_or("External script path is not configured")?;
            paste_via_external_script(&text, script_path)?;
        }
    }

    if should_send_auto_submit(settings.auto_submit, paste_method) {
        std::thread::sleep(Duration::from_millis(50));
        if let Err(error) = with_enigo(&app_handle, |enigo| {
            send_return_key(enigo, settings.auto_submit_key)
        }) {
            log::warn!("Paste succeeded, but auto-submit failed: {error}");
        }
    }

    // After pasting, optionally copy to clipboard based on settings
    if settings.clipboard_handling == ClipboardHandling::CopyToClipboard {
        write_text_to_clipboard(&app_handle, &text)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[cfg(target_os = "linux")]
    const YDOTOOL_0_1_8_HELP: &str = r#"
Usage: key [--delay <ms>] [--key-delay <ms>] [--repeat <times>] [--repeat-delay <ms>] <key sequence> ...
Each key sequence can be any number of modifiers and keys, separated by plus (+)
For example: alt+r Alt+F4 CTRL+alt+f3 aLT+1+2+3 ctrl+Backspace
"#;

    #[cfg(target_os = "linux")]
    const YDOTOOL_1_0_4_HELP: &str = r#"
Usage: key [OPTION]... [KEYCODES]...
Since there's no way to know how many keyboard layouts are there in the world,
we're using raw keycodes now.
Syntax: <keycode>:<pressed>
e.g. 28:1 28:0 means pressing on the Enter button on a standard US keyboard.
"#;

    // Function pointers cannot capture, so these fakes record calls in atomics.
    // Tests sharing the counters serialize through the mutex.
    #[cfg(target_os = "linux")]
    mod chain_probe {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Mutex;

        pub static SENDS: AtomicUsize = AtomicUsize::new(0);
        pub static LAST: AtomicUsize = AtomicUsize::new(0);
        pub static LOCK: Mutex<()> = Mutex::new(());

        pub fn reset() {
            SENDS.store(0, Ordering::SeqCst);
            LAST.store(0, Ordering::SeqCst);
        }
        pub fn record(id: usize) {
            SENDS.fetch_add(1, Ordering::SeqCst);
            LAST.store(id, Ordering::SeqCst);
        }
        pub fn sends() -> usize {
            SENDS.load(Ordering::SeqCst)
        }
        pub fn last() -> usize {
            LAST.load(Ordering::SeqCst)
        }
    }

    #[cfg(target_os = "linux")]
    fn always_available() -> bool {
        true
    }
    #[cfg(target_os = "linux")]
    fn never_available() -> bool {
        false
    }
    #[cfg(target_os = "linux")]
    fn fails_first(_: &PasteMethod) -> Result<(), String> {
        chain_probe::record(1);
        Err("simulated runtime failure".into())
    }
    #[cfg(target_os = "linux")]
    fn succeeds_second(_: &PasteMethod) -> Result<(), String> {
        chain_probe::record(2);
        Ok(())
    }
    #[cfg(target_os = "linux")]
    fn must_not_run(_: &PasteMethod) -> Result<(), String> {
        chain_probe::record(99);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn chain_falls_through_when_an_available_tool_fails_at_runtime() {
        let _guard = chain_probe::LOCK.lock().unwrap_or_else(|e| e.into_inner());
        chain_probe::reset();

        let candidates: &[KeyComboTool] = &[
            ("first", always_available, fails_first),
            ("second", always_available, succeeds_second),
        ];

        assert!(run_key_combo_chain(candidates, &PasteMethod::CtrlV));
        assert_eq!(chain_probe::sends(), 2);
        assert_eq!(chain_probe::last(), 2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn chain_skips_unavailable_tools_without_invoking_them() {
        let _guard = chain_probe::LOCK.lock().unwrap_or_else(|e| e.into_inner());
        chain_probe::reset();

        let candidates: &[KeyComboTool] = &[
            ("unavailable", never_available, must_not_run),
            ("available", always_available, succeeds_second),
        ];

        assert!(run_key_combo_chain(candidates, &PasteMethod::CtrlV));
        assert_eq!(chain_probe::sends(), 1);
        assert_eq!(chain_probe::last(), 2);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn chain_reports_false_so_the_caller_falls_back_to_enigo() {
        let _guard = chain_probe::LOCK.lock().unwrap_or_else(|e| e.into_inner());
        chain_probe::reset();

        let candidates: &[KeyComboTool] = &[
            ("broken", always_available, fails_first),
            ("missing", never_available, must_not_run),
        ];

        assert!(!run_key_combo_chain(candidates, &PasteMethod::CtrlV));
        assert_eq!(chain_probe::sends(), 1);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn classifies_ydotool_0_1_8_symbolic_help() {
        assert_eq!(
            classify_ydotool_key_syntax(YDOTOOL_0_1_8_HELP),
            Some(YdotoolKeySyntax::Symbolic)
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn classifies_ydotool_1_0_4_raw_keycode_help() {
        assert_eq!(
            classify_ydotool_key_syntax(YDOTOOL_1_0_4_HELP),
            Some(YdotoolKeySyntax::RawKeycodes)
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unknown_ydotool_help_falls_back_to_raw_keycodes() {
        let syntax = classify_ydotool_key_syntax("unrecognized help output")
            .unwrap_or(YDOTOOL_UNKNOWN_HELP_FALLBACK);

        assert_eq!(syntax, YdotoolKeySyntax::RawKeycodes);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn generates_symbolic_ydotool_arguments_for_all_paste_methods() {
        assert_eq!(
            ydotool_key_args(&PasteMethod::CtrlV, YdotoolKeySyntax::Symbolic).unwrap(),
            ["key", "ctrl+v"]
        );
        assert_eq!(
            ydotool_key_args(&PasteMethod::CtrlShiftV, YdotoolKeySyntax::Symbolic).unwrap(),
            ["key", "ctrl+shift+v"]
        );
        assert_eq!(
            ydotool_key_args(&PasteMethod::ShiftInsert, YdotoolKeySyntax::Symbolic).unwrap(),
            ["key", "shift+insert"]
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn generates_raw_ydotool_arguments_for_all_paste_methods() {
        assert_eq!(
            ydotool_key_args(&PasteMethod::CtrlV, YdotoolKeySyntax::RawKeycodes).unwrap(),
            ["key", "29:1", "47:1", "47:0", "29:0"]
        );
        assert_eq!(
            ydotool_key_args(&PasteMethod::CtrlShiftV, YdotoolKeySyntax::RawKeycodes).unwrap(),
            ["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
        );
        assert_eq!(
            ydotool_key_args(&PasteMethod::ShiftInsert, YdotoolKeySyntax::RawKeycodes).unwrap(),
            ["key", "42:1", "110:1", "110:0", "42:0"]
        );
    }

    #[test]
    fn auto_submit_requires_setting_enabled() {
        assert!(!should_send_auto_submit(false, PasteMethod::CtrlV));
        assert!(!should_send_auto_submit(false, PasteMethod::Direct));
    }

    #[test]
    fn auto_submit_skips_none_paste_method() {
        assert!(!should_send_auto_submit(true, PasteMethod::None));
    }

    #[test]
    fn auto_submit_runs_for_active_paste_methods() {
        assert!(should_send_auto_submit(true, PasteMethod::CtrlV));
        assert!(should_send_auto_submit(true, PasteMethod::Direct));
        assert!(should_send_auto_submit(true, PasteMethod::CtrlShiftV));
        assert!(should_send_auto_submit(true, PasteMethod::ShiftInsert));
    }

    #[test]
    fn clipboard_is_restored_before_key_injection_error_is_returned() {
        let restored = Cell::new(false);
        let result = finish_clipboard_paste(Err("input failed".into()), 0, || {
            restored.set(true);
        });

        assert_eq!(result.unwrap_err(), "input failed");
        assert!(restored.get());
    }
}
