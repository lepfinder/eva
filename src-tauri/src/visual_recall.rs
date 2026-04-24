// visual_recall.rs — 视觉回溯模块
//
// 截图采集：macOS screencapture -x（静默，无快门声）
// 存储格式：JPEG（缩略图 480px + 原图 1920px）
// 去重算法：SHA-256 采样哈希，与上一帧比较
// 触发策略：窗口标题变化 + 定时兜底（30s）+ 最小间隔防抖（5s）
// 图片服务：Tauri asset 协议（前端使用 convertFileSrc 获取 URL）

use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

// ─────────────────────────────────────────
// 常量
// ─────────────────────────────────────────

const THUMB_WIDTH: u32 = 480;
const FULL_WIDTH: u32 = 1920;
const JPEG_QUALITY: u8 = 82;
const POLL_INTERVAL_MS: u64 = 8_000; // 每8秒采样一次，搭配 debounce
const MIN_CAPTURE_SECS: f64 = 5.0; // 最小采集间隔（防抖）
const FORCED_CAPTURE_SECS: f64 = 30.0; // 即使标题未变也强制采集一次

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrConfig {
    pub enabled: bool,
    pub interval_secs: u64,
    pub max_storage_mb: u64,
}

impl Default for VrConfig {
    fn default() -> Self {
        VrConfig {
            enabled: false,
            interval_secs: 10,
            max_storage_mb: 2048,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VrSnapshot {
    pub id: i64,
    pub timestamp: i64,
    pub app_name: String,
    pub window_title: String,
    pub thumb_path: String,    // 绝对路径，前端用 convertFileSrc 加载
    pub full_path: Option<String>, // 同上，可为 None（旧数据）
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VrSearchResult {
    pub snapshots: Vec<VrSnapshot>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VrStorageStats {
    pub total_bytes: u64,
    pub snapshot_count: usize,
    pub oldest_ts: Option<i64>,
    pub newest_ts: Option<i64>,
}

// ─────────────────────────────────────────
// 共享状态
// ─────────────────────────────────────────

struct VrInner {
    config: VrConfig,
    last_hash: Option<String>,
    last_capture_secs: f64,
    last_window_title: String,
    last_app_name: String,
    data_path: PathBuf,
}

type SharedVrInner = Arc<Mutex<VrInner>>;

pub struct VisualRecallState(SharedVrInner);

// ─────────────────────────────────────────
// 路径辅助
// ─────────────────────────────────────────

fn db_path(data_path: &Path) -> PathBuf {
    data_path.join("visual_recall.db")
}

fn screenshots_dir(data_path: &Path) -> PathBuf {
    data_path.join("screenshots")
}

/// 利用 macOS `date -r` 将 unix 秒数转为本地 YYYY/MM/DD 字符串
fn secs_to_date_dir(secs: i64) -> String {
    let out = Command::new("date")
        .args(["-r", &secs.to_string(), "+%Y/%m/%d"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    let s = out.trim().to_string();
    if s.len() == 10 {
        s.replace('-', "/")
    } else {
        "unknown".to_string()
    }
}

// ─────────────────────────────────────────
// 数据库
// ─────────────────────────────────────────

fn init_db(data_path: &Path) {
    let path = db_path(data_path);
    let conn = match Connection::open(&path) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[VisualRecall] DB open failed: {}", e);
            return;
        }
    };
    if let Err(e) = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS screen_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            app_name    TEXT,
            window_title TEXT,
            thumb_path  TEXT,
            full_path   TEXT,
            content_hash TEXT UNIQUE
        );
        CREATE INDEX IF NOT EXISTS idx_vr_time ON screen_snapshots(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_vr_app ON screen_snapshots(app_name);",
    ) {
        log::error!("[VisualRecall] DB init failed: {}", e);
    }
}

fn db_insert(
    data_path: &Path,
    timestamp: i64,
    app_name: &str,
    window_title: &str,
    thumb_path: &str,
    full_path: Option<&str>,
    hash: &str,
) -> Option<i64> {
    let conn = Connection::open(db_path(data_path)).ok()?;
    conn.execute(
        "INSERT INTO screen_snapshots (timestamp, app_name, window_title, thumb_path, full_path, content_hash) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![timestamp, app_name, window_title, thumb_path, full_path, hash],
    )
    .ok()?;
    Some(conn.last_insert_rowid())
}

fn db_query_by_time_range(
    data_path: &Path,
    start_ts: i64,
    end_ts: i64,
    limit: i64,
) -> Vec<VrSnapshot> {
    let conn = match Connection::open(db_path(data_path)) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, timestamp, app_name, window_title, thumb_path, full_path \
         FROM screen_snapshots \
         WHERE timestamp >= ?1 AND timestamp <= ?2 \
         ORDER BY timestamp DESC \
         LIMIT ?3",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map(params![start_ts, end_ts, limit], |row| {
        Ok(VrSnapshot {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            app_name: row.get(2).unwrap_or_default(),
            window_title: row.get(3).unwrap_or_default(),
            thumb_path: row.get(4).unwrap_or_default(),
            full_path: row.get(5)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn db_get_stats(data_path: &Path) -> VrStorageStats {
    let conn = match Connection::open(db_path(data_path)) {
        Ok(c) => c,
        Err(_) => {
            return VrStorageStats {
                total_bytes: 0,
                snapshot_count: 0,
                oldest_ts: None,
                newest_ts: None,
            }
        }
    };

    let count: usize = conn
        .query_row("SELECT COUNT(*) FROM screen_snapshots", [], |r| r.get(0))
        .unwrap_or(0);
    let oldest_ts: Option<i64> = conn
        .query_row(
            "SELECT MIN(timestamp) FROM screen_snapshots",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let newest_ts: Option<i64> = conn
        .query_row(
            "SELECT MAX(timestamp) FROM screen_snapshots",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    // 估算磁盘占用（遍历目录）
    let total_bytes = dir_size(&screenshots_dir(data_path));

    VrStorageStats {
        total_bytes,
        snapshot_count: count,
        oldest_ts,
        newest_ts,
    }
}

fn dir_size(dir: &Path) -> u64 {
    if !dir.exists() {
        return 0;
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                total += dir_size(&path);
            } else if let Ok(meta) = fs::metadata(&path) {
                total += meta.len();
            }
        }
    }
    total
}

// ─────────────────────────────────────────
// 截图采集
// ─────────────────────────────────────────

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 使用 macOS screencapture -x 截图主屏到临时文件并读取字节
fn capture_screen_bytes() -> Result<Vec<u8>, String> {
    let ts = now_ms();
    let temp_path = std::env::temp_dir().join(format!("eva-vr-{}.png", ts));
    let temp_str = temp_path.to_string_lossy().to_string();

    let status = Command::new("screencapture")
        .args(["-x", "-t", "png", "-m", &temp_str])
        .status()
        .map_err(|e| format!("screencapture exec failed: {}", e))?;

    if !status.success() {
        return Err("screencapture returned non-zero".to_string());
    }
    if !temp_path.exists() {
        return Err("screencapture output file missing".to_string());
    }

    let bytes = fs::read(&temp_path).map_err(|e| format!("read temp file: {}", e))?;
    let _ = fs::remove_file(&temp_path);
    Ok(bytes)
}

/// SHA-256 采样哈希（首/中/尾 各 10KB），与 Python 版本策略一致
fn sampled_hash(data: &[u8]) -> String {
    const CHUNK: usize = 10_240;
    let len = data.len();
    let mut h = Sha256::new();
    if len <= CHUNK * 3 {
        h.update(data);
    } else {
        h.update(&data[..CHUNK]);
        let mid = len / 2;
        h.update(&data[mid..mid + CHUNK]);
        h.update(&data[len - CHUNK..]);
    }
    hex::encode(h.finalize())
}

/// 保存 JPEG（缩略图 + 原图）到目录，返回 (thumb_abs_path, full_abs_path)
fn save_images(
    img: &DynamicImage,
    screenshots_base: &Path,
    timestamp: i64,
) -> Result<(String, String), String> {
    let date_dir = secs_to_date_dir(timestamp / 1000);
    let target_dir = screenshots_base.join(&date_dir);
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("mkdir failed: {}", e))?;

    let base_name = format!("snapshot_{}", timestamp);

    // ── 缩略图
    let thumb = img.thumbnail(THUMB_WIDTH, THUMB_WIDTH * 100);
    let thumb_path = target_dir.join(format!("{}_thumb.jpg", base_name));
    save_jpeg(&thumb, &thumb_path)?;

    // ── 原图（最大宽度 1920）
    let full = if img.width() > FULL_WIDTH {
        img.thumbnail(FULL_WIDTH, FULL_WIDTH * 100)
    } else {
        img.clone()
    };
    let full_path = target_dir.join(format!("{}_full.jpg", base_name));
    save_jpeg(&full, &full_path)?;

    Ok((
        thumb_path.to_string_lossy().to_string(),
        full_path.to_string_lossy().to_string(),
    ))
}

fn save_jpeg(img: &DynamicImage, path: &Path) -> Result<(), String> {
    let file =
        fs::File::create(path).map_err(|e| format!("create file {:?}: {}", path, e))?;
    let mut writer = BufWriter::new(file);
    let rgb = img.to_rgb8();
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ColorType::Rgb8.into())
        .map_err(|e| format!("jpeg encode: {}", e))?;
    Ok(())
}

// ─────────────────────────────────────────
// 采集主流程（在后台线程中调用）
// ─────────────────────────────────────────

/// 单次采集尝试。返回 Some(VrSnapshot) 表示成功保存，None 表示跳过。
fn try_capture(inner: &mut VrInner, app_name: String, window_title: String) -> Option<VrSnapshot> {
    let now = now_secs();

    // ── 智能触发判断
    let title_changed =
        window_title != inner.last_window_title || app_name != inner.last_app_name;
    let elapsed = now - inner.last_capture_secs;

    let should_capture = if title_changed {
        elapsed > MIN_CAPTURE_SECS
    } else {
        elapsed > FORCED_CAPTURE_SECS
    };

    if !should_capture {
        return None;
    }

    // ── 截图
    let bytes = match capture_screen_bytes() {
        Ok(b) => b,
        Err(e) => {
            log::warn!("[VisualRecall] capture failed: {}", e);
            return None;
        }
    };

    // ── 内容哈希去重
    let hash = sampled_hash(&bytes);
    if inner.last_hash.as_deref() == Some(&hash) {
        // 内容相同，更新时间戳但不保存
        inner.last_capture_secs = now;
        inner.last_window_title = window_title;
        inner.last_app_name = app_name;
        return None;
    }

    // ── 解码图像
    let img = match image::load_from_memory_with_format(&bytes, ImageFormat::Png) {
        Ok(i) => i,
        Err(e) => {
            log::warn!("[VisualRecall] image decode failed: {}", e);
            return None;
        }
    };

    // ── 保存图片
    let shots_dir = screenshots_dir(&inner.data_path);
    let timestamp = now_ms();
    let (thumb_path, full_path) = match save_images(&img, &shots_dir, timestamp) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[VisualRecall] save images failed: {}", e);
            return None;
        }
    };

    // ── 写入 DB
    let row_id = db_insert(
        &inner.data_path,
        timestamp,
        &app_name,
        &window_title,
        &thumb_path,
        Some(&full_path),
        &hash,
    )?;

    // ── 更新状态
    inner.last_hash = Some(hash);
    inner.last_capture_secs = now;
    inner.last_window_title = window_title.clone();
    inner.last_app_name = app_name.clone();

    log::debug!("[VisualRecall] saved id={} app={}", row_id, app_name);
    Some(VrSnapshot {
        id: row_id,
        timestamp,
        app_name,
        window_title,
        thumb_path,
        full_path: Some(full_path),
    })
}

// ─────────────────────────────────────────
// 窗口检测（与 activity_tracker 相同方案）
// ─────────────────────────────────────────

fn get_active_window() -> Option<(String, String)> {
    let script = r#"tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    set windowTitle to ""
    try
        tell process frontApp
            if exists (1st window whose value of attribute "AXMain" is true) then
                set windowTitle to name of 1st window whose value of attribute "AXMain" is true
            else if exists (1st window) then
                set windowTitle to name of 1st window
            end if
        end tell
    end try
    return frontApp & "|||" & windowTitle
end tell"#;

    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    let result = String::from_utf8_lossy(&out.stdout);
    let result = result.trim();
    let mut parts = result.splitn(2, "|||");
    let app = parts.next()?.trim().to_string();
    let title = parts.next().unwrap_or("").trim().to_string();
    if app.is_empty() {
        return None;
    }
    Some((app, title))
}

// ─────────────────────────────────────────
// 后台轮询线程
// ─────────────────────────────────────────

fn start_polling(shared: SharedVrInner) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

        // 检查是否启用（持锁时间最短）
        let enabled = shared.lock().unwrap().config.enabled;
        if !enabled {
            continue;
        }

        // 获取窗口信息（AppleScript，在锁外执行）
        let window = match get_active_window() {
            Some(w) => w,
            None => continue,
        };

        // 执行采集
        let mut guard = shared.lock().unwrap();
        try_capture(&mut guard, window.0, window.1);
    });
}

// ─────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────

pub fn init(app: &AppHandle) -> VisualRecallState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("userData");

    fs::create_dir_all(&data_dir).ok();
    fs::create_dir_all(screenshots_dir(&data_dir)).ok();
    init_db(&data_dir);

    let inner = Arc::new(Mutex::new(VrInner {
        config: VrConfig::default(),
        last_hash: None,
        last_capture_secs: 0.0,
        last_window_title: String::new(),
        last_app_name: String::new(),
        data_path: data_dir,
    }));

    start_polling(Arc::clone(&inner));

    VisualRecallState(inner)
}

// ─────────────────────────────────────────
// Tauri Commands
// ─────────────────────────────────────────

#[tauri::command]
pub fn visual_recall_get_config(state: State<'_, VisualRecallState>) -> VrConfig {
    state.0.lock().unwrap().config.clone()
}

#[tauri::command]
pub fn visual_recall_set_enabled(enabled: bool, state: State<'_, VisualRecallState>) -> VrConfig {
    let mut inner = state.0.lock().unwrap();
    inner.config.enabled = enabled;
    inner.config.clone()
}

#[tauri::command]
pub fn visual_recall_update_config(
    interval_secs: Option<u64>,
    max_storage_mb: Option<u64>,
    state: State<'_, VisualRecallState>,
) -> VrConfig {
    let mut inner = state.0.lock().unwrap();
    if let Some(v) = interval_secs {
        inner.config.interval_secs = v;
    }
    if let Some(v) = max_storage_mb {
        inner.config.max_storage_mb = v;
    }
    inner.config.clone()
}

/// 按时间范围查询快照列表
#[tauri::command]
pub fn visual_recall_search_snapshots(
    start_time: i64,
    end_time: i64,
    limit: Option<i64>,
    state: State<'_, VisualRecallState>,
) -> VrSearchResult {
    let data_path = state.0.lock().unwrap().data_path.clone();
    let limit = limit.unwrap_or(50);
    let snapshots = db_query_by_time_range(&data_path, start_time, end_time, limit);
    let total = snapshots.len();
    VrSearchResult { snapshots, total }
}

/// 获取存储统计
#[tauri::command]
pub fn visual_recall_get_storage_stats(state: State<'_, VisualRecallState>) -> VrStorageStats {
    let data_path = state.0.lock().unwrap().data_path.clone();
    db_get_stats(&data_path)
}

/// 清理旧数据（删除 N 天前的截图文件和 DB 记录）
#[tauri::command]
pub fn visual_recall_cleanup(days_to_keep: i64, state: State<'_, VisualRecallState>) -> bool {
    let data_path = state.0.lock().unwrap().data_path.clone();
    let cutoff_ms = now_ms() - days_to_keep * 86400 * 1000;

    let conn = match Connection::open(db_path(&data_path)) {
        Ok(c) => c,
        Err(_) => return false,
    };

    // 获取要删除的文件路径
    let to_delete: Vec<(String, Option<String>)> = {
        let mut stmt = match conn.prepare(
            "SELECT thumb_path, full_path FROM screen_snapshots WHERE timestamp < ?1",
        ) {
            Ok(s) => s,
            Err(_) => return false,
        };
        stmt.query_map(params![cutoff_ms], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    };

    // 删除文件
    for (thumb, full) in &to_delete {
        let _ = fs::remove_file(thumb);
        if let Some(f) = full {
            let _ = fs::remove_file(f);
        }
    }

    // 删除 DB 记录
    conn.execute(
        "DELETE FROM screen_snapshots WHERE timestamp < ?1",
        params![cutoff_ms],
    )
    .is_ok()
}

/// 读取截图文件并返回 base64 data URL（JPEG）
#[tauri::command]
pub fn visual_recall_get_image_data(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}
