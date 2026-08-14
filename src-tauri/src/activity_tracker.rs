// Activity Tracker — Rust re-implementation of super-dashboard/activityTracker.ts
// Polls every 10s via AppleScript + ioreg idle detection. Pure SQLite, no AI engine.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

// ──────────────────────────────────────────────────
// Types (camelCase for frontend, snake_case in DB)
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLog {
    pub id: String,
    pub app_name: String,
    pub window_title: String,
    pub start_time: i64,
    pub end_time: i64,
    pub duration: i64,
    pub category: Option<String>,
    pub project_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub classified: bool,
    pub remark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStat {
    pub app_name: String,
    pub total_duration: i64,
    pub percentage: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryStat {
    pub category: String,
    pub total_duration: i64,
    pub percentage: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStat {
    pub project_name: String,
    pub total_duration: i64,
    pub percentage: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub content: String,
    pub model: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapDataPoint {
    pub date: String,
    pub total: i64,
    pub hue: String,
    pub score: f64,
}

// ──────────────────────────────────────────────────
// Shared state
// ──────────────────────────────────────────────────

struct CurrentActivity {
    app_name: String,
    window_title: String,
    project_name: Option<String>,
    start_time: i64,
}

pub struct ActivityState {
    db_path: String,
    current: Option<CurrentActivity>,
    was_idle: bool,
    is_suspended: bool,
    last_sample_ts: i64,   // wall-clock ms of last successful sample (suspend detection)
    last_stats_update: i64,
}

impl ActivityState {
    fn conn(&self) -> Option<Connection> {
        Connection::open(&self.db_path).ok()
    }
}

pub type SharedActivityState = Arc<Mutex<ActivityState>>;

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn date_range(date_str: &str) -> (i64, i64) {
    // Parse YYYY-MM-DD → local midnight timestamps
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        let now = now_ms();
        let start = now - (now % (86400 * 1000));
        return (start, start + 86400 * 1000);
    }
    let y: i32 = parts[0].parse().unwrap_or(2024);
    let m: u32 = parts[1].parse::<u32>().unwrap_or(1) - 1; // 0-indexed for calculation
    let d: u32 = parts[2].parse().unwrap_or(1);

    // Use chrono-like calculation without the dep: days since epoch
    let days = days_since_epoch(y, m + 1, d);
    let utc_midnight_ms = days as i64 * 86400 * 1000;

    // Adjust for local timezone offset
    let local_offset_ms = local_utc_offset_ms();
    let local_midnight_ms = utc_midnight_ms - local_offset_ms;
    (local_midnight_ms, local_midnight_ms + 86400 * 1000)
}

fn days_since_epoch(y: i32, m: u32, d: u32) -> i64 {
    // Rata Die algorithm → days since 1970-01-01
    let m = m as i64;
    let d = d as i64;
    let y = y as i64;
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn local_utc_offset_ms() -> i64 {
    // Get local UTC offset in ms by comparing local time to UTC
    let output = std::process::Command::new("date")
        .arg("+%z")
        .output()
        .ok();
    if let Some(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        let s = s.trim();
        // format: +HHMM or -HHMM
        if s.len() >= 5 {
            let sign: i64 = if s.starts_with('-') { -1 } else { 1 };
            let digits = &s[1..];
            let hours: i64 = digits[..2].parse().unwrap_or(0);
            let mins: i64 = digits[2..4].parse().unwrap_or(0);
            return sign * (hours * 3600 + mins * 60) * 1000;
        }
    }
    0
}

// ──────────────────────────────────────────────────
// Static classification rules
// ──────────────────────────────────────────────────

fn static_category(app: &str) -> Option<&'static str> {
    let rules: &[(&str, &str)] = &[
        ("Code", "development"),
        ("Visual Studio Code", "development"),
        ("VS Code", "development"),
        ("Antigravity", "development"),
        ("IntelliJ IDEA", "development"),
        ("WebStorm", "development"),
        ("PyCharm", "development"),
        ("Xcode", "development"),
        ("Warp", "development"),
        ("Cursor", "development"),
        ("Sublime Text", "development"),
        ("sublime_text", "development"),
        ("Trae", "development"),
        ("Navicat", "development"),
        ("Terminal", "development"),
        ("Postman", "development"),
        ("iTerm2", "operations"),
        ("iTerm", "operations"),
        ("Google Chrome", "browsing"),
        ("Safari", "browsing"),
        ("Firefox", "browsing"),
        ("Microsoft Edge", "browsing"),
        ("Arc", "browsing"),
        ("Brave", "browsing"),
        ("Slack", "communication"),
        ("Discord", "communication"),
        ("WeChat", "communication"),
        ("DingTalk", "communication"),
        ("Lark", "communication"),
        ("Feishu", "communication"),
        ("Telegram", "communication"),
        ("Mail", "communication"),
        ("Microsoft Outlook", "communication"),
        ("Notion", "writing"),
        ("Obsidian", "writing"),
        ("obsidian", "writing"),
        ("Microsoft Word", "writing"),
        ("Word", "writing"),
        ("Notes", "writing"),
        ("Bear", "writing"),
        ("Typora", "writing"),
        ("WorkBuddy", "productivity"),
        ("EVA", "productivity"),
        ("小暖", "productivity"),
        ("暖窗", "productivity"),
        ("智谱AI", "productivity"),
        ("ChatGPT", "productivity"),
        ("Claude", "productivity"),
        ("Microsoft Excel", "productivity"),
        ("Microsoft PowerPoint", "productivity"),
        ("Figma", "design"),
        ("Sketch", "design"),
        ("Adobe Photoshop", "design"),
        ("Canva", "design"),
        ("ExcalidrawZ", "design"),
        ("Spotify", "entertainment"),
        ("Music", "entertainment"),
        ("QuickTime Player", "entertainment"),
        ("IINA", "entertainment"),
        ("VLC", "entertainment"),
        ("Finder", "system"),
        ("System Settings", "system"),
        ("System Preferences", "system"),
    ];

    // Exact match first
    for (key, cat) in rules {
        if *key == app {
            return Some(cat);
        }
    }
    // Case-insensitive match
    let lower_app = app.to_lowercase();
    for (key, cat) in rules {
        if key.to_lowercase() == lower_app {
            return Some(cat);
        }
    }
    // Contains match
    for (key, cat) in rules {
        if lower_app.contains(&key.to_lowercase()) {
            return Some(cat);
        }
    }
    None
}

fn classify_app(app: &str) -> &'static str {
    if app == "Distracted" {
        return "distracted";
    }
    if app == "Rest" {
        return "rest";
    }
    if app == "System" {
        return "system";
    }
    if app.to_lowercase().contains("obsidian") {
        return "writing";
    }
    static_category(app).unwrap_or("other")
}

// ──────────────────────────────────────────────────
// Intelligent App Identity Resolution
// ──────────────────────────────────────────────────

fn resolve_app_identity(
    p_name: &str,
    d_name: &str,
    b_id: &str,
    title: &str,
) -> (String, Option<String>) {
    let p_name = p_name.trim();
    let d_name = d_name.trim();
    let b_id = b_id.trim();
    let title = title.trim();

    let is_generic = |name: &str| -> bool {
        let lower = name.to_lowercase();
        lower.is_empty()
            || lower == "missing value"
            || lower == "electron"
            || lower == "electron helper"
            || lower == "node"
            || lower == "java"
            || lower == "python"
            || lower == "python3"
            || lower == "osascript"
            || lower == "unknown"
    };

    // 1. If displayed name is valid and specific, use it
    let mut resolved_app = if !is_generic(d_name) {
        d_name.to_string()
    } else if !is_generic(p_name) {
        p_name.to_string()
    } else {
        String::new()
    };

    let mut project_name: Option<String> = None;

    // 2. Resolve from Bundle Identifier if still generic/empty
    if resolved_app.is_empty() && !is_generic(b_id) {
        let lower_bid = b_id.to_lowercase();
        if lower_bid.contains("antigravity") {
            resolved_app = "Antigravity".to_string();
        } else if lower_bid.contains("workbuddy") {
            resolved_app = "WorkBuddy".to_string();
        } else if lower_bid.contains("vscode") {
            resolved_app = "Visual Studio Code".to_string();
        } else if lower_bid.contains("cursor") {
            resolved_app = "Cursor".to_string();
        } else if lower_bid.contains("obsidian") {
            resolved_app = "Obsidian".to_string();
        } else if lower_bid.contains("notion") {
            resolved_app = "Notion".to_string();
        } else if lower_bid.contains("slack") {
            resolved_app = "Slack".to_string();
        } else if lower_bid.contains("wechat") {
            resolved_app = "WeChat".to_string();
        } else if lower_bid.contains("eva") {
            resolved_app = "EVA".to_string();
        } else if let Some(last) = b_id.split('.').last() {
            if !last.is_empty() && !is_generic(last) {
                resolved_app = last.to_string();
            }
        }
    }

    // 3. Inspect Window Title for code editor workspaces & specific apps
    if !title.is_empty() {
        let parts: Vec<&str> = if title.contains(" — ") {
            title.split(" — ").collect()
        } else if title.contains(" - ") {
            title.split(" - ").collect()
        } else {
            vec![]
        };

        if !parts.is_empty() {
            let left = parts[0].trim();
            let right = parts[parts.len() - 1].trim();

            let raw_proj = left.replace("(Workspace)", "").trim().to_string();
            if !raw_proj.is_empty() && raw_proj != "Untitled" {
                project_name = Some(raw_proj.clone());
            }

            if resolved_app.is_empty() || resolved_app == "Electron" {
                let is_code_file = parts.iter().any(|p| {
                    p.contains('.') && (
                        p.ends_with(".ts") || p.ends_with(".tsx") || p.ends_with(".js") ||
                        p.ends_with(".rs") || p.ends_with(".py") || p.ends_with(".go") ||
                        p.ends_with(".java") || p.ends_with(".md") || p.ends_with(".json") ||
                        p.ends_with(".yaml") || p.ends_with(".yml") || p.ends_with(".html") ||
                        p.ends_with(".css") || p.ends_with(".vue") || p.ends_with(".sh") ||
                        p.ends_with(".cpp") || p.ends_with(".c") || p.ends_with(".h") ||
                        p.ends_with(".png") || p.ends_with(".jpg") || p.ends_with(".txt")
                    ) || p.contains("(Working Tree)")
                });

                if is_code_file || left.contains("(Workspace)") {
                    resolved_app = "Antigravity".to_string();
                } else if !right.is_empty() && (right == "Google Chrome" || right == "Arc" || right == "Safari" || right == "Slack" || right == "Notion") {
                    resolved_app = right.to_string();
                }
            }
        }

        if resolved_app.is_empty() || resolved_app == "Electron" {
            if title.contains("WorkBuddy") {
                resolved_app = "WorkBuddy".to_string();
            } else if title.contains("小暖") {
                resolved_app = "小暖".to_string();
            } else if title.contains("暖窗") {
                resolved_app = "暖窗".to_string();
            } else if title.contains("智谱AI") {
                resolved_app = "智谱AI".to_string();
            } else if title.contains("EVA") || title.contains("eva") {
                resolved_app = "EVA".to_string();
            } else if title.contains("MiniMax") {
                resolved_app = "MiniMax".to_string();
            } else if title.contains("ChatGPT") {
                resolved_app = "ChatGPT".to_string();
            } else if title.contains("Claude") {
                resolved_app = "Claude".to_string();
            } else if title.chars().count() <= 30 && !title.contains('/') && !title.contains('\\') {
                resolved_app = title.to_string();
            }
        }
    }

    if resolved_app.is_empty() {
        resolved_app = if !p_name.is_empty() { p_name.to_string() } else { "Unknown".to_string() };
    }

    (resolved_app, project_name)
}

// ──────────────────────────────────────────────────
// AppleScript window detection
// ──────────────────────────────────────────────────

pub fn get_active_window() -> Option<(String, String, Option<String>)> {
    // 方案：lsappinfo（直接查询 WindowServer）获取前台应用的精确身份（按 ASN 独立标识，
    // 即使多个进程共享 com.github.Electron bundle ID 也不会混淆），
    // 再用精确 PID 通过 System Events 获取窗口标题。
    let front_asn = std::process::Command::new("lsappinfo")
        .arg("front")
        .output()
        .ok()?;
    let asn = String::from_utf8_lossy(&front_asn.stdout).trim().to_string();
    if asn.is_empty() {
        return None;
    }

    // 获取 display name, pid, bundle id, bundle path
    let info_out = std::process::Command::new("lsappinfo")
        .args(["info", "-only", "name", "-only", "pid", "-only", "bundleid", "-only", "bundlepath", &asn])
        .output()
        .ok()?;
    let info = String::from_utf8_lossy(&info_out.stdout);

    let mut display_name = String::new();
    let mut pid_str = String::new();
    let mut bundle_id = String::new();
    let mut bundle_path = String::new();

    for line in info.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("\"LSDisplayName\"=") {
            display_name = val.trim_matches('"').to_string();
        } else if let Some(val) = line.strip_prefix("\"pid\"=") {
            pid_str = val.to_string();
        } else if let Some(val) = line.strip_prefix("\"CFBundleIdentifier\"=") {
            bundle_id = val.trim_matches('"').to_string();
        } else if let Some(val) = line.strip_prefix("\"LSBundlePath\"=") {
            bundle_path = val.trim_matches('"').to_string();
        }
    }

    let pid: u32 = pid_str.parse().ok()?;

    // 对于通用 Electron 进程（com.github.Electron），从 bundle path 推断实际应用名。
    // 例如 /Users/.../workspace/personal/HomeCore/node_modules/.../Electron.app → "HomeCore"
    // 例如 /Users/.../workspace/wiwj/Ada/node_modules/.../Electron.app → "Ada"
    let effective_name = if bundle_id == "com.github.Electron" && !bundle_path.is_empty() {
        extract_project_name_from_path(&bundle_path).unwrap_or_else(|| display_name.clone())
    } else {
        display_name.clone()
    };

    // 用精确 PID 获取窗口标题
    let title_script = format!(
        r#"tell application "System Events"
    set p to first application process whose unix id is {}
    set windowTitle to ""
    try
        if exists (1st window of p whose value of attribute "AXMain" is true) then
            set windowTitle to name of 1st window of p whose value of attribute "AXMain" is true
        else if exists (1st window of p) then
            set windowTitle to name of 1st window of p
        end if
    end try
    return windowTitle
end tell"#,
        pid
    );

    let title_out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&title_script)
        .output()
        .ok();
    let title = title_out
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    if effective_name.is_empty() && title.is_empty() {
        return None;
    }

    log::info!(
        "[ActivityTracker] lsappinfo: name={:?} bid={:?} bpath={:?} eff={:?} pid={} title={:?}",
        display_name, bundle_id, bundle_path, effective_name, pid, title
    );

    let (app, project) = resolve_app_identity(&effective_name, &effective_name, &bundle_id, &title);

    log::info!("[ActivityTracker] resolved: app={:?} project={:?}", app, project);

    if app.is_empty() {
        return None;
    }

    Some((app, title, project))
}

/// 从 Electron 开发应用的 bundle path 中提取项目名。
/// 例如 "/Users/x/workspace/personal/HomeCore/node_modules/.../Electron.app" → "HomeCore"
/// 例如 "/Applications/WorkBuddy.app" → "WorkBuddy"
fn extract_project_name_from_path(bundle_path: &str) -> Option<String> {
    // 如果是 /Applications/xxx.app，取 xxx
    if bundle_path.starts_with("/Applications/") {
        let app_name = bundle_path
            .strip_prefix("/Applications/")?
            .strip_suffix(".app")
            .or_else(|| bundle_path.strip_prefix("/Applications/"))?;
        return Some(app_name.to_string());
    }

    // 如果路径含 node_modules，取 node_modules 之前的最后一段作为项目名
    if let Some(idx) = bundle_path.find("/node_modules/") {
        let prefix = &bundle_path[..idx];
        let project = prefix.rsplit('/').next()?;
        if !project.is_empty() {
            return Some(project.to_string());
        }
    }

    // 兜底：取路径中 .app 之前的目录名
    if let Some(idx) = bundle_path.rfind(".app") {
        let before_app = &bundle_path[..idx];
        let name = before_app.rsplit('/').next()?;
        if !name.is_empty() && name != "Electron" {
            return Some(name.to_string());
        }
    }

    None
}

// ──────────────────────────────────────────────────
// System idle detection (macOS ioreg)
// ──────────────────────────────────────────────────

const IDLE_TIMEOUT_SECS: u64 = 60;

fn system_idle_secs() -> u64 {
    let out = std::process::Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
        .ok();
    if let Some(o) = out {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            if line.contains("HIDIdleTime") {
                // format: "HIDIdleTime" = 12345678901 (nanoseconds)
                if let Some(eq) = line.rfind('=') {
                    let val_str = line[eq + 1..].trim();
                    if let Ok(ns) = val_str.parse::<u64>() {
                        return ns / 1_000_000_000;
                    }
                }
            }
        }
    }
    0
}

fn is_screen_locked() -> bool {
    let out = std::process::Command::new("ioreg")
        .args(["-n", "Root", "-d1"])
        .output()
        .ok();

    if let Some(o) = out {
        let s = String::from_utf8_lossy(&o.stdout);
        for line in s.lines() {
            if line.contains("CGSSessionScreenIsLocked") {
                return line.contains("Yes") || line.contains("1");
            }
        }
    }
    false
}

// ──────────────────────────────────────────────────
// DB setup
// ──────────────────────────────────────────────────

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_logs (
            id TEXT PRIMARY KEY,
            app_name TEXT NOT NULL,
            window_title TEXT NOT NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL,
            duration INTEGER NOT NULL,
            category TEXT,
            project_name TEXT,
            tags TEXT,
            classified INTEGER DEFAULT 0,
            remark TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_act_start ON activity_logs(start_time DESC);
        CREATE INDEX IF NOT EXISTS idx_act_app ON activity_logs(app_name);
        CREATE INDEX IF NOT EXISTS idx_act_cat ON activity_logs(category);

        CREATE TABLE IF NOT EXISTS daily_summaries (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            content TEXT NOT NULL,
            model TEXT,
            created_at INTEGER NOT NULL,
            is_active INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_sum_date ON daily_summaries(date);

        CREATE TABLE IF NOT EXISTS daily_stats (
            date TEXT PRIMARY KEY,
            total_duration INTEGER,
            active_count INTEGER,
            app_count INTEGER,
            primary_category TEXT,
            category_distribution TEXT,
            top_app TEXT,
            productivity_score REAL,
            last_updated INTEGER
        );",
    )?;
    Ok(())
}

fn db_save_activity(conn: &Connection, app: &str, title: &str, project_name: Option<&str>, start: i64, end: i64) {
    let duration = (end - start) / 1000;
    if duration < 5 {
        return;
    }
    let category = classify_app(app);
    let classified = if category != "other" { 1 } else { 0 };
    let _ = conn.execute(
        "INSERT INTO activity_logs (id, app_name, window_title, start_time, end_time, duration, category, project_name, classified)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            Uuid::new_v4().to_string(),
            app,
            title,
            start,
            end,
            duration,
            category,
            project_name,
            classified
        ],
    );
}

// ──────────────────────────────────────────────────
// Background polling
// ──────────────────────────────────────────────────

const SAMPLE_INTERVAL_MS: u64 = 10_000;
const SUSPEND_GAP_SECS: i64 = 30; // gap > 30s means system was suspended

pub fn start_polling(state: SharedActivityState) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(SAMPLE_INTERVAL_MS));

        let now = now_ms();
        let idle_secs = system_idle_secs();
        let is_idle = idle_secs >= IDLE_TIMEOUT_SECS;
        let screen_locked = is_screen_locked();

        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(_) => continue,
        };

        // Detect suspend: big gap between samples
        let gap_secs = (now - guard.last_sample_ts) / 1000;
        if guard.last_sample_ts > 0 && gap_secs > SUSPEND_GAP_SECS {
            // Save current activity, discard gap
            if let Some(ref cur) = guard.current.take() {
                if let Some(conn) = guard.conn() {
                    db_save_activity(&conn, &cur.app_name, &cur.window_title, cur.project_name.as_deref(), cur.start_time, guard.last_sample_ts);
                }
            }
            guard.was_idle = false;
        }

        // Locked screen is treated as suspended: do not record as Distracted.
        if screen_locked {
            if !guard.is_suspended {
                if let Some(ref cur) = guard.current.take() {
                    if let Some(conn) = guard.conn() {
                        db_save_activity(&conn, &cur.app_name, &cur.window_title, cur.project_name.as_deref(), cur.start_time, now);
                    }
                }
                guard.was_idle = false;
                guard.is_suspended = true;
            }
            guard.last_sample_ts = now;
            continue;
        }

        // Just resumed from locked/suspended state.
        if guard.is_suspended {
            guard.is_suspended = false;
            guard.was_idle = false;
            guard.current = None;
            guard.last_sample_ts = now;
            continue;
        }

        guard.last_sample_ts = now;

        // Idle → start Distracted record
        if is_idle && !guard.was_idle {
            if let Some(ref cur) = guard.current.take() {
                if let Some(conn) = guard.conn() {
                    db_save_activity(&conn, &cur.app_name, &cur.window_title, cur.project_name.as_deref(), cur.start_time, now);
                }
            }
            guard.current = Some(CurrentActivity {
                app_name: "Distracted".to_string(),
                window_title: "Idle".to_string(),
                project_name: None,
                start_time: now,
            });
            guard.was_idle = true;
            continue;
        }

        // Resume from idle
        if !is_idle && guard.was_idle {
            if let Some(ref cur) = guard.current.take() {
                if let Some(conn) = guard.conn() {
                    db_save_activity(&conn, &cur.app_name, &cur.window_title, cur.project_name.as_deref(), cur.start_time, now);
                }
            }
            guard.was_idle = false;
        }

        if is_idle {
            continue;
        }

        // Normal: get active window
        // Release lock during AppleScript call (can take ~200ms)
        drop(guard);
        let window = get_active_window();
        let mut guard = match state.lock() {
            Ok(g) => g,
            Err(_) => continue,
        };

        let (app, title, project) = match window {
            Some(w) => w,
            None => continue,
        };

        let now2 = now_ms();

        match &guard.current {
            None => {
                guard.current = Some(CurrentActivity {
                    app_name: app,
                    window_title: title,
                    project_name: project,
                    start_time: now2,
                });
            }
            Some(cur) if cur.app_name == app => {
                // Same app — update title and project in place
                let start = cur.start_time;
                let proj = project.or_else(|| cur.project_name.clone());
                guard.current = Some(CurrentActivity {
                    app_name: app,
                    window_title: title,
                    project_name: proj,
                    start_time: start,
                });
            }
            Some(_) => {
                // App changed — save old record
                let old = guard.current.take().unwrap();
                if let Some(conn) = guard.conn() {
                    db_save_activity(&conn, &old.app_name, &old.window_title, old.project_name.as_deref(), old.start_time, now2);
                }
                guard.current = Some(CurrentActivity {
                    app_name: app,
                    window_title: title,
                    project_name: project,
                    start_time: now2,
                });

                // Throttled daily_stats update (max once per 60s)
                let elapsed = now2 - guard.last_stats_update;
                if elapsed > 60_000 {
                    guard.last_stats_update = now2;
                    if let Some(conn) = guard.conn() {
                        update_daily_stats_impl(&conn);
                    }
                }
            }
        }
    });
}

// ──────────────────────────────────────────────────
// daily_stats update helper
// ──────────────────────────────────────────────────

fn update_daily_stats_impl(conn: &Connection) {
    let today = {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let d = chrono_date_str(now as i64 * 1000);
        d
    };
    let (start, end) = date_range(&today);

    // totals
    let (total_dur, active_count, app_count): (i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(duration),0), COUNT(*), COUNT(DISTINCT app_name) FROM activity_logs WHERE start_time>=?1 AND start_time<?2",
            params![start, end],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0, 0, 0));

    // categories
    let mut cat_stmt = match conn.prepare(
        "SELECT category, SUM(duration) FROM activity_logs WHERE start_time>=?1 AND start_time<?2 AND category IS NOT NULL GROUP BY category ORDER BY SUM(duration) DESC"
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    let categories: Vec<(String, i64)> = cat_stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();
    let primary_cat = categories.first().map(|c| c.0.clone());
    let cat_dist: HashMap<String, i64> = categories.into_iter().collect();
    let cat_json = serde_json::to_string(&cat_dist).unwrap_or_default();

    // top app
    let top_app: Option<String> = conn
        .query_row(
            "SELECT app_name FROM activity_logs WHERE start_time>=?1 AND start_time<?2 GROUP BY app_name ORDER BY SUM(duration) DESC LIMIT 1",
            params![start, end],
            |r| r.get(0),
        )
        .ok();

    // productivity score
    let dev = *cat_dist.get("development").unwrap_or(&0) as f64;
    let writing = *cat_dist.get("writing").unwrap_or(&0) as f64;
    let ops = *cat_dist.get("operations").unwrap_or(&0) as f64;
    let distracted = *cat_dist.get("distracted").unwrap_or(&0) as f64;
    let score = if total_dur > 0 {
        let td = total_dur as f64;
        let prod_ratio = (dev + writing + ops) / td;
        let dist_ratio = distracted / td;
        (50.0 + prod_ratio * 50.0 - dist_ratio * 30.0).clamp(0.0, 100.0)
    } else {
        50.0
    };

    let _ = conn.execute(
        "INSERT INTO daily_stats (date, total_duration, active_count, app_count, primary_category, category_distribution, top_app, productivity_score, last_updated)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(date) DO UPDATE SET
           total_duration=excluded.total_duration,
           active_count=excluded.active_count,
           app_count=excluded.app_count,
           primary_category=excluded.primary_category,
           category_distribution=excluded.category_distribution,
           top_app=excluded.top_app,
           productivity_score=excluded.productivity_score,
           last_updated=excluded.last_updated",
        params![today, total_dur, active_count, app_count, primary_cat, cat_json, top_app, score, now_ms()],
    );
}

pub fn chrono_date_str(ms: i64) -> String {
    // Convert ms timestamp → YYYY-MM-DD in local time
    // Use `date` command
    let secs = ms / 1000;
    let out = std::process::Command::new("date")
        .args(["-r", &secs.to_string(), "+%Y-%m-%d"])
        .output()
        .ok();
    if let Some(o) = out {
        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if s.len() == 10 {
            return s;
        }
    }
    // Fallback
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let days = d.as_secs() / 86400;
    format!("1970-{}", days) // should never hit
}

pub fn db_get_app_stats(conn: &Connection, date_str: &str) -> Vec<AppStat> {
    let (start, end) = date_range(date_str);

    let mut stmt = match conn.prepare(
        "SELECT app_name, SUM(duration) FROM activity_logs WHERE start_time>=?1 AND start_time<?2 GROUP BY app_name ORDER BY SUM(duration) DESC"
    ) { Ok(s) => s, Err(_) => return vec![] };

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let total: i64 = rows.iter().map(|r| r.1).sum();
    rows.into_iter()
        .map(|(app, dur)| AppStat {
            app_name: app,
            total_duration: dur,
            percentage: if total > 0 { dur * 100 / total } else { 0 },
        })
        .collect()
}

pub fn db_get_category_stats(conn: &Connection, date_str: &str) -> Vec<CategoryStat> {
    let (start, end) = date_range(date_str);

    let mut stmt = match conn.prepare(
        "SELECT COALESCE(NULLIF(category,''),'other'), SUM(duration)
         FROM activity_logs WHERE start_time>=?1 AND start_time<?2 AND category!='rest'
         GROUP BY COALESCE(NULLIF(category,''),'other')
         ORDER BY SUM(duration) DESC"
    ) { Ok(s) => s, Err(_) => return vec![] };

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let total: i64 = rows.iter().map(|r| r.1).sum();
    rows.into_iter()
        .map(|(cat, dur)| CategoryStat {
            category: cat,
            total_duration: dur,
            percentage: if total > 0 { dur * 100 / total } else { 0 },
        })
        .collect()
}

pub fn db_get_project_stats(conn: &Connection, date_str: &str) -> Vec<ProjectStat> {
    let (start, end) = date_range(date_str);

    let mut stmt = match conn.prepare(
        "SELECT project_name, SUM(duration) FROM activity_logs
         WHERE start_time>=?1 AND start_time<?2 AND project_name IS NOT NULL AND project_name!=''
         GROUP BY project_name ORDER BY SUM(duration) DESC LIMIT 10"
    ) { Ok(s) => s, Err(_) => return vec![] };

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let total: i64 = rows.iter().map(|r| r.1).sum();
    rows.into_iter()
        .map(|(proj, dur)| ProjectStat {
            project_name: proj,
            total_duration: dur,
            percentage: if total > 0 { dur * 100 / total } else { 0 },
        })
        .collect()
}

fn row_to_activity_log(r: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityLog> {
    let tags_str: Option<String> = r.get(8)?;
    let tags: Option<Vec<String>> = tags_str.as_deref().and_then(|s| serde_json::from_str(s).ok());
    Ok(ActivityLog {
        id: r.get(0)?,
        app_name: r.get(1)?,
        window_title: r.get(2)?,
        start_time: r.get(3)?,
        end_time: r.get(4)?,
        duration: r.get(5)?,
        category: r.get(6)?,
        project_name: r.get(7)?,
        tags,
        classified: r.get::<_, i32>(9)? != 0,
        remark: r.get(10)?,
    })
}

pub fn db_get_logs(conn: &Connection, date_str: &str, limit: i64, app_filter: Option<&str>) -> Vec<ActivityLog> {
    let (start, end) = date_range(date_str);
    if let Some(app) = app_filter {
        let mut stmt = match conn.prepare(
            "SELECT id, app_name, window_title, start_time, end_time, duration, category, project_name, tags, classified, remark
             FROM activity_logs WHERE start_time>=?1 AND start_time<?2 AND app_name=?3 ORDER BY start_time DESC LIMIT ?4"
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![start, end, app, limit], row_to_activity_log)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, app_name, window_title, start_time, end_time, duration, category, project_name, tags, classified, remark
             FROM activity_logs WHERE start_time>=?1 AND start_time<?2 ORDER BY start_time DESC LIMIT ?3"
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![start, end, limit], row_to_activity_log)
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }
}

pub fn db_get_total_duration(conn: &Connection, date_str: &str) -> i64 {
    let (start, end) = date_range(date_str);
    conn.query_row(
        "SELECT COALESCE(SUM(duration),0) FROM activity_logs WHERE start_time>=?1 AND start_time<?2",
        params![start, end],
        |r| r.get(0),
    ).unwrap_or(0)
}

// ──────────────────────────────────────────────────
// Tauri Commands
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn activity_get_today_stats(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> Vec<AppStat> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    db_get_app_stats(&conn, &date_str)
}

#[tauri::command]
pub fn activity_get_today_logs(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> Vec<ActivityLog> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    let (start, end) = date_range(&date_str);

    let mut stmt = match conn.prepare(
        "SELECT id, app_name, window_title, start_time, end_time, duration, category, project_name, tags, classified, remark
         FROM activity_logs WHERE start_time>=?1 AND start_time<?2 ORDER BY start_time DESC LIMIT 2000"
    ) { Ok(s) => s, Err(_) => return vec![] };

    stmt.query_map(params![start, end], |r| {
        let tags_str: Option<String> = r.get(8)?;
        let tags: Option<Vec<String>> = tags_str.as_deref().and_then(|s| serde_json::from_str(s).ok());
        Ok(ActivityLog {
            id: r.get(0)?,
            app_name: r.get(1)?,
            window_title: r.get(2)?,
            start_time: r.get(3)?,
            end_time: r.get(4)?,
            duration: r.get(5)?,
            category: r.get(6)?,
            project_name: r.get(7)?,
            tags,
            classified: r.get::<_, i32>(9)? != 0,
            remark: r.get(10)?,
        })
    })
    .map(|rows| rows.flatten().collect::<Vec<_>>())
    .unwrap_or_default()
}

#[tauri::command]
pub fn activity_get_today_total_duration(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> i64 {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return 0 };
    let conn = match guard.conn() { Some(c) => c, None => return 0 };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    let (start, end) = date_range(&date_str);
    conn.query_row(
        "SELECT COALESCE(SUM(duration),0) FROM activity_logs WHERE start_time>=?1 AND start_time<?2",
        params![start, end],
        |r| r.get(0),
    ).unwrap_or(0)
}

#[tauri::command]
pub fn activity_get_stats_by_category(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> Vec<CategoryStat> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    let (start, end) = date_range(&date_str);

    let mut stmt = match conn.prepare(
        "SELECT COALESCE(NULLIF(category,''),'other'), SUM(duration)
         FROM activity_logs WHERE start_time>=?1 AND start_time<?2 AND category!='rest'
         GROUP BY COALESCE(NULLIF(category,''),'other')
         ORDER BY SUM(duration) DESC"
    ) { Ok(s) => s, Err(_) => return vec![] };

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let total: i64 = rows.iter().map(|r| r.1).sum();
    rows.into_iter()
        .map(|(cat, dur)| CategoryStat {
            category: cat,
            total_duration: dur,
            percentage: if total > 0 { dur * 100 / total } else { 0 },
        })
        .collect()
}

#[tauri::command]
pub fn activity_get_stats_by_project(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> Vec<ProjectStat> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    let (start, end) = date_range(&date_str);

    let mut stmt = match conn.prepare(
        "SELECT project_name, SUM(duration) FROM activity_logs
         WHERE start_time>=?1 AND start_time<?2 AND project_name IS NOT NULL AND project_name!=''
         GROUP BY project_name ORDER BY SUM(duration) DESC LIMIT 10"
    ) { Ok(s) => s, Err(_) => return vec![] };

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let total: i64 = rows.iter().map(|r| r.1).sum();
    rows.into_iter()
        .map(|(proj, dur)| ProjectStat {
            project_name: proj,
            total_duration: dur,
            percentage: if total > 0 { dur * 100 / total } else { 0 },
        })
        .collect()
}

#[tauri::command]
pub fn activity_get_today_logs_count(
    state: tauri::State<SharedActivityState>,
    date: Option<String>,
) -> i64 {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return 0 };
    let conn = match guard.conn() { Some(c) => c, None => return 0 };
    let date_str = date.unwrap_or_else(|| chrono_date_str(now_ms()));
    let (start, end) = date_range(&date_str);
    conn.query_row(
        "SELECT COUNT(*) FROM activity_logs WHERE start_time>=?1 AND start_time<?2",
        params![start, end],
        |r| r.get(0),
    ).unwrap_or(0)
}

#[tauri::command]
pub fn activity_get_daily_summary(
    state: tauri::State<SharedActivityState>,
    date: String,
) -> Option<DailySummary> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return None };
    let conn = match guard.conn() { Some(c) => c, None => return None };
    conn.query_row(
        "SELECT content, model, created_at FROM daily_summaries WHERE date=?1 AND is_active=1 ORDER BY created_at DESC LIMIT 1",
        params![date],
        |r| Ok(DailySummary { content: r.get(0)?, model: r.get(1)?, created_at: r.get(2)? }),
    ).ok()
}

#[tauri::command]
pub fn activity_update_remark(
    state: tauri::State<SharedActivityState>,
    id: String,
    remark: Option<String>,
) -> bool {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return false };
    let conn = match guard.conn() { Some(c) => c, None => return false };
    conn.execute(
        "UPDATE activity_logs SET remark=?1 WHERE id=?2",
        params![remark, id],
    ).is_ok()
}

fn migrate_electron_records(conn: &Connection) {
    let mut select_stmt = match conn.prepare(
        "SELECT id, window_title FROM activity_logs WHERE app_name = 'Electron' OR app_name = 'Unknown'"
    ) {
        Ok(s) => s,
        Err(_) => return,
    };

    let rows: Vec<(String, String)> = select_stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|r| r.flatten().collect())
        .unwrap_or_default();

    if rows.is_empty() {
        return;
    }

    let _ = conn.execute_batch("BEGIN TRANSACTION;");
    if let Ok(mut update_stmt) = conn.prepare(
        "UPDATE activity_logs SET app_name = ?1, project_name = COALESCE(project_name, ?2), category = ?3, classified = 1 WHERE id = ?4"
    ) {
        for (id, title) in rows {
            let (real_app, proj) = resolve_app_identity("Electron", "", "", &title);
            if real_app != "Electron" && real_app != "Unknown" {
                let cat = classify_app(&real_app);
                let _ = update_stmt.execute(params![real_app, proj, cat, id]);
            }
        }
    }
    let _ = conn.execute_batch("COMMIT;");
}

/// Re-classify unclassified logs using static rules (no AI in eva)
#[tauri::command]
pub fn activity_classify_now(state: tauri::State<SharedActivityState>) -> i64 {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return 0 };
    let conn = match guard.conn() { Some(c) => c, None => return 0 };

    // Also migrate any legacy Electron records
    migrate_electron_records(&conn);

    let mut stmt = match conn.prepare(
        "SELECT id, app_name, window_title FROM activity_logs WHERE classified=0 OR classified IS NULL OR app_name = 'Electron' ORDER BY start_time DESC LIMIT 1000"
    ) { Ok(s) => s, Err(_) => return 0 };

    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let mut updated = 0i64;
    for (id, app, title) in rows {
        let (real_app, proj) = if app == "Electron" || app == "Unknown" {
            resolve_app_identity(&app, "", "", &title)
        } else {
            (app.clone(), None)
        };
        let cat = classify_app(&real_app);
        if cat != "other" || real_app != app {
            if conn.execute(
                "UPDATE activity_logs SET app_name=?1, project_name=COALESCE(project_name, ?2), category=?3, classified=1 WHERE id=?4",
                params![real_app, proj, cat, id],
            ).is_ok() {
                updated += 1;
            }
        }
    }
    if updated > 0 {
        update_daily_stats_impl(&conn);
    }
    updated
}

/// Batch-fetch unclassified logs for AI classification in the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnclassifiedItem {
    pub id: String,
    pub app_name: String,
    pub window_title: String,
}

#[tauri::command]
pub fn activity_get_unclassified_batch(
    state: tauri::State<SharedActivityState>,
    limit: Option<i64>,
) -> Vec<UnclassifiedItem> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };
    let limit = limit.unwrap_or(200);

    // Only return rows where static classification left them as 'other'
    let mut stmt = match conn.prepare(
        "SELECT id, app_name, window_title FROM activity_logs
         WHERE (category = 'other' OR classified = 0)
           AND app_name NOT IN ('Distracted','Rest','System')
         GROUP BY app_name, window_title
         ORDER BY MAX(start_time) DESC
         LIMIT ?1"
    ) { Ok(s) => s, Err(_) => return vec![] };

    stmt.query_map([limit], |r| {
        Ok(UnclassifiedItem { id: r.get(0)?, app_name: r.get(1)?, window_title: r.get(2)? })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

/// Classification result sent back from frontend AI call
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiClassificationResult {
    pub app_name: String,
    pub window_title: String,
    pub category: String,
    pub project_name: Option<String>,
}

#[tauri::command]
pub fn activity_apply_ai_classification(
    state: tauri::State<SharedActivityState>,
    results: Vec<AiClassificationResult>,
) -> i64 {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return 0 };
    let conn = match guard.conn() { Some(c) => c, None => return 0 };

    let valid_cats = [
        "development","operations","research","communication","writing",
        "design","entertainment","productivity","browsing","distracted",
        "system","rest","other",
    ];
    let mut updated = 0i64;

    for r in results {
        let cat = r.category.trim().to_lowercase();
        let cat = if valid_cats.contains(&cat.as_str()) { cat } else { "other".to_string() };
        let affected = conn.execute(
            "UPDATE activity_logs SET category=?1, project_name=?2, classified=1
             WHERE app_name=?3 AND window_title=?4 AND (category='other' OR classified=0)",
            params![cat, r.project_name, r.app_name, r.window_title],
        ).unwrap_or(0);
        updated += affected as i64;
    }

    // Refresh daily stats after bulk update
    update_daily_stats_impl(&conn);

    updated
}

/// Generate summary stub — AI engine not available in eva
#[tauri::command]
pub fn activity_generate_summary(
    state: tauri::State<SharedActivityState>,
    date: String,
) -> String {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return "无数据".to_string() };
    let conn = match guard.conn() { Some(c) => c, None => return "无数据".to_string() };
    let (start, end) = date_range(&date);

    let total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(duration),0) FROM activity_logs WHERE start_time>=?1 AND start_time<?2",
        params![start, end],
        |r| r.get(0),
    ).unwrap_or(0);

    if total == 0 {
        return format!("📅 {} 暂无活动记录。", date);
    }

    // Build a simple text summary from category stats
    let mut cat_stmt = match conn.prepare(
        "SELECT COALESCE(NULLIF(category,''),'other'), SUM(duration) FROM activity_logs WHERE start_time>=?1 AND start_time<?2 GROUP BY category ORDER BY SUM(duration) DESC LIMIT 5"
    ) { Ok(s) => s, Err(_) => return "统计失败".to_string() };

    let cats: Vec<(String, i64)> = cat_stmt
        .query_map(params![start, end], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|rows| rows.flatten().collect::<Vec<_>>())
        .unwrap_or_default();

    let hours = total / 3600;
    let mins = (total % 3600) / 60;

    let mut lines = vec![
        format!("## 📅 {} 活动总结", date),
        String::new(),
        format!("**总活跃时长**: {}小时{}分钟", hours, mins),
        String::new(),
        "**分类分布**:".to_string(),
    ];
    for (cat, dur) in &cats {
        let pct = dur * 100 / total;
        let h = dur / 3600;
        let m = (dur % 3600) / 60;
        lines.push(format!("- {}: {}小时{}分钟 ({}%)", cat, h, m, pct));
    }
    lines.push(String::new());
    lines.push("*（AI 摘要功能在 EVA 中暂不可用，以上为统计数据）*".to_string());

    let summary = lines.join("\n");

    // Save to DB
    let _ = conn.execute(
        "UPDATE daily_summaries SET is_active=0 WHERE date=?1",
        params![date],
    );
    let _ = conn.execute(
        "INSERT INTO daily_summaries (id, date, content, model, created_at, is_active) VALUES (?1,?2,?3,?4,?5,1)",
        params![Uuid::new_v4().to_string(), date, summary, "static", now_ms()],
    );

    summary
}

#[tauri::command]
pub fn activity_get_heatmap_data(
    state: tauri::State<SharedActivityState>,
    year: i32,
) -> Vec<HeatmapDataPoint> {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return vec![] };
    let conn = match guard.conn() { Some(c) => c, None => return vec![] };

    let start_date = format!("{}-01-01", year);
    let end_date = format!("{}-01-01", year + 1);

    let mut stmt = match conn.prepare(
        "SELECT date, total_duration, primary_category, productivity_score FROM daily_stats WHERE date>=?1 AND date<?2"
    ) { Ok(s) => s, Err(_) => return vec![] };

    stmt.query_map(params![start_date, end_date], |r| {
        let date: String = r.get(0)?;
        let total: i64 = r.get::<_, Option<i64>>(1)?.unwrap_or(0);
        let primary_cat: Option<String> = r.get(2)?;
        let score: f64 = r.get::<_, Option<f64>>(3)?.unwrap_or(50.0);
        let hue = match primary_cat.as_deref() {
            Some("development") | Some("writing") | Some("operations") => "violet",
            Some("distracted") | Some("entertainment") => "orange",
            _ => "indigo",
        }.to_string();
        Ok(HeatmapDataPoint { date, total, hue, score })
    })
    .map(|rows| rows.flatten().collect::<Vec<_>>())
    .unwrap_or_default()
}

#[tauri::command]
pub fn activity_rebuild_daily_stats(state: tauri::State<SharedActivityState>) {
    let guard = match state.lock() { Ok(g) => g, Err(_) => return };
    if let Some(conn) = guard.conn() {
        update_daily_stats_impl(&conn);
    }
}

// ──────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────

pub fn init(app: &AppHandle) -> SharedActivityState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);

    let db_path = user_data.join("activity-tracker.db").to_string_lossy().to_string();

    // Init schema
    if let Ok(conn) = Connection::open(&db_path) {
        let _ = init_db(&conn);
        migrate_electron_records(&conn);
        update_daily_stats_impl(&conn);
    }

    let state = Arc::new(Mutex::new(ActivityState {
        db_path,
        current: None,
        was_idle: false,
        is_suspended: false,
        last_sample_ts: 0,
        last_stats_update: 0,
    }));

    start_polling(Arc::clone(&state));

    log::info!("[ActivityTracker] Started");
    state
}
