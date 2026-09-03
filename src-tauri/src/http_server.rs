use crate::activity_tracker;
use crate::clipboard;
use crate::env_detector;
use crate::local_ports;
use crate::memory_analyzer;
use crate::visual_recall;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use url::Url;

// ──────────────────────────────────────────────────
// Configuration & Types
// ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpServerConfig {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    #[serde(default = "default_require_auth")]
    pub require_auth: bool,
    #[serde(default)]
    pub running: bool,
}

fn default_require_auth() -> bool {
    true
}

impl Default for HttpServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: 14220,
            token: "eva-local-token".to_string(),
            require_auth: true,
            running: false,
        }
    }
}

pub struct HttpServerState {
    config_path: PathBuf,
    user_data_dir: PathBuf,
    config: Arc<Mutex<HttpServerConfig>>,
    shutdown_signal: Arc<AtomicBool>,
}

pub type SharedHttpServerState = Arc<Mutex<HttpServerState>>;

// ──────────────────────────────────────────────────
// Path Helpers
// ──────────────────────────────────────────────────

fn get_user_data_dir_fallback() -> PathBuf {
    if let Some(base) = dirs::data_dir() {
        let app_dir = base.join("com.xiyangxie.eva").join("userData");
        if app_dir.exists() {
            return app_dir;
        }
        let fallback = base.join("eva").join("userData");
        if fallback.exists() {
            return fallback;
        }
    }
    dirs::data_dir()
        .map(|d| d.join("com.xiyangxie.eva").join("userData"))
        .unwrap_or_else(|| PathBuf::from("./userData"))
}

fn open_db(user_data: &Path, filename: &str) -> Option<Connection> {
    let path = user_data.join(filename);
    if !path.exists() {
        return None;
    }
    Connection::open(&path).ok()
}

fn load_config(config_path: &Path) -> HttpServerConfig {
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(config_path) {
            if let Ok(mut cfg) = serde_json::from_str::<HttpServerConfig>(&content) {
                cfg.running = false;
                return cfg;
            }
        }
    }
    HttpServerConfig::default()
}

fn save_config_to_file(config_path: &Path, config: &HttpServerConfig) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path, json).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────────
// HTTP Server Implementation
// ──────────────────────────────────────────────────

fn json_response<T: Serialize>(data: &T, status_code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(data).unwrap_or_else(|_| b"{}".to_vec());
    let mut resp = Response::from_data(body).with_status_code(StatusCode(status_code));
    resp.add_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json; charset=utf-8"[..]).unwrap());
    resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
    resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap());
    resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Authorization, Content-Type"[..]).unwrap());
    resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Private-Network"[..], &b"true"[..]).unwrap());
    resp
}

fn error_response(msg: &str, status_code: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    #[derive(Serialize)]
    struct ErrorBody<'a> {
        error: &'a str,
        statusCode: u16,
    }
    json_response(&ErrorBody { error: msg, statusCode: status_code }, status_code)
}

fn start_server_thread(
    port: u16,
    expected_token: Arc<Mutex<String>>,
    require_auth: Arc<AtomicBool>,
    user_data_dir: PathBuf,
    shutdown: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let bind_addr = format!("127.0.0.1:{}", port);
        log::info!("[HttpServer] Attempting to bind {}", bind_addr);
        let server = match Server::http(&bind_addr) {
            Ok(s) => {
                log::info!("[HttpServer] Running on http://{}", bind_addr);
                s
            }
            Err(e) => {
                log::error!("[HttpServer] Failed to bind {}: {}", bind_addr, e);
                return;
            }
        };

        while !shutdown.load(Ordering::Relaxed) {
            let mut request = match server.recv_timeout(std::time::Duration::from_millis(500)) {
                Ok(Some(req)) => req,
                Ok(None) => continue,
                Err(e) => {
                    log::error!("[HttpServer] Error receiving request: {}", e);
                    continue;
                }
            };

            let method = request.method().clone();
            let raw_url = request.url().to_string();

            // Handle CORS preflight
            if method == Method::Options {
                let mut resp = Response::from_string("").with_status_code(StatusCode(200));
                resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap());
                resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Authorization, Content-Type"[..]).unwrap());
                resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Private-Network"[..], &b"true"[..]).unwrap());
                let _ = request.respond(resp);
                continue;
            }

            // Parse URL & Query params
            let parsed_url = match Url::parse(&format!("http://localhost{}", raw_url)) {
                Ok(u) => u,
                Err(_) => {
                    let _ = request.respond(error_response("Invalid URL", 400));
                    continue;
                }
            };
            let path = parsed_url.path();
            let query_map: HashMap<String, String> = parsed_url.query_pairs().into_owned().collect();

            // Interactive Documentation & Health check endpoints (Open, no auth required)
            if method == Method::Get && (path == "/" || path == "/docs" || path == "/api/docs") {
                let html = include_str!("api_docs.html");
                let mut resp = Response::from_string(html).with_status_code(StatusCode(200));
                resp.add_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap());
                resp.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap());
                let _ = request.respond(resp);
                continue;
            }

            if path == "/api/health" || path == "/health" {
                #[derive(Serialize)]
                struct Health {
                    status: &'static str,
                    version: &'static str,
                    service: &'static str,
                }
                let _ = request.respond(json_response(&Health { status: "ok", version: "0.1.2", service: "EVA Local Intelligence API" }, 200));
                continue;
            }

            // Authentication check (can be disabled for local connection)
            let is_authorized = if !require_auth.load(Ordering::Relaxed) {
                true
            } else {
                let auth_header = request
                    .headers()
                    .iter()
                    .find(|h| h.field.as_str().to_string().eq_ignore_ascii_case("authorization"))
                    .map(|h| h.value.as_str().to_string());

                let token = expected_token.lock().unwrap().clone();
                if token.is_empty() {
                    true
                } else if let Some(ref header_val) = auth_header {
                    if header_val.starts_with("Bearer ") {
                        header_val.strip_prefix("Bearer ").unwrap().trim() == token.as_str()
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            if !is_authorized {
                let _ = request.respond(error_response("Unauthorized: Missing or invalid Bearer token", 401));
                continue;
            }

            // Route Handlers
            match (method, path) {
                // 1. Context Snapshot
                (Method::Get, "/api/context") => {
                    let active = activity_tracker::get_active_window().map(|(app, title, proj)| {
                        serde_json::json!({
                            "appName": app,
                            "windowTitle": title,
                            "projectName": proj,
                        })
                    });

                    let today_str = activity_tracker::chrono_date_str(activity_tracker::now_ms());
                    let (total_dur, top_apps, categories) = if let Some(conn) = open_db(&user_data_dir, "activity-tracker.db") {
                        let total = activity_tracker::db_get_total_duration(&conn, &today_str);
                        let apps = activity_tracker::db_get_app_stats(&conn, &today_str);
                        let cats = activity_tracker::db_get_category_stats(&conn, &today_str);
                        (total, apps, cats)
                    } else {
                        (0, vec![], vec![])
                    };

                    let latest_clip = if let Some(conn) = open_db(&user_data_dir, "clipboard-history.db") {
                        clipboard::db_get_items(&conn, 1, 0, None).into_iter().next()
                    } else {
                        None
                    };

                    let ports = local_ports::get_listening_ports().unwrap_or_default();

                    let snapshot = serde_json::json!({
                        "timestamp": activity_tracker::now_ms(),
                        "activeWindow": active,
                        "todayProductivity": {
                            "date": today_str,
                            "totalMinutes": total_dur / 60,
                            "topApps": top_apps.into_iter().take(5).collect::<Vec<_>>(),
                            "categories": categories,
                        },
                        "latestClipboard": latest_clip,
                        "listeningPorts": ports,
                    });

                    let _ = request.respond(json_response(&snapshot, 200));
                }

                // 2. Activity: Current
                (Method::Get, "/api/activity/current") => {
                    let active = activity_tracker::get_active_window().map(|(app, title, proj)| {
                        serde_json::json!({
                            "appName": app,
                            "windowTitle": title,
                            "projectName": proj,
                        })
                    });
                    let _ = request.respond(json_response(&active, 200));
                }

                // 3. Activity: Today
                (Method::Get, "/api/activity/today") => {
                    let date_str = query_map.get("date").cloned().unwrap_or_else(|| activity_tracker::chrono_date_str(activity_tracker::now_ms()));
                    if let Some(conn) = open_db(&user_data_dir, "activity-tracker.db") {
                        let total_dur = activity_tracker::db_get_total_duration(&conn, &date_str);
                        let apps = activity_tracker::db_get_app_stats(&conn, &date_str);
                        let categories = activity_tracker::db_get_category_stats(&conn, &date_str);
                        let projects = activity_tracker::db_get_project_stats(&conn, &date_str);

                        let resp = serde_json::json!({
                            "date": date_str,
                            "totalSeconds": total_dur,
                            "totalMinutes": total_dur / 60,
                            "apps": apps,
                            "categories": categories,
                            "projects": projects,
                        });
                        let _ = request.respond(json_response(&resp, 200));
                    } else {
                        let _ = request.respond(error_response("Database unavailable", 500));
                    }
                }

                // 3.5. Activity: Heatmap
                (Method::Get, "/api/activity/heatmap") => {
                    let year: Option<i32> = query_map.get("year").and_then(|y| y.parse().ok());
                    let start_date = query_map.get("startDate").or_else(|| query_map.get("start_date")).cloned();
                    let end_date = query_map.get("endDate").or_else(|| query_map.get("end_date")).cloned();

                    if let Some(conn) = open_db(&user_data_dir, "activity-tracker.db") {
                        let (start, end) = if let (Some(s), Some(e)) = (start_date, end_date) {
                            (s, e)
                        } else {
                            let y = year.unwrap_or(2026);
                            (format!("{}-01-01", y), format!("{}-12-31", y))
                        };

                        let mut stmt = match conn.prepare(
                            "SELECT date, total_duration, primary_category, productivity_score FROM daily_stats WHERE date>=?1 AND date<=?2 ORDER BY date ASC"
                        ) {
                            Ok(s) => s,
                            Err(e) => {
                                let _ = request.respond(error_response(&e.to_string(), 500));
                                continue;
                            }
                        };

                        let rows = stmt.query_map(rusqlite::params![start, end], |r| {
                            let date: String = r.get(0)?;
                            let total: i64 = r.get::<_, Option<i64>>(1)?.unwrap_or(0);
                            let primary_cat: Option<String> = r.get(2)?;
                            let score: f64 = r.get::<_, Option<f64>>(3)?.unwrap_or(50.0);
                            let hue = match primary_cat.as_deref() {
                                Some("development") | Some("writing") | Some("operations") => "violet",
                                Some("distracted") | Some("entertainment") => "orange",
                                _ => "indigo",
                            }.to_string();
                            Ok(serde_json::json!({
                                "date": date,
                                "total": total,
                                "totalHours": (total as f64 / 3600.0 * 10.0).round() / 10.0,
                                "hue": hue,
                                "score": score,
                                "category": primary_cat,
                            }))
                        });

                        let points: Vec<serde_json::Value> = match rows {
                            Ok(mapped) => mapped.flatten().collect(),
                            Err(_) => vec![],
                        };
                        let _ = request.respond(json_response(&serde_json::json!({ "ok": true, "heatmap": points }), 200));
                    } else {
                        let _ = request.respond(error_response("Database unavailable", 500));
                    }
                }

                // 4. Activity: Logs
                (Method::Get, "/api/activity/logs") => {
                    let date_str = query_map.get("date").cloned().unwrap_or_else(|| activity_tracker::chrono_date_str(activity_tracker::now_ms()));
                    let limit: i64 = query_map.get("limit").and_then(|l| l.parse().ok()).unwrap_or(50);
                    let app_filter = query_map.get("app").map(|s| s.as_str());

                    if let Some(conn) = open_db(&user_data_dir, "activity-tracker.db") {
                        let logs = activity_tracker::db_get_logs(&conn, &date_str, limit, app_filter);
                        let _ = request.respond(json_response(&logs, 200));
                    } else {
                        let _ = request.respond(error_response("Database unavailable", 500));
                    }
                }

                // 5. Clipboard: Latest
                (Method::Get, "/api/clipboard/latest") => {
                    let live_text = arboard::Clipboard::new().ok().and_then(|mut cb| cb.get_text().ok());
                    let db_item = open_db(&user_data_dir, "clipboard-history.db")
                        .and_then(|conn| clipboard::db_get_items(&conn, 1, 0, None).into_iter().next());

                    let resp = serde_json::json!({
                        "liveText": live_text,
                        "latestHistoryItem": db_item,
                    });
                    let _ = request.respond(json_response(&resp, 200));
                }

                // 6. Clipboard: List
                (Method::Get, "/api/clipboard/list") => {
                    let limit: i64 = query_map.get("limit").and_then(|l| l.parse().ok()).unwrap_or(20);
                    let offset: i64 = query_map.get("offset").and_then(|o| o.parse().ok()).unwrap_or(0);
                    let date = query_map.get("date").map(|s| s.as_str());

                    if let Some(conn) = open_db(&user_data_dir, "clipboard-history.db") {
                        let items = clipboard::db_get_items(&conn, limit, offset, date);
                        let _ = request.respond(json_response(&items, 200));
                    } else {
                        let _ = request.respond(error_response("Database unavailable", 500));
                    }
                }

                // 7. Clipboard: Search
                (Method::Get, "/api/clipboard/search") => {
                    let query = query_map.get("q").cloned().unwrap_or_default();
                    let limit: i64 = query_map.get("limit").and_then(|l| l.parse().ok()).unwrap_or(20);
                    let date = query_map.get("date").map(|s| s.as_str());

                    if let Some(conn) = open_db(&user_data_dir, "clipboard-history.db") {
                        let items = clipboard::db_search_items(&conn, &query, limit, date);
                        let _ = request.respond(json_response(&items, 200));
                    } else {
                        let _ = request.respond(error_response("Database unavailable", 500));
                    }
                }

                // 9. Env: Detect
                (Method::Get, "/api/env") | (Method::Get, "/api/env/detect") => {
                    let tools = env_detector::detect_all_tools(None);
                    let _ = request.respond(json_response(&tools, 200));
                }

                // 10. Ports: List
                (Method::Get, "/api/ports") | (Method::Get, "/api/ports/list") => {
                    let list = local_ports::get_listening_ports().unwrap_or_default();
                    let _ = request.respond(json_response(&list, 200));
                }

                // 11. Ports: Kill
                (Method::Post, "/api/ports/kill") => {
                    let mut body_str = String::new();
                    let _ = request.as_reader().read_to_string(&mut body_str);

                    #[derive(Deserialize)]
                    struct KillReq {
                        pid: u32,
                    }

                    if let Ok(req) = serde_json::from_str::<KillReq>(&body_str) {
                        let result = local_ports::kill_process(req.pid);
                        let _ = request.respond(json_response(&result, 200));
                    } else {
                        let _ = request.respond(error_response("Invalid JSON body. Expected {\"pid\": 12345}", 400));
                    }
                }

                // 12. Memory: List
                (Method::Get, "/api/memory") => {
                    let top: usize = query_map.get("top").and_then(|t| t.parse().ok()).unwrap_or(10);
                    match memory_analyzer::get_memory_analysis() {
                        Ok(mut res) => {
                            res.apps.truncate(top);
                            let _ = request.respond(json_response(&res, 200));
                        }
                        Err(e) => {
                            let _ = request.respond(error_response(&e, 500));
                        }
                    }
                }

                // 13. Recall: Query
                (Method::Get, "/api/recall") => {
                    let limit: i64 = query_map.get("limit").and_then(|l| l.parse().ok()).unwrap_or(20);
                    let offset: i64 = query_map.get("offset").and_then(|l| l.parse().ok()).unwrap_or(0);
                    let now = activity_tracker::now_ms();
                    let start = now - 7 * 86400 * 1000;
                    let snapshots = visual_recall::db_query_by_time_range(&user_data_dir, start, now, limit, offset);
                    let _ = request.respond(json_response(&snapshots, 200));
                }

                _ => {
                    let _ = request.respond(error_response("Endpoint not found", 404));
                }
            }
        }

        log::info!("[HttpServer] Server thread exited");
    });
}

// ──────────────────────────────────────────────────
// Lifecycle & Management
// ──────────────────────────────────────────────────

pub fn init(app: &AppHandle) -> SharedHttpServerState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| get_user_data_dir_fallback());
    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);

    let config_path = user_data.join("api_config.json");
    let mut config = load_config(&config_path);

    let shutdown_signal = Arc::new(AtomicBool::new(false));
    let token_arc = Arc::new(Mutex::new(config.token.clone()));
    let require_auth_arc = Arc::new(AtomicBool::new(config.require_auth));

    if config.enabled {
        config.running = true;
        start_server_thread(
            config.port,
            Arc::clone(&token_arc),
            Arc::clone(&require_auth_arc),
            user_data.clone(),
            Arc::clone(&shutdown_signal),
        );
    }

    Arc::new(Mutex::new(HttpServerState {
        config_path,
        user_data_dir: user_data,
        config: Arc::new(Mutex::new(config)),
        shutdown_signal,
    }))
}

pub fn start_standalone_server(port: u16, token: String, require_auth: bool) {
    let user_data = get_user_data_dir_fallback();
    let shutdown = Arc::new(AtomicBool::new(false));
    let token_arc = Arc::new(Mutex::new(token));
    let require_auth_arc = Arc::new(AtomicBool::new(require_auth));
    start_server_thread(port, token_arc, require_auth_arc, user_data, shutdown);
}

// ──────────────────────────────────────────────────
// Tauri Commands
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn http_server_get_config(
    state: tauri::State<SharedHttpServerState>,
) -> Result<HttpServerConfig, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let cfg = guard.config.lock().map_err(|e| e.to_string())?.clone();
    Ok(cfg)
}

#[tauri::command]
pub fn http_server_save_config(
    state: tauri::State<SharedHttpServerState>,
    config: HttpServerConfig,
) -> Result<HttpServerConfig, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    save_config_to_file(&guard.config_path, &config)?;

    // Update memory config
    let mut cfg_guard = guard.config.lock().map_err(|e| e.to_string())?;
    *cfg_guard = config.clone();

    // Signal old thread to stop and restart if enabled
    guard.shutdown_signal.store(true, Ordering::Relaxed);

    let new_shutdown = Arc::new(AtomicBool::new(false));
    if config.enabled {
        let token_arc = Arc::new(Mutex::new(config.token.clone()));
        let require_auth_arc = Arc::new(AtomicBool::new(config.require_auth));
        start_server_thread(
            config.port,
            token_arc,
            require_auth_arc,
            guard.user_data_dir.clone(),
            Arc::clone(&new_shutdown),
        );
    }

    let mut result = config;
    result.running = result.enabled;
    Ok(result)
}

#[tauri::command]
pub fn http_server_generate_token() -> String {
    format!("eva_sk_{}", uuid::Uuid::new_v4().to_string().replace('-', ""))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    pub status_code: u16,
    pub message: String,
    pub active_window: Option<String>,
    pub latency_ms: u64,
}

#[tauri::command]
pub async fn http_server_test_connection(port: u16, token: String, require_auth: Option<bool>) -> Result<TestConnectionResult, String> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/api/context", port);
    let mut req = client.get(&url);
    if require_auth.unwrap_or(true) && !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", token));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("连接失败 (服务可能未启动或端口被占用): {}", e))?;

    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    let latency = start.elapsed().as_millis() as u64;

    if (200..300).contains(&status) {
        let body: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let active = body.get("activeWindow")
            .and_then(|w| w.get("appName"))
            .and_then(|a| a.as_str())
            .map(|s| s.to_string());

        Ok(TestConnectionResult {
            success: true,
            status_code: status,
            message: format!("HTTP {} OK，耗时 {}ms", status, latency),
            active_window: active,
            latency_ms: latency,
        })
    } else {
        Ok(TestConnectionResult {
            success: false,
            status_code: status,
            message: format!("HTTP {} 响应异常: {}", status, text),
            active_window: None,
            latency_ms: latency,
        })
    }
}
