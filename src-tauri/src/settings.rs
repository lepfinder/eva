//! Settings & storage management commands.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorageItem {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub size: u64,
    #[serde(rename = "sizeFormatted")]
    pub size_formatted: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StorageStats {
    pub total: u64,
    #[serde(rename = "totalFormatted")]
    pub total_formatted: String,
    pub items: Vec<StorageItem>,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

fn app_data(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir unavailable")
}

fn user_data(app: &AppHandle) -> PathBuf {
    app_data(app).join("userData")
}

fn format_size(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_owned();
    }
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let k: f64 = 1024.0;
    let i = (bytes as f64).log(k).floor() as usize;
    let i = i.min(UNITS.len() - 1);
    let v = bytes as f64 / k.powi(i as i32);
    format!("{:.1} {}", v, UNITS[i])
}

fn dir_size(path: &PathBuf) -> u64 {
    if !path.exists() {
        return 0;
    }
    let Ok(meta) = fs::metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let p = entry.path();
        total += dir_size(&p);
    }
    total
}

// ── Migration from Electron super-dashboard ───────────────────────────────────

/// Copy user data from the old Electron app (super-dashboard / eva) to this Tauri app.
/// Skips: visual_recall, clipboard-images, clipboard-history.db (large / privacy-sensitive).
/// Navigation is handled separately in navigation.rs.
pub fn try_migrate_user_data(app: &AppHandle) {
    let dst_base = user_data(app);
    let Some(home) = dirs::home_dir() else { return };
    let src_base = home.join("Library/Application Support/eva/userData");

    if !src_base.exists() {
        return;
    }

    // (src relative to src_base, dst relative to dst_base)
    let items: &[(&str, &str)] = &[
        ("vault.enc", "vault.enc"),
        ("activity-tracker.db", "activity-tracker.db"),
        ("knowledge_base", "knowledge_base"),
    ];

    for (src_rel, dst_rel) in items {
        let src = src_base.join(src_rel);
        let dst = dst_base.join(dst_rel);
        if src.exists() && !dst.exists() {
            if let Err(e) = copy_item(&src, &dst) {
                log::warn!("Migration: failed to copy {} → {}: {}", src_rel, dst_rel, e);
            } else {
                log::info!("Migration: copied {}", src_rel);
            }
        }
    }
}

fn copy_item(src: &PathBuf, dst: &PathBuf) -> Result<(), std::io::Error> {
    let meta = fs::metadata(src)?;
    if meta.is_file() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    } else if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let dst_child = dst.join(entry.file_name());
            copy_item(&entry.path(), &dst_child)?;
        }
    }
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> String {
    user_data(&app).to_string_lossy().into_owned()
}

#[tauri::command]
pub fn get_storage_stats(app: AppHandle) -> StorageStats {
    let base = user_data(&app);

    let item_configs: &[(&str, &str, &str)] = &[
        ("网站导航", "navigation", "navigation"),
        ("保险箱", "vault.enc", "vault"),
        ("活动记录", "activity-tracker.db", "activity_tracker"),
        ("视觉回溯", "visual_recall", "visual_recall"),
        ("剪贴板图片", "clipboard-images", "clipboard_images"),
        ("剪贴板历史", "clipboard-history.db", "clipboard_history"),
        ("知识库索引", "knowledge_base", "knowledge_base"),
    ];

    let mut items: Vec<StorageItem> = item_configs
        .iter()
        .map(|(name, rel, icon)| {
            let size = dir_size(&base.join(rel));
            StorageItem {
                name: name.to_string(),
                path: rel.to_string(),
                icon: icon.to_string(),
                size,
                size_formatted: format_size(size),
            }
        })
        .collect();

    // Sort descending by size
    items.sort_by(|a, b| b.size.cmp(&a.size));

    let total: u64 = items.iter().map(|i| i.size).sum();
    StorageStats {
        total,
        total_formatted: format_size(total),
        items,
    }
}

#[tauri::command]
pub fn open_in_finder(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}
