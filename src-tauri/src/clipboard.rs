/**
 * 剪贴板历史模块
 *  - changeCount 轮询：仅在系统剪贴板变化时读内容
 *  - 类型智能识别：text / image / html / color / code
 *  - SQLite 持久化（最多 10000 条）；连接按调用打开，状态锁不持有 Connection
 *  - 图片入库时写缩略图，列表走 asset protocol
 *  - html：content 存纯文本，html_content 存富文本，回填写 public.html
 */

use arboard::Clipboard;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;
use uuid::Uuid;

const MAX_ITEMS: i64 = 10000;
const CLEANUP_EVERY_N_INSERTS: u32 = 50;
const THUMB_MAX_EDGE: u32 = 400;

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String, // text | image | html | color | code
    pub content: String,   // plain text or image file path
    pub preview: String,
    pub source_app: String,
    pub timestamp: u64, // ms since epoch
    pub image_path: Option<String>,
    /// Thumbnail path for list UI (asset protocol). Computed / written beside original.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_path: Option<String>,
    pub language: Option<String>,
    pub color_value: Option<String>,
    /// Full HTML for rich-text paste-back. Omitted from list/search IPC payloads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStats {
    pub total: u64,
    pub by_type: std::collections::HashMap<String, u64>,
}

// ──────────────────────────────────────────────────
// Internal state (small fields only — no DB connection)
// ──────────────────────────────────────────────────

pub struct ClipboardState {
    db_path: PathBuf,
    image_dir: PathBuf,
    last_text: String,
    last_image_hash: String,
    /// Last observed NSPasteboard.changeCount (-1 = unset / non-macOS fallback).
    last_change_count: i64,
    /// True while we are writing back to the system clipboard (poller must skip).
    own_write_in_progress: bool,
    inserts_since_cleanup: u32,
}

impl ClipboardState {
    fn new(app_data_dir: &PathBuf) -> Result<Self, String> {
        let db_path = app_data_dir.join("userData").join("clipboard-history.db");
        let image_dir = app_data_dir.join("userData").join("clipboard-images");

        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;

        // Migrate schema once at startup; runtime opens fresh connections per call.
        {
            let conn = open_clipboard_db(&db_path)?;
            conn.execute_batch(
                "
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS clipboard_items (
                    id         TEXT PRIMARY KEY,
                    type       TEXT NOT NULL,
                    content    TEXT NOT NULL,
                    preview    TEXT NOT NULL,
                    source_app TEXT NOT NULL,
                    timestamp  INTEGER NOT NULL,
                    image_path TEXT,
                    language   TEXT,
                    color_value TEXT,
                    html_content TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_items(timestamp DESC);
                ",
            )
            .map_err(|e| e.to_string())?;
            let _ = conn.execute(
                "ALTER TABLE clipboard_items ADD COLUMN html_content TEXT",
                [],
            );
        }

        Ok(ClipboardState {
            db_path,
            image_dir,
            last_text: String::new(),
            last_image_hash: String::new(),
            last_change_count: -1,
            own_write_in_progress: false,
            inserts_since_cleanup: 0,
        })
    }
}

pub type SharedClipboardState = Arc<Mutex<ClipboardState>>;

fn open_clipboard_db(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
    Ok(conn)
}

fn with_db<T>(state: &SharedClipboardState, f: impl FnOnce(&Connection) -> T) -> Option<T> {
    let db_path = {
        let guard = state.lock().ok()?;
        guard.db_path.clone()
    };
    let conn = open_clipboard_db(&db_path).ok()?;
    Some(f(&conn))
}

// ──────────────────────────────────────────────────
// Type detection
// ──────────────────────────────────────────────────

struct Detected {
    item_type: &'static str,
    language: Option<&'static str>,
    color_value: Option<String>,
}

fn detect_type(text: &str) -> Detected {
    let trimmed = text.trim();

    // ── Color patterns
    if is_color(trimmed) {
        return Detected {
            item_type: "color",
            language: None,
            color_value: Some(trimmed.to_string()),
        };
    }

    // ── Code patterns
    if let Some(lang) = detect_code_language(trimmed) {
        return Detected {
            item_type: "code",
            language: Some(lang),
            color_value: None,
        };
    }

    Detected {
        item_type: "text",
        language: None,
        color_value: None,
    }
}

fn is_color(s: &str) -> bool {
    // #RGB, #RRGGBB, #RGBA, #RRGGBBAA
    if s.starts_with('#') {
        let hex = &s[1..];
        let all_hex = hex.chars().all(|c| c.is_ascii_hexdigit());
        let len = hex.len();
        return all_hex && matches!(len, 3 | 4 | 6 | 8);
    }
    // rgb(...), rgba(...), hsl(...), hsla(...)
    let lower = s.to_lowercase();
    let prefixes = ["rgb(", "rgba(", "hsl(", "hsla("];
    prefixes.iter().any(|p| lower.starts_with(p) && s.ends_with(')'))
}

fn detect_code_language(text: &str) -> Option<&'static str> {
    // Simple heuristic patterns per language
    let patterns: &[(&'static str, &[&str])] = &[
        ("sql", &["SELECT ", "INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE TABLE", "DROP TABLE", "ALTER TABLE"]),
        ("json", &[]),  // handled separately below
        ("html", &["<!DOCTYPE", "<html", "<div ", "<span ", "<p>", "<script"]),
        ("xml", &["<?xml", "<root>", "<item>"]),
        ("javascript", &["const ", "let ", "var ", "function ", "import ", "export ", "=>", "async function", "require("]),
        ("typescript", &["interface ", "type ", ": string", ": number", ": boolean", "as unknown", "as any"]),
        ("python", &["def ", "class ", "import ", "from ", "if __name__", "print(", "async def"]),
        ("rust", &["fn ", "let mut", "pub ", "use ", "impl ", "struct ", "enum ", "mod "]),
        ("go", &["package ", "func ", "type ", "import ("]),
        ("java", &["public class", "private ", "protected ", "import java", "public static void"]),
        ("shell", &["#!/", "echo ", "export ", "alias ", "if [", "for "]),
        ("css", &[".class", "@media", "@keyframes", "color:", "background:", "margin:", "padding:"]),
        ("markdown", &["# ", "## ", "### ", "```", "> ", "* ", "- [ ]"]),
    ];

    // JSON special case
    let trimmed = text.trim();
    if (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('[') && trimmed.ends_with(']'))
    {
        if trimmed.len() > 10 {
            return Some("json");
        }
    }

    for (lang, keywords) in patterns {
        for kw in *keywords {
            if text.contains(kw) {
                return Some(lang);
            }
        }
    }
    None
}

fn generate_preview(content: &str, max_len: usize) -> String {
    let trimmed = content.trim();
    // Collapse consecutive whitespace
    let collapsed: String = trimmed
        .chars()
        .fold(String::with_capacity(max_len + 4), |mut acc, c| {
            if c.is_whitespace() {
                if !acc.ends_with(' ') {
                    acc.push(' ');
                }
            } else {
                acc.push(c);
            }
            acc
        });

    if collapsed.len() <= max_len {
        collapsed
    } else {
        let mut end = max_len;
        while !collapsed.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &collapsed[..end])
    }
}

fn is_http_url(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.contains(char::is_whitespace) {
        return false;
    }

    Url::parse(trimmed)
        .map(|url| matches!(url.scheme(), "http" | "https") && url.has_host())
        .unwrap_or(false)
}

fn maybe_emit_url_detected(_app: &AppHandle, _state: &SharedClipboardState, _text: &str) {
    // 已根据用户需求停用剪贴板 URL 自动检测与广播
}

#[cfg(target_os = "macos")]
fn get_source_app() -> String {
    // 使用 lsappinfo（直接查询 WindowServer）获取前台应用的精确身份，
    // 按 ASN 独立标识，即使多个进程共享 com.github.Electron bundle ID 也不会混淆。
    let front_asn = match Command::new("lsappinfo").arg("front").output().ok() {
        Some(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        None => return "Unknown".to_string(),
    };
    if front_asn.is_empty() {
        return "Unknown".to_string();
    }

    let info_out = match Command::new("lsappinfo")
        .args(["info", "-only", "name", "-only", "bundleid", "-only", "bundlepath", &front_asn])
        .output()
        .ok()
    {
        Some(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        None => return "Unknown".to_string(),
    };

    let mut display_name = String::new();
    let mut bundle_id = String::new();
    let mut bundle_path = String::new();

    for line in info_out.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("\"LSDisplayName\"=") {
            display_name = val.trim_matches('"').to_string();
        } else if let Some(val) = line.strip_prefix("\"CFBundleIdentifier\"=") {
            bundle_id = val.trim_matches('"').to_string();
        } else if let Some(val) = line.strip_prefix("\"LSBundlePath\"=") {
            bundle_path = val.trim_matches('"').to_string();
        }
    }

    // 对于通用 Electron 进程，从 bundle path 推断实际应用名
    if bundle_id == "com.github.Electron" && !bundle_path.is_empty() {
        if let Some(project) = extract_clip_project_name(&bundle_path) {
            return project;
        }
    }

    let is_generic = |n: &str| {
        let l = n.to_lowercase();
        l.is_empty() || l == "missing value" || l == "electron" || l == "electron helper"
    };

    if !is_generic(&display_name) {
        display_name
    } else if !is_generic(&bundle_id) {
        if bundle_id.to_lowercase().contains("antigravity") {
            "Antigravity".to_string()
        } else if bundle_id.to_lowercase().contains("workbuddy") {
            "WorkBuddy".to_string()
        } else if let Some(last) = bundle_id.split('.').last() {
            if !is_generic(last) {
                last.to_string()
            } else {
                "Unknown".to_string()
            }
        } else {
            "Unknown".to_string()
        }
    } else {
        "Unknown".to_string()
    }
}

/// 从 bundle path 推断项目名
fn extract_clip_project_name(bundle_path: &str) -> Option<String> {
    if bundle_path.starts_with("/Applications/") {
        let app_name = bundle_path
            .strip_prefix("/Applications/")?
            .strip_suffix(".app")
            .or_else(|| bundle_path.strip_prefix("/Applications/"))?;
        return Some(app_name.to_string());
    }
    if let Some(idx) = bundle_path.find("/node_modules/") {
        let prefix = &bundle_path[..idx];
        let project = prefix.rsplit('/').next()?;
        if !project.is_empty() {
            return Some(project.to_string());
        }
    }
    if let Some(idx) = bundle_path.rfind(".app") {
        let before_app = &bundle_path[..idx];
        let name = before_app.rsplit('/').next()?;
        if !name.is_empty() && name != "Electron" {
            return Some(name.to_string());
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn get_source_app() -> String {
    "Unknown".to_string()
}

#[cfg(target_os = "macos")]
fn nsstring(value: &str) -> Option<*mut objc::runtime::Object> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    use std::os::raw::c_char;

    let c_string = CString::new(value).ok()?;
    let ns_string: *mut Object = unsafe {
        msg_send![class!(NSString), stringWithUTF8String: c_string.as_ptr() as *const c_char]
    };
    if ns_string.is_null() {
        None
    } else {
        Some(ns_string)
    }
}

#[cfg(target_os = "macos")]
fn nsstring_to_string(value: *mut objc::runtime::Object) -> Option<String> {
    use objc::runtime::Object;
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::CStr;
    use std::os::raw::c_char;

    if value.is_null() {
        return None;
    }

    let c_str: *const c_char = unsafe { msg_send![value as *mut Object, UTF8String] };
    if c_str.is_null() {
        None
    } else {
        Some(unsafe { CStr::from_ptr(c_str) }.to_string_lossy().into_owned())
    }
}

#[cfg(target_os = "macos")]
fn read_clipboard_html() -> Option<String> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let pasteboard: *mut Object = unsafe { msg_send![class!(NSPasteboard), generalPasteboard] };
    if pasteboard.is_null() {
        return None;
    }

    let html_type = nsstring("public.html")?;
    let html_value: *mut Object = unsafe { msg_send![pasteboard, stringForType: html_type] };
    nsstring_to_string(html_value).filter(|html| !html.trim().is_empty())
}

#[cfg(not(target_os = "macos"))]
fn read_clipboard_html() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn write_clipboard_html(html: &str, plain: &str) -> Result<(), String> {
    use objc::runtime::{Object, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};

    let pasteboard: *mut Object = unsafe { msg_send![class!(NSPasteboard), generalPasteboard] };
    if pasteboard.is_null() {
        return Err("NSPasteboard unavailable".into());
    }

    let _: u64 = unsafe { msg_send![pasteboard, clearContents] };

    let html_type = nsstring("public.html").ok_or_else(|| "failed to create html type".to_string())?;
    let plain_type =
        nsstring("public.utf8-plain-text").ok_or_else(|| "failed to create plain type".to_string())?;
    let html_ns = nsstring(html).ok_or_else(|| "failed to create html string".to_string())?;
    let plain_ns = nsstring(plain).ok_or_else(|| "failed to create plain string".to_string())?;

    let ok_html: BOOL = unsafe { msg_send![pasteboard, setString: html_ns forType: html_type] };
    let ok_plain: BOOL = unsafe { msg_send![pasteboard, setString: plain_ns forType: plain_type] };

    if ok_plain == YES {
        let _ = ok_html;
        Ok(())
    } else {
        Err("failed to set clipboard plain text".into())
    }
}

#[cfg(not(target_os = "macos"))]
fn write_clipboard_html(_html: &str, plain: &str) -> Result<(), String> {
    set_clipboard_text(plain)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn image_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Convert arboard RGBA image bytes to deterministic PNG, then return PNG bytes.
fn encode_clipboard_image_png(img: &arboard::ImageData) -> Vec<u8> {
    use image::{ImageBuffer, Rgba};
    let rgba_bytes = img.bytes.clone().into_owned();
    let buf: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(img.width as u32, img.height as u32, rgba_bytes).unwrap_or_default();
    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = buf.write_to(
        &mut std::io::Cursor::new(&mut png_bytes),
        image::ImageFormat::Png,
    );
    png_bytes
}

fn hash_clipboard_image(cb: &mut Clipboard) -> Option<String> {
    let img = cb.get_image().ok()?;
    let png_data = encode_clipboard_image_png(&img);
    if png_data.is_empty() {
        None
    } else {
        Some(image_hash(&png_data))
    }
}

#[cfg(target_os = "macos")]
fn pasteboard_change_count() -> Option<i64> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    let pasteboard: *mut Object = unsafe { msg_send![class!(NSPasteboard), generalPasteboard] };
    if pasteboard.is_null() {
        return None;
    }
    let count: isize = unsafe { msg_send![pasteboard, changeCount] };
    Some(count as i64)
}

#[cfg(not(target_os = "macos"))]
fn pasteboard_change_count() -> Option<i64> {
    None
}

fn thumb_path_for(image_path: &Path) -> PathBuf {
    let stem = image_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    image_path.with_file_name(format!("{stem}.thumb.png"))
}

fn resolve_thumb_path(image_path: &Option<String>) -> Option<String> {
    let path = image_path.as_ref()?;
    let thumb = thumb_path_for(Path::new(path));
    if thumb.exists() {
        Some(thumb.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn write_thumbnail_from_png(png_data: &[u8], image_path: &Path) -> Option<String> {
    let img = image::load_from_memory(png_data).ok()?;
    let thumb = img.thumbnail(THUMB_MAX_EDGE, THUMB_MAX_EDGE);
    let thumb_path = thumb_path_for(image_path);
    thumb
        .save_with_format(&thumb_path, image::ImageFormat::Png)
        .ok()?;
    Some(thumb_path.to_string_lossy().into_owned())
}

fn remove_image_files(image_path: &str) {
    let path = Path::new(image_path);
    let _ = fs::remove_file(path);
    let _ = fs::remove_file(thumb_path_for(path));
}

fn begin_own_write(state: &SharedClipboardState) {
    if let Ok(mut guard) = state.lock() {
        guard.own_write_in_progress = true;
    }
}

fn finish_own_write(
    state: &SharedClipboardState,
    last_text: Option<String>,
    last_image_hash: Option<String>,
) {
    if let Ok(mut guard) = state.lock() {
        if let Some(c) = pasteboard_change_count() {
            guard.last_change_count = c;
        }
        if let Some(t) = last_text {
            guard.last_text = t;
        }
        if let Some(h) = last_image_hash {
            guard.last_image_hash = h;
        }
        guard.own_write_in_progress = false;
    }
}

fn abort_own_write(state: &SharedClipboardState) {
    if let Ok(mut guard) = state.lock() {
        guard.own_write_in_progress = false;
    }
}

fn record_insert_and_maybe_cleanup(state: &SharedClipboardState, item: &ClipboardItem) {
    let (db_path, image_dir, should_cleanup) = {
        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        guard.inserts_since_cleanup = guard.inserts_since_cleanup.saturating_add(1);
        let should = guard.inserts_since_cleanup >= CLEANUP_EVERY_N_INSERTS;
        if should {
            guard.inserts_since_cleanup = 0;
        }
        (guard.db_path.clone(), guard.image_dir.clone(), should)
    };

    if let Ok(conn) = open_clipboard_db(&db_path) {
        let _ = db_insert(&conn, item);
        if should_cleanup {
            db_cleanup(&conn, &image_dir);
        }
    }
}

// ──────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────

fn db_insert(conn: &Connection, item: &ClipboardItem) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
         (id, type, content, preview, source_app, timestamp, image_path, language, color_value, html_content)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            item.id,
            item.item_type,
            item.content,
            item.preview,
            item.source_app,
            item.timestamp as i64,
            item.image_path,
            item.language,
            item.color_value,
            item.html_content,
        ],
    )?;
    Ok(())
}

fn db_cleanup(conn: &Connection, image_dir: &PathBuf) {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
        .unwrap_or(0);

    if count > MAX_ITEMS {
        let to_delete = count - MAX_ITEMS;
        let paths: Vec<String> = match conn.prepare(
            "SELECT image_path FROM clipboard_items WHERE image_path IS NOT NULL
             ORDER BY timestamp ASC LIMIT ?1",
        ) {
            Ok(mut stmt) => stmt
                .query_map([to_delete], |r| r.get(0))
                .map(|rows| rows.flatten().collect())
                .unwrap_or_default(),
            Err(_) => return,
        };

        for p in paths {
            remove_image_files(&p);
            let _ = fs::remove_file(image_dir.join(Path::new(&p).file_name().unwrap_or_default()));
        }

        let _ = conn.execute(
            "DELETE FROM clipboard_items WHERE id IN
             (SELECT id FROM clipboard_items ORDER BY timestamp ASC LIMIT ?1)",
            [to_delete],
        );
    }
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardItem> {
    let image_path: Option<String> = row.get(6)?;
    let thumb_path = resolve_thumb_path(&image_path);
    Ok(ClipboardItem {
        id: row.get(0)?,
        item_type: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        source_app: row.get(4)?,
        timestamp: row.get::<_, i64>(5)? as u64,
        image_path,
        thumb_path,
        language: row.get(7)?,
        color_value: row.get(8)?,
        // List/search queries intentionally omit html_content to keep IPC payloads small.
        html_content: None,
    })
}

// ──────────────────────────────────────────────────
// Background polling thread
// ──────────────────────────────────────────────────

pub fn start_polling(app: AppHandle, state: SharedClipboardState) {
    std::thread::spawn(move || {
        let mut cb = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                log::error!("[Clipboard] Failed to open clipboard: {}", e);
                return;
            }
        };

        // Align changeCount so the current pasteboard is not treated as "new".
        if let Some(count) = pasteboard_change_count() {
            if let Ok(mut guard) = state.lock() {
                guard.last_change_count = count;
            }
        }

        loop {
            std::thread::sleep(Duration::from_secs(1));

            // Fast path: skip when pasteboard has not changed (macOS).
            if let Some(count) = pasteboard_change_count() {
                let mut guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                if guard.own_write_in_progress {
                    continue;
                }
                if count == guard.last_change_count {
                    continue;
                }
                guard.last_change_count = count;
            } else {
                let guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                if guard.own_write_in_progress {
                    continue;
                }
            }

            // --- Try image first
            if let Ok(img) = cb.get_image() {
                let png_data = encode_clipboard_image_png(&img);

                if !png_data.is_empty() {
                    let hash = image_hash(&png_data);
                    {
                        let mut guard = match state.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        if hash == guard.last_image_hash {
                            continue;
                        }
                        guard.last_image_hash = hash;
                    }

                    let source_app = get_source_app();
                    let image_dir = {
                        let guard = match state.lock() {
                            Ok(g) => g,
                            Err(_) => continue,
                        };
                        guard.image_dir.clone()
                    };

                    let filename = format!("{}-{}.png", now_ms(), &Uuid::new_v4().to_string()[..8]);
                    let filepath = image_dir.join(&filename);
                    if fs::write(&filepath, &png_data).is_ok() {
                        let path_str = filepath.to_string_lossy().to_string();
                        let thumb_path = write_thumbnail_from_png(&png_data, &filepath);
                        let item = ClipboardItem {
                            id: Uuid::new_v4().to_string(),
                            item_type: "image".to_string(),
                            content: path_str.clone(),
                            preview: format!("Image {}x{}", img.width, img.height),
                            source_app,
                            timestamp: now_ms(),
                            image_path: Some(path_str),
                            thumb_path,
                            language: None,
                            color_value: None,
                            html_content: None,
                        };

                        record_insert_and_maybe_cleanup(&state, &item);
                        let _ = app.emit("clipboard:newItem", &item);
                    }
                    continue;
                }
            }

            // --- Text check
            if let Ok(text) = cb.get_text() {
                if text.is_empty() {
                    continue;
                }
                {
                    let mut guard = match state.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };

                    if text == guard.last_text {
                        continue;
                    }
                    guard.last_text = text.clone();
                }

                let html = read_clipboard_html();
                let detected = detect_type(&text);
                let is_html = detected.item_type == "text"
                    && html.as_ref().is_some_and(|value| value.len() > text.len());
                let item_type = if is_html { "html" } else { detected.item_type };
                let html_content = if is_html { html } else { None };

                let item = ClipboardItem {
                    id: Uuid::new_v4().to_string(),
                    item_type: item_type.to_string(),
                    content: text.clone(),
                    preview: generate_preview(&text, 200),
                    source_app: get_source_app(),
                    timestamp: now_ms(),
                    image_path: None,
                    thumb_path: None,
                    language: detected.language.map(str::to_string),
                    color_value: detected.color_value,
                    html_content,
                };

                let mut emit_item = item.clone();
                emit_item.html_content = None;

                record_insert_and_maybe_cleanup(&state, &item);
                let _ = app.emit("clipboard:newItem", &emit_item);
                maybe_emit_url_detected(&app, &state, &text);
            }
        }
    });
}

// ──────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardDailyStat {
    pub date: String,
    pub count: u64,
}

#[tauri::command]
pub fn clipboard_get_daily_stats(
    state: tauri::State<SharedClipboardState>,
) -> Vec<ClipboardDailyStat> {
    with_db(&state, |conn| {
        let mut stmt = match conn.prepare(
            "SELECT date(datetime(timestamp / 1000, 'unixepoch', 'localtime')) AS day, COUNT(*)
             FROM clipboard_items
             WHERE day IS NOT NULL
             GROUP BY day
             ORDER BY day DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map([], |r| {
            Ok(ClipboardDailyStat {
                date: r.get(0)?,
                count: r.get::<_, i64>(1)? as u64,
            })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    })
    .unwrap_or_default()
}

pub fn db_get_items(conn: &Connection, limit: i64, offset: i64, date_filter: Option<&str>) -> Vec<ClipboardItem> {
    if let Some(date) = date_filter.filter(|d| !d.trim().is_empty()) {
        let mut stmt = match conn.prepare(
            "SELECT id, type,
                    CASE WHEN type = 'image' THEN content ELSE substr(content, 1, 1200) END AS content,
                    preview, source_app, timestamp, image_path, language, color_value
             FROM clipboard_items
             WHERE date(datetime(timestamp / 1000, 'unixepoch', 'localtime')) = ?1
             ORDER BY timestamp DESC LIMIT ?2 OFFSET ?3",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map(params![date, limit, offset], row_to_item)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, type,
                    CASE WHEN type = 'image' THEN content ELSE substr(content, 1, 1200) END AS content,
                    preview, source_app, timestamp, image_path, language, color_value
             FROM clipboard_items ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map(params![limit, offset], row_to_item)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }
}

pub fn db_search_items(conn: &Connection, query: &str, limit: i64, date_filter: Option<&str>) -> Vec<ClipboardItem> {
    if query.trim().is_empty() {
        return vec![];
    }
    let pattern = format!("%{}%", query.trim());

    if let Some(date) = date_filter.filter(|d| !d.trim().is_empty()) {
        let mut stmt = match conn.prepare(
            "SELECT id, type,
                    CASE WHEN type = 'image' THEN content ELSE substr(content, 1, 1200) END AS content,
                    preview, source_app, timestamp, image_path, language, color_value
             FROM clipboard_items
             WHERE (content LIKE ?1 OR preview LIKE ?2 OR source_app LIKE ?3)
               AND date(datetime(timestamp / 1000, 'unixepoch', 'localtime')) = ?4
             ORDER BY timestamp DESC LIMIT ?5",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map(params![pattern, pattern, pattern, date, limit], row_to_item)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, type,
                    CASE WHEN type = 'image' THEN content ELSE substr(content, 1, 1200) END AS content,
                    preview, source_app, timestamp, image_path, language, color_value
             FROM clipboard_items
             WHERE (content LIKE ?1 OR preview LIKE ?2 OR source_app LIKE ?3)
             ORDER BY timestamp DESC LIMIT ?4",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map(params![pattern, pattern, pattern, limit], row_to_item)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }
}

pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    let mut cb = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {}", e))?;
    cb.set_text(text).map_err(|e| format!("Failed to set clipboard text: {}", e))
}

#[tauri::command]
pub fn clipboard_get_items(
    state: tauri::State<SharedClipboardState>,
    limit: Option<i64>,
    offset: Option<i64>,
    date_filter: Option<String>,
) -> Vec<ClipboardItem> {
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);
    with_db(&state, |conn| db_get_items(conn, limit, offset, date_filter.as_deref()))
        .unwrap_or_default()
}

#[tauri::command]
pub fn clipboard_search_items(
    state: tauri::State<SharedClipboardState>,
    query: String,
    limit: Option<i64>,
    date_filter: Option<String>,
) -> Vec<ClipboardItem> {
    if query.trim().is_empty() {
        return vec![];
    }
    let limit = limit.unwrap_or(50);
    with_db(&state, |conn| {
        db_search_items(conn, &query, limit, date_filter.as_deref())
    })
    .unwrap_or_default()
}

#[tauri::command]
pub fn clipboard_delete_item(
    state: tauri::State<SharedClipboardState>,
    id: String,
) -> bool {
    with_db(&state, |conn| {
        let image_path: Option<String> = conn
            .query_row(
                "SELECT image_path FROM clipboard_items WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(None);

        if let Some(p) = image_path {
            remove_image_files(&p);
        }

        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
            .is_ok()
    })
    .unwrap_or(false)
}

#[tauri::command]
pub fn clipboard_clear_all(state: tauri::State<SharedClipboardState>) -> bool {
    let image_dir = {
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        guard.image_dir.clone()
    };

    if image_dir.exists() {
        if let Ok(entries) = fs::read_dir(&image_dir) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    with_db(&state, |conn| conn.execute("DELETE FROM clipboard_items", []).is_ok()).unwrap_or(false)
}

#[tauri::command]
pub fn clipboard_write_to_clipboard(
    state: tauri::State<SharedClipboardState>,
    id: String,
) -> bool {
    let result: Option<(String, String, Option<String>, Option<String>)> = with_db(&state, |conn| {
        conn.query_row(
            "SELECT type, content, image_path, html_content FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()
    })
    .flatten();

    let (item_type, content, image_path, html_content) = match result {
        Some(r) => r,
        None => return false,
    };

    begin_own_write(&state);

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => {
            abort_own_write(&state);
            return false;
        }
    };

    if item_type == "image" {
        if let Some(p) = image_path {
            if let Ok(data) = fs::read(&p) {
                if let Ok(img) = image::load_from_memory(&data) {
                    let rgba = img.to_rgba8();
                    let (w, h) = rgba.dimensions();
                    let raw_bytes = rgba.into_raw();

                    let img_data = arboard::ImageData {
                        width: w as usize,
                        height: h as usize,
                        bytes: std::borrow::Cow::Owned(raw_bytes),
                    };
                    if cb.set_image(img_data).is_ok() {
                        let hash = hash_clipboard_image(&mut cb);
                        finish_own_write(&state, None, hash);
                        return true;
                    }
                }
            }
        }
        abort_own_write(&state);
        return false;
    }

    let write_ok = if let Some(html) = html_content.filter(|h| !h.is_empty()) {
        write_clipboard_html(&html, &content).is_ok()
    } else {
        cb.set_text(&content).is_ok()
    };

    if write_ok {
        finish_own_write(&state, Some(content), None);
        true
    } else {
        abort_own_write(&state);
        false
    }
}

#[tauri::command]
pub fn clipboard_get_stats(state: tauri::State<SharedClipboardState>) -> ClipboardStats {
    with_db(&state, |conn| {
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
            .unwrap_or(0);

        let mut stmt = match conn.prepare("SELECT type, COUNT(*) FROM clipboard_items GROUP BY type")
        {
            Ok(s) => s,
            Err(_) => {
                return ClipboardStats {
                    total: total as u64,
                    by_type: Default::default(),
                };
            }
        };

        let by_type: std::collections::HashMap<String, u64> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default();

        ClipboardStats {
            total: total as u64,
            by_type,
        }
    })
    .unwrap_or(ClipboardStats {
        total: 0,
        by_type: Default::default(),
    })
}

#[tauri::command]
pub fn clipboard_get_image_data(image_path: String) -> Result<String, String> {
    // Fallback for callers that still need a data URL (prefer asset protocol + thumb_path).
    let bytes = std::fs::read(&image_path).map_err(|e| format!("Failed to read image: {e}"))?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

pub fn emit_clipboard_url_if_present(app: &AppHandle, state: &SharedClipboardState) {
    if let Ok(mut clipboard) = Clipboard::new() {
        if let Ok(text) = clipboard.get_text() {
            maybe_emit_url_detected(app, state, &text);
        }
    }
}

#[tauri::command]
pub fn clipboard_write_image_data(
    state: tauri::State<SharedClipboardState>,
    data_base64: String,
) -> bool {
    let clean_base64 = if let Some(idx) = data_base64.find(',') {
        &data_base64[idx + 1..]
    } else {
        &data_base64
    };

    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(clean_base64) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i,
        Err(_) => return false,
    };

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let raw_bytes = rgba.into_raw();

    begin_own_write(&state);

    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => {
            abort_own_write(&state);
            return false;
        }
    };

    let img_data = arboard::ImageData {
        width: w as usize,
        height: h as usize,
        bytes: std::borrow::Cow::Owned(raw_bytes),
    };

    if cb.set_image(img_data).is_ok() {
        let hash = hash_clipboard_image(&mut cb);
        finish_own_write(&state, None, hash);
        true
    } else {
        abort_own_write(&state);
        false
    }
}

pub fn init(app: &AppHandle) -> SharedClipboardState {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Cannot resolve app data dir");

    let state = Arc::new(Mutex::new(
        ClipboardState::new(&data_dir).expect("Failed to initialise clipboard DB"),
    ));

    // Seed last_* and changeCount so we don't re-record on startup
    if let Ok(mut cb) = Clipboard::new() {
        if let Ok(mut guard) = state.lock() {
            if let Ok(text) = cb.get_text() {
                guard.last_text = text;
            }
            if let Some(hash) = hash_clipboard_image(&mut cb) {
                guard.last_image_hash = hash;
            }
            if let Some(count) = pasteboard_change_count() {
                guard.last_change_count = count;
            }
        }
    }

    start_polling(app.clone(), Arc::clone(&state));

    state
}
