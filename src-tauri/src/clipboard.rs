/**
 * 剪贴板历史模块
 * 与原 Electron 版本功能完全对等:
 *  - 每秒轮询系统剪贴板（文本 + 图片）
 *  - 类型智能识别：text / image / html / color / code
 *  - SQLite 持久化存储（最多 3000 条）
 *  - 提供 get / search / delete / clear / write-back / stats 命令
 *  - 新条目通过 Tauri 事件推送给前端
 */

use arboard::Clipboard;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String, // text | image | html | color | code
    pub content: String,   // text or image file path
    pub preview: String,
    pub source_app: String,
    pub timestamp: u64, // ms since epoch
    pub image_path: Option<String>,
    pub language: Option<String>,
    pub color_value: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardStats {
    pub total: u64,
    pub by_type: std::collections::HashMap<String, u64>,
}

// ──────────────────────────────────────────────────
// Internal state (shared across commands and polling thread)
// ──────────────────────────────────────────────────

pub struct ClipboardState {
    db: Option<Connection>,
    image_dir: PathBuf,
    last_text: String,
    last_image_hash: String,
}

impl ClipboardState {
    fn new(app_data_dir: &PathBuf) -> Result<Self, String> {
        let db_path = app_data_dir.join("userData").join("clipboard-history.db");
        let image_dir = app_data_dir.join("userData").join("clipboard-images");

        // Ensure dirs exist
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&image_dir).map_err(|e| e.to_string())?;

        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
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
                color_value TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_items(timestamp DESC);
            ",
        )
        .map_err(|e| e.to_string())?;

        Ok(ClipboardState {
            db: Some(conn),
            image_dir,
            last_text: String::new(),
            last_image_hash: String::new(),
        })
    }

    fn db(&self) -> Option<&Connection> {
        self.db.as_ref()
    }
}

// Global state, wrapped in Arc<Mutex<>>
pub type SharedClipboardState = Arc<Mutex<ClipboardState>>;

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

// ──────────────────────────────────────────────────
// DB helpers
// ──────────────────────────────────────────────────

fn db_insert(conn: &Connection, item: &ClipboardItem) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR REPLACE INTO clipboard_items
         (id, type, content, preview, source_app, timestamp, image_path, language, color_value)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
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
        ],
    )?;
    Ok(())
}

fn db_cleanup(conn: &Connection, image_dir: &PathBuf) {
    const MAX_ITEMS: i64 = 3000;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
        .unwrap_or(0);

    if count > MAX_ITEMS {
        let to_delete = count - MAX_ITEMS;
        // Get image paths of oldest items
        let mut stmt = conn
            .prepare(
                "SELECT image_path FROM clipboard_items WHERE image_path IS NOT NULL
                 ORDER BY timestamp ASC LIMIT ?1",
            )
            .unwrap();
        let paths: Vec<String> = stmt
            .query_map([to_delete], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();

        for p in paths {
            let _ = fs::remove_file(&p);
            // also try relative to image_dir
            let _ = fs::remove_file(image_dir.join(&p));
        }

        let _ = conn.execute(
            "DELETE FROM clipboard_items WHERE id IN
             (SELECT id FROM clipboard_items ORDER BY timestamp ASC LIMIT ?1)",
            [to_delete],
        );
    }
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardItem> {
    Ok(ClipboardItem {
        id: row.get(0)?,
        item_type: row.get(1)?,
        content: row.get(2)?,
        preview: row.get(3)?,
        source_app: row.get(4)?,
        timestamp: row.get::<_, i64>(5)? as u64,
        image_path: row.get(6)?,
        language: row.get(7)?,
        color_value: row.get(8)?,
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

        // Image extraction/hashing is expensive for large clipboard images.
        // Keep text polling at 1s, but only run image polling every 5s.
        const IMAGE_POLL_EVERY_TICKS: u64 = 5;
        let mut tick: u64 = 0;

        loop {
            std::thread::sleep(Duration::from_secs(1));
            tick = tick.saturating_add(1);

            // --- Try image first (throttled)
            if tick % IMAGE_POLL_EVERY_TICKS == 0 {
                if let Ok(img) = cb.get_image() {
                // Hash raw RGBA bytes — consistent with clipboard_write_to_clipboard
                let rgba_bytes = img.bytes.clone().into_owned();
                let hash = image_hash(&rgba_bytes);

                let png_data: Vec<u8> = {
                    // Convert RGBA ImageData → PNG bytes
                    use image::{ImageBuffer, Rgba};
                    let buf: ImageBuffer<Rgba<u8>, _> =
                        ImageBuffer::from_raw(img.width as u32, img.height as u32, rgba_bytes)
                            .unwrap_or_default();
                    let mut png_bytes: Vec<u8> = Vec::new();
                    let _ = buf.write_to(
                        &mut std::io::Cursor::new(&mut png_bytes),
                        image::ImageFormat::Png,
                    );
                    png_bytes
                };

                if png_data.is_empty() {
                    // fall through to text check
                } else {
                    let mut guard = match state.lock() {
                        Ok(g) => g,
                        Err(_) => continue,
                    };

                    if hash != guard.last_image_hash {
                        guard.last_image_hash = hash;

                        // Save PNG file
                        let filename = format!("{}-{}.png", now_ms(), &Uuid::new_v4().to_string()[..8]);
                        let filepath = guard.image_dir.join(&filename);
                        if fs::write(&filepath, &png_data).is_ok() {
                            let path_str = filepath.to_string_lossy().to_string();
                            let item = ClipboardItem {
                                id: Uuid::new_v4().to_string(),
                                item_type: "image".to_string(),
                                content: path_str.clone(),
                                preview: format!("Image ({} bytes)", png_data.len()),
                                source_app: "Unknown".to_string(),
                                timestamp: now_ms(),
                                image_path: Some(path_str),
                                language: None,
                                color_value: None,
                            };

                            if let Some(conn) = guard.db() {
                                let _ = db_insert(conn, &item);
                                db_cleanup(conn, &guard.image_dir.clone());
                            }
                            let _ = app.emit("clipboard:newItem", &item);
                        }
                    }
                    continue; // processed image, skip text check
                }
                }
            }

            // --- Text check
            if let Ok(text) = cb.get_text() {
                if text.is_empty() {
                    continue;
                }
                let mut guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };

                if text == guard.last_text {
                    continue;
                }
                guard.last_text = text.clone();

                let detected = detect_type(&text);
                let item = ClipboardItem {
                    id: Uuid::new_v4().to_string(),
                    item_type: detected.item_type.to_string(),
                    content: text.clone(),
                    preview: generate_preview(&text, 200),
                    source_app: "Unknown".to_string(),
                    timestamp: now_ms(),
                    image_path: None,
                    language: detected.language.map(str::to_string),
                    color_value: detected.color_value,
                };

                if let Some(conn) = guard.db() {
                    let _ = db_insert(conn, &item);
                    db_cleanup(conn, &guard.image_dir.clone());
                }
                let _ = app.emit("clipboard:newItem", &item);
            }
        }
    });
}

// ──────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn clipboard_get_items(
    state: tauri::State<SharedClipboardState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Vec<ClipboardItem> {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return vec![],
    };
    let conn = match guard.db() {
        Some(c) => c,
        None => return vec![],
    };
    let limit = limit.unwrap_or(50);
    let offset = offset.unwrap_or(0);

    let mut stmt = match conn.prepare(
        "SELECT id, type, content, preview, source_app, timestamp, image_path, language, color_value
         FROM clipboard_items ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![limit, offset], row_to_item)
        .unwrap_or_else(|_| panic!("query failed"))
        .flatten()
        .collect()
}

#[tauri::command]
pub fn clipboard_search_items(
    state: tauri::State<SharedClipboardState>,
    query: String,
    limit: Option<i64>,
) -> Vec<ClipboardItem> {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return vec![],
    };
    let conn = match guard.db() {
        Some(c) => c,
        None => return vec![],
    };

    if query.trim().is_empty() {
        drop(guard);
        return vec![];
    }

    let limit = limit.unwrap_or(50);
    let pattern = format!("%{}%", query);

    let mut stmt = match conn.prepare(
        "SELECT id, type, content, preview, source_app, timestamp, image_path, language, color_value
         FROM clipboard_items
         WHERE content LIKE ?1 OR preview LIKE ?2 OR source_app LIKE ?3
         ORDER BY timestamp DESC LIMIT ?4",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![pattern, pattern, pattern, limit], row_to_item)
        .unwrap_or_else(|_| panic!("query failed"))
        .flatten()
        .collect()
}

#[tauri::command]
pub fn clipboard_delete_item(
    state: tauri::State<SharedClipboardState>,
    id: String,
) -> bool {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let conn = match guard.db() {
        Some(c) => c,
        None => return false,
    };

    // Delete associated image if any
    let image_path: Option<String> = conn
        .query_row(
            "SELECT image_path FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(None);

    if let Some(p) = image_path {
        let _ = fs::remove_file(&p);
    }

    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .is_ok()
}

#[tauri::command]
pub fn clipboard_clear_all(state: tauri::State<SharedClipboardState>) -> bool {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let conn = match guard.db() {
        Some(c) => c,
        None => return false,
    };

    // Delete all image files
    if guard.image_dir.exists() {
        if let Ok(entries) = fs::read_dir(&guard.image_dir) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    conn.execute("DELETE FROM clipboard_items", []).is_ok()
}

#[tauri::command]
pub fn clipboard_write_to_clipboard(
    state: tauri::State<SharedClipboardState>,
    id: String,
) -> bool {
    // First look up the item
    let (item_type, content, image_path) = {
        let guard = match state.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        let conn = match guard.db() {
            Some(c) => c,
            None => return false,
        };
        let result: Option<(String, String, Option<String>)> = conn
            .query_row(
                "SELECT type, content, image_path FROM clipboard_items WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        match result {
            Some(r) => r,
            None => return false,
        }
    };

    // Write outside of the mutex lock to avoid deadlock with polling thread
    let mut cb = match Clipboard::new() {
        Ok(c) => c,
        Err(_) => return false,
    };

    if item_type == "image" {
        if let Some(p) = image_path {
            if let Ok(data) = fs::read(&p) {
                // Decode PNG back to RGBA for arboard
                if let Ok(img) = image::load_from_memory(&data) {
                    let rgba = img.to_rgba8();
                    let (w, h) = rgba.dimensions();
                    let raw_bytes = rgba.into_raw();
                    // Hash RGBA bytes — matches polling logic, prevents re-recording
                    let rgba_hash = image_hash(&raw_bytes);
                    let img_data = arboard::ImageData {
                        width: w as usize,
                        height: h as usize,
                        bytes: std::borrow::Cow::Owned(raw_bytes),
                    };
                    if cb.set_image(img_data).is_ok() {
                        if let Ok(mut guard) = state.lock() {
                            guard.last_image_hash = rgba_hash;
                        }
                        return true;
                    }
                }
            }
        }
        return false;
    }

    if cb.set_text(&content).is_ok() {
        if let Ok(mut guard) = state.lock() {
            guard.last_text = content;
        }
        return true;
    }
    false
}

#[tauri::command]
pub fn clipboard_get_stats(
    state: tauri::State<SharedClipboardState>,
) -> ClipboardStats {
    let guard = match state.lock() {
        Ok(g) => g,
        Err(_) => return ClipboardStats { total: 0, by_type: Default::default() },
    };
    let conn = match guard.db() {
        Some(c) => c,
        None => return ClipboardStats { total: 0, by_type: Default::default() },
    };

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM clipboard_items", [], |r| r.get(0))
        .unwrap_or(0);

    let mut stmt = conn
        .prepare("SELECT type, COUNT(*) FROM clipboard_items GROUP BY type")
        .unwrap();

    let by_type: std::collections::HashMap<String, u64> = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64)))
        .unwrap()
        .flatten()
        .collect();

    ClipboardStats {
        total: total as u64,
        by_type,
    }
}

// ──────────────────────────────────────────────────
// Public initialiser called from lib.rs setup
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn clipboard_get_image_data(image_path: String) -> Result<String, String> {
    let bytes = std::fs::read(&image_path)
        .map_err(|e| format!("Failed to read image: {e}"))?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

pub fn init(app: &AppHandle) -> SharedClipboardState {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("Cannot resolve app data dir");

    let state = Arc::new(Mutex::new(
        ClipboardState::new(&data_dir).expect("Failed to initialise clipboard DB"),
    ));

    // Seed last_text from current clipboard so we don't record on startup
    if let Ok(mut cb) = Clipboard::new() {
        if let Ok(text) = cb.get_text() {
            if let Ok(mut guard) = state.lock() {
                guard.last_text = text;
            }
        }
    }

    start_polling(app.clone(), Arc::clone(&state));

    state
}
