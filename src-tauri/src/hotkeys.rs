//! Global hotkeys management module for EVA.
//! Allows reading, configuring, and dynamically registering/unregistering global shortcuts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub static LAST_HUB_MODE: AtomicU8 = AtomicU8::new(0);
/// True while we wait for the hub webview to acknowledge it has rendered the
/// new mode; `hub_reveal` (or a 250ms fallback timer) shows the window.
pub static HUB_PENDING_REVEAL: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct HotkeyItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub shortcut: String,
    #[serde(rename = "defaultShortcut")]
    pub default_shortcut: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HotkeyAction {
    ToggleMain,
    HubClipboard,
    HubCommand,
    HubOcr,
    SaveClipboardImage,
}

pub type HotkeyActionMap = HashMap<Shortcut, HotkeyAction>;
pub type SharedHotkeyState = Arc<RwLock<HotkeyActionMap>>;

fn get_config_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("userData");
    if !base.exists() {
        let _ = fs::create_dir_all(&base);
    }
    base.join("hotkeys.json")
}

pub fn get_default_hotkeys() -> Vec<HotkeyItem> {
    vec![
        HotkeyItem {
            id: "toggle_main".to_string(),
            name: "唤起 / 隐藏 EVA 主窗口".to_string(),
            description: "全局一键呼出或快速隐藏 EVA 工作台主窗口".to_string(),
            shortcut: "Alt+KeyE".to_string(),
            default_shortcut: "Alt+KeyE".to_string(),
            enabled: true,
        },
        HotkeyItem {
            id: "hub_clipboard".to_string(),
            name: "剪贴板历史悬浮面板 (HUB)".to_string(),
            description: "弹出轻量剪贴板悬浮面板，支持方向键或 1~9 快捷选用写回".to_string(),
            shortcut: "Alt+KeyV".to_string(),
            default_shortcut: "Alt+KeyV".to_string(),
            enabled: true,
        },
        HotkeyItem {
            id: "hub_command".to_string(),
            name: "快捷命令与端口搜索 (HUB)".to_string(),
            description: "弹出轻量搜索面板，支持端口查询、一键 Kill 释放与即时计算器".to_string(),
            shortcut: "Alt+KeyK".to_string(),
            default_shortcut: "Alt+KeyK".to_string(),
            enabled: true,
        },
        HotkeyItem {
            id: "hub_ocr".to_string(),
            name: "剪贴板图片 AI 识别 (HUB)".to_string(),
            description: "现场识别剪贴板中的图片，识别文字自动写回剪贴板，可直接 ⌘V 粘贴".to_string(),
            shortcut: "CommandOrControl+Shift+Semicolon".to_string(),
            default_shortcut: "CommandOrControl+Shift+Semicolon".to_string(),
            enabled: true,
        },
        HotkeyItem {
            id: "save_clipboard_image".to_string(),
            name: "剪贴板图片存为文件".to_string(),
            description: "把剪贴板图片保存到指定目录，剪贴板替换为文件路径，可直接 ⌘V 粘贴路径".to_string(),
            shortcut: "CommandOrControl+Shift+Quote".to_string(),
            default_shortcut: "CommandOrControl+Shift+Quote".to_string(),
            enabled: true,
        },
    ]
}

pub fn load_saved_hotkeys(app: &AppHandle) -> Vec<HotkeyItem> {
    let path = get_config_path(app);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(items) = serde_json::from_str::<Vec<HotkeyItem>>(&content) {
                // Merge with defaults in case new items were added
                let mut merged = get_default_hotkeys();
                for def in &mut merged {
                    if let Some(saved) = items.iter().find(|i| i.id == def.id) {
                        def.shortcut = saved.shortcut.clone();
                        def.enabled = saved.enabled;
                    }
                }
                return merged;
            }
        }
    }
    get_default_hotkeys()
}

pub fn save_hotkeys_to_disk(app: &AppHandle, items: &[HotkeyItem]) -> Result<(), String> {
    let path = get_config_path(app);
    let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Helper to parse accelerator string into Tauri Shortcut
fn parse_shortcut(str: &str) -> Option<Shortcut> {
    str.parse::<Shortcut>().ok()
}

fn id_to_action(id: &str) -> Option<HotkeyAction> {
    match id {
        "toggle_main" => Some(HotkeyAction::ToggleMain),
        "hub_clipboard" => Some(HotkeyAction::HubClipboard),
        "hub_command" => Some(HotkeyAction::HubCommand),
        "hub_ocr" => Some(HotkeyAction::HubOcr),
        "save_clipboard_image" => Some(HotkeyAction::SaveClipboardImage),
        _ => None,
    }
}

/// Dynamically apply hotkeys to global shortcut manager
pub fn apply_hotkeys(app: &AppHandle, items: &[HotkeyItem]) -> Result<(), String> {
    let state = app
        .try_state::<SharedHotkeyState>()
        .ok_or_else(|| "SharedHotkeyState not managed".to_string())?;

    // Unregister all previously registered shortcuts first
    let _ = app.global_shortcut().unregister_all();

    let mut new_map: HotkeyActionMap = HashMap::new();

    for item in items {
        if !item.enabled || item.shortcut.trim().is_empty() {
            continue;
        }

        if let Some(action) = id_to_action(&item.id) {
            if let Some(sc) = parse_shortcut(&item.shortcut) {
                if let Err(e) = app.global_shortcut().register(sc.clone()) {
                    log::warn!(
                        "[Hotkeys] Failed to register shortcut '{}' for {}: {}",
                        item.shortcut,
                        item.id,
                        e
                    );
                } else {
                    new_map.insert(sc, action);
                }
            } else {
                log::warn!("[Hotkeys] Could not parse shortcut: {}", item.shortcut);
            }
        }
    }

    if let Ok(mut lock) = state.write() {
        *lock = new_map;
    }

    Ok(())
}

/// Execute the action corresponding to hotkey
pub fn handle_hotkey_action(app: &AppHandle, action: HotkeyAction) {
    match action {
        HotkeyAction::ToggleMain => {
            if let Some(win) = app.get_webview_window("main") {
                let is_visible = win.is_visible().unwrap_or(false);
                let is_focused = win.is_focused().unwrap_or(false);
                if is_visible && is_focused {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        }
        HotkeyAction::HubClipboard => trigger_hub(app, "clipboard", 1),
        HotkeyAction::HubCommand => trigger_hub(app, "command", 2),
        HotkeyAction::HubOcr => trigger_hub(app, "ocr", 3),
        HotkeyAction::SaveClipboardImage => {
            crate::clipboard::save_clipboard_image_to_disk(app);
        }
    }
}

/// Toggle a hub mode: if already visible+focused in this mode, hide; otherwise
/// notify the webview and wait for it to render before revealing the window,
/// so users never see a blank or stale frame.
fn trigger_hub(app: &AppHandle, mode: &'static str, code: u8) {
    let Some(hub) = app.get_webview_window("hub") else {
        return;
    };
    let is_visible = hub.is_visible().unwrap_or(false);
    let is_focused = hub.is_focused().unwrap_or(false);
    let last = LAST_HUB_MODE.load(Ordering::Relaxed);
    if is_visible && is_focused && last == code {
        let _ = hub.hide();
        LAST_HUB_MODE.store(0, Ordering::Relaxed);
        return;
    }

    LAST_HUB_MODE.store(code, Ordering::Relaxed);
    HUB_PENDING_REVEAL.store(true, Ordering::Relaxed);
    let _ = app.emit("eva://hub-mode", mode);

    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        if HUB_PENDING_REVEAL.load(Ordering::Relaxed) {
            reveal_hub(&app2);
        }
    });
}

pub fn reveal_hub(app: &AppHandle) {
    HUB_PENDING_REVEAL.store(false, Ordering::Relaxed);
    if let Some(hub) = app.get_webview_window("hub") {
        let _ = hub.center();
        let _ = hub.show();
        let _ = hub.unminimize();
        let _ = hub.set_focus();
    }
}

/// Called by the hub webview once the new mode has been applied to React state.
#[tauri::command]
pub fn hub_reveal(app: AppHandle) {
    reveal_hub(&app);
}

// ── Tauri Commands ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_hotkey_shortcuts_parse() {
        for item in get_default_hotkeys() {
            assert!(
                parse_shortcut(&item.shortcut).is_some(),
                "failed to parse default shortcut '{}' for {}",
                item.shortcut,
                item.id
            );
        }
    }
}

#[tauri::command]
pub fn hotkeys_get_all(app: AppHandle) -> Vec<HotkeyItem> {
    load_saved_hotkeys(&app)
}

#[tauri::command]
pub fn hotkeys_save_all(app: AppHandle, items: Vec<HotkeyItem>) -> Result<Vec<HotkeyItem>, String> {
    save_hotkeys_to_disk(&app, &items)?;
    apply_hotkeys(&app, &items)?;
    Ok(load_saved_hotkeys(&app))
}

#[tauri::command]
pub fn hotkeys_reset_all(app: AppHandle) -> Result<Vec<HotkeyItem>, String> {
    let defaults = get_default_hotkeys();
    save_hotkeys_to_disk(&app, &defaults)?;
    apply_hotkeys(&app, &defaults)?;
    Ok(defaults)
}
