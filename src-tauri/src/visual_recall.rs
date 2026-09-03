// visual_recall.rs — 视觉回溯模块
//
// 借鉴 screenpipe 的核心架构与技术方案：
// 1. 原生跨平台内存截图：采用 xcap 原生截屏，直接在内存中生成 DynamicImage，零临时文件、无外部子进程开销。
// 2. 多显示器与全屏窗口动态适配：根据当前前台应用窗口的物理坐标，精确定位并捕获该窗口所在的显示器。
// 3. 自身窗口过滤（借鉴 screenpipe SKIP_APPS）：跳过 EVA 自身界面的重复截图。
// 4. 屏幕录制权限预检：调用 macOS CoreGraphics API 检查与申请屏幕录制授权。
// 5. 帧差分双层去重（借鉴 screenpipe-screen/frame_comparison）：
//    - 1/4 降采样 + 灰度快速颜色 Hash：相同直接跳过（< 1ms）
//    - 灰度直方图（Luma Histogram）比对差分分值：微小抖动/时钟跳动（< 1.5%）不重复存盘
// 6. 配置持久化：启用状态与参数持久化存储在 SQLite 中，重启 EVA 后自愈保持录制

use image::{codecs::jpeg::JpegEncoder, DynamicImage, GenericImageView};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

// ─────────────────────────────────────────
// macOS CoreGraphics 权限系统 API
// ─────────────────────────────────────────

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

// ─────────────────────────────────────────
// 常量定义
// ─────────────────────────────────────────

const THUMB_WIDTH: u32 = 480;
const FULL_WIDTH: u32 = 1920;
const JPEG_QUALITY: u8 = 82;
const POLL_INTERVAL_MS: u64 = 4_000; // 每4秒检测一次
const MIN_CAPTURE_SECS: f64 = 4.0;   // 最小采样间隔
const FORCED_CAPTURE_SECS: f64 = 45.0; // 兜底强制采样间隔（秒）
const HISTOGRAM_DIFF_THRESHOLD: f64 = 0.015; // 灰度直方图差异阈值 1.5%

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
    pub thumb_path: String,
    pub full_path: Option<String>,
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

#[derive(Debug, Clone)]
struct ActiveWindowInfo {
    app_name: String,
    window_title: String,
    center_x: i32,
    center_y: i32,
}

// ─────────────────────────────────────────
// 帧差分比较器（Screenpipe FrameComparer 精炼版）
// ─────────────────────────────────────────

struct FrameComparer {
    previous_hash: Option<u64>,
    previous_histogram: Option<[f64; 256]>,
}

impl FrameComparer {
    fn new() -> Self {
        Self {
            previous_hash: None,
            previous_histogram: None,
        }
    }

    /// 将图像缩小并转为灰度，同时计算快速颜色哈希与亮度直方图
    fn process_thumbnail(img: &DynamicImage) -> (u64, [f64; 256]) {
        let (orig_w, orig_h) = img.dimensions();
        let target_w = (orig_w / 4).clamp(160, 480);
        let target_h = ((orig_h as u64 * target_w as u64) / orig_w.max(1) as u64).max(1) as u32;

        let mut hasher = DefaultHasher::new();
        let mut hist = [0u64; 256];
        let mut total_pixels = 0u64;

        for y in 0..target_h {
            let src_y = ((y as u64 * orig_h as u64) / target_h as u64) as u32;
            for x in 0..target_w {
                let src_x = ((x as u64 * orig_w as u64) / target_w as u64) as u32;
                let p = img.get_pixel(src_x, src_y);
                p.0.hash(&mut hasher);
                let luma = (p.0[0] as u32 * 299 + p.0[1] as u32 * 587 + p.0[2] as u32 * 114) / 1000;
                let bin = (luma as usize).min(255);
                hist[bin] += 1;
                total_pixels += 1;
            }
        }

        let mut norm_hist = [0.0f64; 256];
        if total_pixels > 0 {
            let total_f = total_pixels as f64;
            for i in 0..256 {
                norm_hist[i] = hist[i] as f64 / total_f;
            }
        }

        (hasher.finish(), norm_hist)
    }

    /// 返回差异分值 0.0 (完全相同) ~ 1.0 (完全不同)
    fn compare_and_update(&mut self, img: &DynamicImage) -> f64 {
        let (curr_hash, curr_hist) = Self::process_thumbnail(img);

        // 1. Hash 早退（完全静止画面）
        if let Some(prev_hash) = self.previous_hash {
            if prev_hash == curr_hash {
                return 0.0;
            }
        }

        // 2. 灰度直方图比对
        let diff = if let Some(ref prev_hist) = self.previous_histogram {
            let mut l1_diff = 0.0f64;
            for i in 0..256 {
                l1_diff += (prev_hist[i] - curr_hist[i]).abs();
            }
            (l1_diff / 2.0).clamp(0.0, 1.0)
        } else {
            1.0
        };

        // 更新状态
        self.previous_hash = Some(curr_hash);
        self.previous_histogram = Some(curr_hist);

        diff
    }
}

// ─────────────────────────────────────────
// 共享状态
// ─────────────────────────────────────────

struct VrInner {
    config: VrConfig,
    comparer: FrameComparer,
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

pub fn db_path(data_path: &Path) -> PathBuf {
    data_path.join("visual_recall.db")
}

fn screenshots_dir(data_path: &Path) -> PathBuf {
    data_path.join("screenshots")
}

fn secs_to_date_dir(secs: i64) -> String {
    let days = (secs / 86400) + 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}/{:02}/{:02}", y, m, d)
}

// ─────────────────────────────────────────
// 数据库操作与配置持久化
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

    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS screen_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   INTEGER NOT NULL,
            app_name    TEXT,
            window_title TEXT,
            thumb_path  TEXT,
            full_path   TEXT,
            content_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vr_time ON screen_snapshots(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_vr_app ON screen_snapshots(app_name);

        CREATE TABLE IF NOT EXISTS vr_settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL
        );",
    );
}

fn db_load_config(data_path: &Path) -> VrConfig {
    let default_config = VrConfig::default();
    let conn = match Connection::open(db_path(data_path)) {
        Ok(c) => c,
        Err(_) => return default_config,
    };

    let mut config = default_config;
    if let Ok(enabled_str) = conn.query_row(
        "SELECT value FROM vr_settings WHERE key = 'enabled'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        config.enabled = enabled_str == "true" || enabled_str == "1";
    }

    if let Ok(interval_str) = conn.query_row(
        "SELECT value FROM vr_settings WHERE key = 'interval_secs'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        if let Ok(val) = interval_str.parse::<u64>() {
            config.interval_secs = val;
        }
    }

    if let Ok(storage_str) = conn.query_row(
        "SELECT value FROM vr_settings WHERE key = 'max_storage_mb'",
        [],
        |r| r.get::<_, String>(0),
    ) {
        if let Ok(val) = storage_str.parse::<u64>() {
            config.max_storage_mb = val;
        }
    }

    config
}

fn db_save_config(data_path: &Path, config: &VrConfig) {
    let conn = match Connection::open(db_path(data_path)) {
        Ok(c) => c,
        Err(_) => return,
    };

    let _ = conn.execute(
        "INSERT INTO vr_settings (key, value) VALUES ('enabled', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        params![if config.enabled { "true" } else { "false" }],
    );
    let _ = conn.execute(
        "INSERT INTO vr_settings (key, value) VALUES ('interval_secs', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        params![config.interval_secs.to_string()],
    );
    let _ = conn.execute(
        "INSERT INTO vr_settings (key, value) VALUES ('max_storage_mb', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        params![config.max_storage_mb.to_string()],
    );
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

pub fn db_query_by_time_range(
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
        .query_row("SELECT MIN(timestamp) FROM screen_snapshots", [], |r| r.get(0))
        .ok()
        .flatten();
    let newest_ts: Option<i64> = conn
        .query_row("SELECT MAX(timestamp) FROM screen_snapshots", [], |r| r.get(0))
        .ok()
        .flatten();

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
// 原生多屏幕捕获（xcap 零文件开销 + 多屏自适应）
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

/// 根据目标点坐标 (center_x, center_y) 捕获对应显示器图像，纯内存操作
fn capture_screen_image_at(center_x: i32, center_y: i32) -> Result<DynamicImage, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("list monitors failed: {}", e))?;
    if monitors.is_empty() {
        return Err("No monitor found".to_string());
    }

    // 寻找包含前台窗口中心点的显示器
    let target_monitor = monitors.iter().find(|m| {
        let mx = m.x().unwrap_or(0);
        let my = m.y().unwrap_or(0);
        let mw = m.width().unwrap_or(0) as i32;
        let mh = m.height().unwrap_or(0) as i32;
        center_x >= mx && center_x < mx + mw && center_y >= my && center_y < my + mh
    });

    // 没命中则回退到主显示器或第一个显示器
    let monitor = target_monitor.unwrap_or_else(|| {
        monitors
            .iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .unwrap_or(&monitors[0])
    });

    let rgba_image = monitor
        .capture_image()
        .map_err(|e| format!("capture image failed: {}", e))?;

    Ok(DynamicImage::ImageRgba8(rgba_image))
}

/// 保存 JPEG（缩略图 + 原图）到本地目录
fn save_images(
    img: &DynamicImage,
    screenshots_base: &Path,
    timestamp: i64,
) -> Result<(String, String), String> {
    let date_dir = secs_to_date_dir(timestamp / 1000);
    let target_dir = screenshots_base.join(&date_dir);
    fs::create_dir_all(&target_dir).map_err(|e| format!("mkdir failed: {}", e))?;

    let base_name = format!("snapshot_{}", timestamp);

    // ── 缩略图 (480px)
    let thumb = img.thumbnail(THUMB_WIDTH, THUMB_WIDTH * 100);
    let thumb_path = target_dir.join(format!("{}_thumb.jpg", base_name));
    save_jpeg(&thumb, &thumb_path)?;

    // ── 原图（最大宽度 1920px）
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
    let file = fs::File::create(path).map_err(|e| format!("create file {:?}: {}", path, e))?;
    let mut writer = BufWriter::new(file);
    let rgb = img.to_rgb8();
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, JPEG_QUALITY);
    encoder
        .encode(rgb.as_raw(), rgb.width(), rgb.height(), image::ColorType::Rgb8.into())
        .map_err(|e| format!("jpeg encode: {}", e))?;
    Ok(())
}

// ─────────────────────────────────────────
// 采集流程与帧对比门控
// ─────────────────────────────────────────

fn try_capture(inner: &mut VrInner, win: ActiveWindowInfo) -> Option<VrSnapshot> {
    let now = now_secs();

    // 排除 EVA 自身窗口，避免自拍套娃
    let app_lower = win.app_name.to_lowercase();
    if app_lower == "eva" || app_lower == "eva-lib" || app_lower == "eva - 时间小票" {
        return None;
    }

    let title_changed =
        win.window_title != inner.last_window_title || win.app_name != inner.last_app_name;
    let elapsed = now - inner.last_capture_secs;

    let should_capture = if title_changed {
        elapsed > MIN_CAPTURE_SECS
    } else {
        elapsed > FORCED_CAPTURE_SECS
    };

    if !should_capture {
        return None;
    }

    // 1. 原生内存截图（多屏自适应）
    let img = match capture_screen_image_at(win.center_x, win.center_y) {
        Ok(i) => i,
        Err(e) => {
            log::warn!("[VisualRecall] capture screen failed: {}", e);
            return None;
        }
    };

    // 2. 双层差分比较（Screenpipe 机制）
    let diff = inner.comparer.compare_and_update(&img);

    // 如果应用/标题没变，且画面差异度低于 1.5%，跳过存盘
    if !title_changed && diff < HISTOGRAM_DIFF_THRESHOLD {
        return None;
    }

    // 3. 编码保存 JPEG 图片
    let shots_dir = screenshots_dir(&inner.data_path);
    let timestamp = now_ms();
    let (thumb_path, full_path) = match save_images(&img, &shots_dir, timestamp) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[VisualRecall] save images failed: {}", e);
            return None;
        }
    };

    let hash_str = format!("diff_{:.4}_{}", diff, timestamp);

    // 4. 写入 SQLite
    let row_id = db_insert(
        &inner.data_path,
        timestamp,
        &win.app_name,
        &win.window_title,
        &thumb_path,
        Some(&full_path),
        &hash_str,
    )?;

    // 5. 更新状态
    inner.last_capture_secs = now;
    inner.last_window_title = win.window_title.clone();
    inner.last_app_name = win.app_name.clone();

    log::debug!(
        "[VisualRecall] saved snapshot id={} app={} diff={:.4}",
        row_id,
        win.app_name,
        diff
    );

    Some(VrSnapshot {
        id: row_id,
        timestamp,
        app_name: win.app_name,
        window_title: win.window_title,
        thumb_path,
        full_path: Some(full_path),
    })
}

// ─────────────────────────────────────────
// 前台窗口与坐标检测
// ─────────────────────────────────────────

fn get_active_window() -> Option<ActiveWindowInfo> {
    let script = r#"
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set winTitle to ""
        set winX to 0
        set winY to 0
        set winW to 0
        set winH to 0
        try
            if exists (1st window of frontApp whose value of attribute "AXMain" is true) then
                set w to (1st window of frontApp whose value of attribute "AXMain" is true)
                set winTitle to name of w
                set p to position of w
                set s to size of w
                set winX to item 1 of p
                set winY to item 2 of p
                set winW to item 1 of s
                set winH to item 2 of s
            else if exists (1st window of frontApp) then
                set w to 1st window of frontApp
                set winTitle to name of w
                set p to position of w
                set s to size of w
                set winX to item 1 of p
                set winY to item 2 of p
                set winW to item 1 of s
                set winH to item 2 of s
            end if
        end try
        return appName & "|||" & winTitle & "|||" & winX & "," & winY & "," & winW & "," & winH
    end tell
    "#;

    let out = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    let res = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let parts: Vec<&str> = res.split("|||").collect();
    if parts.len() < 3 {
        return None;
    }

    let mut app_name = parts[0].trim().to_string();
    let window_title = parts[1].trim().to_string();

    // 针对 Electron 应用名称规范
    if app_name.to_lowercase() == "electron" {
        if let Some(front_asn) = Command::new("lsappinfo").arg("front").output().ok() {
            let asn = String::from_utf8_lossy(&front_asn.stdout).trim().to_string();
            if let Some(info_out) = Command::new("lsappinfo")
                .args(["info", "-only", "bundlepath", &asn])
                .output()
                .ok()
            {
                let info = String::from_utf8_lossy(&info_out.stdout);
                for line in info.lines() {
                    if let Some(path) = line.strip_prefix("\"LSBundlePath\"=") {
                        let clean_path = path.trim_matches('"');
                        if let Some(name) = extract_vr_project_name(clean_path) {
                            app_name = name;
                            break;
                        }
                    }
                }
            }
        }
    }

    let rect_parts: Vec<i32> = parts[2]
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let (cx, cy) = if rect_parts.len() == 4 {
        let (x, y, w, h) = (rect_parts[0], rect_parts[1], rect_parts[2], rect_parts[3]);
        (x + w / 2, y + h / 2)
    } else {
        (0, 0)
    };

    if app_name.is_empty() {
        return None;
    }

    Some(ActiveWindowInfo {
        app_name,
        window_title,
        center_x: cx,
        center_y: cy,
    })
}

fn extract_vr_project_name(bundle_path: &str) -> Option<String> {
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

// ─────────────────────────────────────────
// 后台轮询线程
// ─────────────────────────────────────────

fn start_polling(shared: SharedVrInner) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));

        let enabled = {
            if let Ok(guard) = shared.lock() {
                guard.config.enabled
            } else {
                false
            }
        };

        if !enabled {
            continue;
        }

        let window = match get_active_window() {
            Some(w) => w,
            None => continue,
        };

        if let Ok(mut guard) = shared.lock() {
            try_capture(&mut guard, window);
        }
    });
}

// ─────────────────────────────────────────
// 初始化模块
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

    // 从数据库持久化中加载配置
    let persisted_config = db_load_config(&data_dir);

    let inner = Arc::new(Mutex::new(VrInner {
        config: persisted_config,
        comparer: FrameComparer::new(),
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

/// 检查系统屏幕录制权限
#[tauri::command]
pub fn visual_recall_check_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        CGPreflightScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// 请求屏幕录制权限
#[tauri::command]
pub fn visual_recall_request_permission() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        CGRequestScreenCaptureAccess()
    }
    #[cfg(not(target_os = "macos"))]
    true
}

#[tauri::command]
pub fn visual_recall_get_config(state: State<'_, VisualRecallState>) -> VrConfig {
    state.0.lock().unwrap().config.clone()
}

#[tauri::command]
pub fn visual_recall_set_enabled(enabled: bool, state: State<'_, VisualRecallState>) -> VrConfig {
    let mut inner = state.0.lock().unwrap();
    inner.config.enabled = enabled;
    db_save_config(&inner.data_path, &inner.config);
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
    db_save_config(&inner.data_path, &inner.config);
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
    let limit = limit.unwrap_or(100);
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

    for (thumb, full) in &to_delete {
        let _ = fs::remove_file(thumb);
        if let Some(f) = full {
            let _ = fs::remove_file(f);
        }
    }

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
