//! Built-in local dev service lifecycle manager (start / stop / status / health).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// ── Config types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicesConfig {
    pub services: Vec<ServiceDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceDefinition {
    pub id: String,
    pub name: String,
    #[serde(rename = "projectDir")]
    pub project_dir: String,
    pub start: StartConfig,
    #[serde(rename = "preStart")]
    pub pre_start: Option<PreStartConfig>,
    #[serde(rename = "pidFile")]
    pub pid_file: String,
    #[serde(rename = "logFile")]
    pub log_file: String,
    pub ports: Vec<u32>,
    pub health: HealthConfig,
    #[serde(rename = "openUrl")]
    pub open_url: String,
    pub stop: Option<StopConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartConfig {
    pub command: Vec<String>,
    pub cwd: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(rename = "requirePath")]
    pub require_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreStartConfig {
    pub when: String,
    pub command: Vec<String>,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthConfig {
    pub url: String,
    #[serde(default)]
    pub contains: Option<String>,
    #[serde(rename = "statusOk", default)]
    pub status_ok: bool,
    #[serde(rename = "fallbackUrls", default)]
    pub fallback_urls: Vec<String>,
    /// HTTP codes that count as healthy (e.g. 404 means API process is up).
    #[serde(rename = "acceptHttpCodes", default)]
    pub accept_http_codes: Vec<String>,
    #[serde(rename = "timeoutSecs", default = "default_health_timeout")]
    pub timeout_secs: u64,
    #[serde(rename = "pollIntervalSecs", default = "default_poll_interval")]
    pub poll_interval_secs: u64,
}

fn default_health_timeout() -> u64 {
    120
}

fn default_poll_interval() -> u64 {
    2
}

/// HTTP timeout for status-page probes (keep startup wait timeouts separate).
const PROBE_HTTP_MAX_SECS: &str = "1";

struct ProbeContext {
    listening_ports: HashSet<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopConfig {
    #[serde(rename = "graceSecs", default = "default_grace_secs")]
    pub grace_secs: u64,
    #[serde(rename = "cleanupPorts", default)]
    pub cleanup_ports: Vec<u32>,
}

fn default_grace_secs() -> u64 {
    15
}

// ── API response types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMeta {
    pub id: String,
    pub name: String,
    pub ports: Vec<u32>,
    pub open_url: String,
    pub project_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    pub port: u32,
    pub listening: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub id: String,
    pub name: String,
    pub state: String,
    pub pid: Option<u32>,
    pub ports: Vec<PortStatus>,
    pub health: String,
    pub open_url: String,
    pub log_file: String,
    pub project_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extras: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionEvent {
    pub id: String,
    pub success: bool,
    pub message: String,
}

fn pending_ops() -> &'static Mutex<HashMap<String, String>> {
    static OPS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    OPS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn set_pending(id: &str, op: &str) {
    if let Ok(mut ops) = pending_ops().lock() {
        ops.insert(id.to_string(), op.to_string());
    }
}

fn clear_pending(id: &str) {
    if let Ok(mut ops) = pending_ops().lock() {
        ops.remove(id);
    }
}

fn pending_op(id: &str) -> Option<String> {
    pending_ops().lock().ok()?.get(id).cloned()
}

fn emit_action_complete(app: &AppHandle, id: &str, success: bool, message: String) {
    let _ = app.emit(
        "service:action-complete",
        ServiceActionEvent {
            id: id.to_string(),
            success,
            message,
        },
    );
}

fn run_start_and_wait(app: AppHandle, def: ServiceDefinition, op_label: String) {
    let id = def.id.clone();
    let name = def.name.clone();
    let restarting = op_label == "restarting";
    thread::spawn(move || {
        let (success, message) = match spawn_service(&def) {
            Ok(pid) => match wait_until_ready(&def, pid) {
                Ok(()) => (
                    true,
                    if restarting {
                        format!("{} 已重启并就绪", name)
                    } else {
                        format!("{} 已就绪", name)
                    },
                ),
                Err(e) => (false, e),
            },
            Err(e) => (false, e),
        };
        clear_pending(&id);
        emit_action_complete(&app, &id, success, message);
    });
}

fn run_stop_async(app: AppHandle, def: ServiceDefinition) {
    let id = def.id.clone();
    let name = def.name.clone();
    thread::spawn(move || {
        let result = stop_service_impl(&def, false);
        clear_pending(&id);
        emit_action_complete(&app, &id, result.success, result.message);
        let _ = name;
    });
}

fn run_restart_async(app: AppHandle, def: ServiceDefinition) {
    let id = def.id.clone();
    thread::spawn(move || {
        stop_service_impl(&def, false);
        thread::sleep(Duration::from_secs(1));
        let (success, message) = match spawn_service(&def) {
            Ok(pid) => match wait_until_ready(&def, pid) {
                Ok(()) => (true, format!("{} 已重启并就绪", def.name)),
                Err(e) => (false, e),
            },
            Err(e) => (false, e),
        };
        clear_pending(&id);
        emit_action_complete(&app, &id, success, message);
    });
}

// ── Path helpers ─────────────────────────────────────────────────────────────

fn user_data(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir unavailable")
        .join("userData")
}

fn config_path(app: &AppHandle) -> PathBuf {
    user_data(app).join("services.json")
}

fn expand_template(value: &str, project_dir: &Path) -> String {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    value
        .replace("{projectDir}", &project_dir.to_string_lossy())
        .replace('~', &home)
}

fn miloco_service_def(home: &Path) -> ServiceDefinition {
    let miloco_dir = home.join("workspace/github/xiaomi-miloco");
    let miloco_python = miloco_dir
        .join("backend/.venv/bin/python")
        .to_string_lossy()
        .into_owned();

    ServiceDefinition {
        id: "miloco".into(),
        name: "Xiaomi Miloco".into(),
        project_dir: miloco_dir.to_string_lossy().into_owned(),
        start: StartConfig {
            command: vec![
                miloco_python,
                "-m".into(),
                "miloco.main".into(),
            ],
            cwd: "{projectDir}/backend".into(),
            env: HashMap::new(),
            require_path: Some("{projectDir}/backend/.venv/bin/python".into()),
        },
        pre_start: None,
        pid_file: "{projectDir}/data/miloco.pid".into(),
        log_file: "{projectDir}/data/miloco.log".into(),
        ports: vec![1810],
        health: HealthConfig {
            url: "http://127.0.0.1:1810/health".into(),
            contains: Some("\"ok\"".into()),
            status_ok: true,
            fallback_urls: vec![],
            accept_http_codes: vec!["200".into()],
            timeout_secs: 60,
            poll_interval_secs: 2,
        },
        open_url: "http://localhost:1810".into(),
        stop: Some(StopConfig {
            grace_secs: 15,
            cleanup_ports: vec![1810],
        }),
    }
}

fn default_config(home: &Path) -> ServicesConfig {
    let personal = home.join("workspace/personal");
    let voxlab_dir = personal.join("VoxLab");
    let repomind_dir = personal.join("RepoMind");
    let voxlab_python = home
        .join("miniconda3/envs/voxlab/bin/python")
        .to_string_lossy()
        .into_owned();

    ServicesConfig {
        services: vec![
            ServiceDefinition {
                id: "voxlab".into(),
                name: "VoxLab".into(),
                project_dir: voxlab_dir.to_string_lossy().into_owned(),
                start: StartConfig {
                    command: vec![
                        voxlab_python,
                        "main.py".into(),
                    ],
                    cwd: "{projectDir}".into(),
                    env: HashMap::from([("DEV_MODE".into(), "false".into())]),
                    require_path: None,
                },
                pre_start: Some(PreStartConfig {
                    when: "frontendStale".into(),
                    command: vec!["npm".into(), "run".into(), "build".into()],
                    cwd: "{projectDir}/dashboard".into(),
                }),
                pid_file: "{projectDir}/data/voxlab.pid".into(),
                log_file: "{projectDir}/data/voxlab.log".into(),
                ports: vec![8001],
                health: HealthConfig {
                    url: "http://127.0.0.1:8001/health".into(),
                    contains: Some("\"ok\"".into()),
                    status_ok: false,
                    fallback_urls: vec![],
                    accept_http_codes: vec![],
                    timeout_secs: 120,
                    poll_interval_secs: 2,
                },
                open_url: "http://localhost:8001".into(),
                stop: Some(StopConfig {
                    grace_secs: 15,
                    cleanup_ports: vec![8001],
                }),
            },
            ServiceDefinition {
                id: "repomind".into(),
                name: "RepoMind".into(),
                project_dir: repomind_dir.to_string_lossy().into_owned(),
                start: StartConfig {
                    command: vec!["npm".into(), "run".into(), "dev".into()],
                    cwd: "{projectDir}".into(),
                    env: HashMap::new(),
                    require_path: None,
                },
                pre_start: None,
                pid_file: "{projectDir}/data/repomind.pid".into(),
                log_file: "{projectDir}/data/repomind.log".into(),
                ports: vec![3000, 3001],
                health: HealthConfig {
                    url: "http://localhost:3000/".into(),
                    contains: None,
                    status_ok: true,
                    fallback_urls: vec!["http://localhost:3001/".into()],
                    accept_http_codes: vec!["200".into(), "404".into()],
                    timeout_secs: 90,
                    poll_interval_secs: 2,
                },
                open_url: "http://localhost:3000".into(),
                stop: Some(StopConfig {
                    grace_secs: 15,
                    cleanup_ports: vec![3000, 3001],
                }),
            },
            miloco_service_def(home),
        ],
    }
}

fn load_config(app: &AppHandle) -> Result<ServicesConfig, String> {
    let path = config_path(app);
    if !path.exists() {
        let home = dirs::home_dir().ok_or("无法解析 HOME 目录")?;
        fs::create_dir_all(user_data(app)).map_err(|e| e.to_string())?;
        let config = default_config(&home);
        let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())?;
        return Ok(config);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut config: ServicesConfig =
        serde_json::from_str(&raw).map_err(|e| format!("services.json 解析失败: {}", e))?;
    if migrate_config(&mut config) {
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = fs::write(config_path(app), json);
        }
    }
    Ok(config)
}

/// Patch older configs in-memory.
fn migrate_config(config: &mut ServicesConfig) -> bool {
    let mut changed = false;
    for svc in &mut config.services {
        if svc.id == "repomind" {
            if svc.health.url.contains("127.0.0.1:3000") {
                svc.health.url = "http://localhost:3000/".into();
                changed = true;
            }
            if svc.health.fallback_urls.is_empty() {
                svc.health.fallback_urls = vec!["http://localhost:3001/".into()];
                changed = true;
            }
            if svc.health.accept_http_codes.is_empty() {
                svc.health.accept_http_codes = vec!["200".into(), "404".into()];
                changed = true;
            }
        }
    }
    if !config.services.iter().any(|s| s.id == "miloco") {
        if let Some(home) = dirs::home_dir() {
            config.services.push(miloco_service_def(&home));
            changed = true;
        }
    }
    changed
}

fn find_service<'a>(config: &'a ServicesConfig, id: &str) -> Result<&'a ServiceDefinition, String> {
    config
        .services
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("未知服务: {}", id))
}

// ── Process / port probes ────────────────────────────────────────────────────

fn pid_alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
struct ProcessRuntime {
    started_at: String,
    uptime_secs: u64,
}

/// Parse ps `etime` ([[dd-]hh:]mm:ss) into total seconds.
fn parse_etime(raw: &str) -> Option<u64> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let (days, rest) = if let Some((d, r)) = s.split_once('-') {
        (d.parse::<u64>().ok()?, r)
    } else {
        (0, s)
    };
    let parts: Vec<u64> = rest.split(':').filter_map(|p| p.parse().ok()).collect();
    let secs = match parts.as_slice() {
        [ss] => *ss,
        [mm, ss] => mm * 60 + ss,
        [hh, mm, ss] => hh * 3600 + mm * 60 + ss,
        _ => return None,
    };
    Some(days * 86400 + secs)
}

/// Read process start time and elapsed duration via ps (macOS/BSD).
fn process_runtime(pid: u32) -> Option<ProcessRuntime> {
    if !pid_alive(pid) {
        return None;
    }
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart=,etime="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return None;
    }
    let etime_raw = parts.last()?;
    let uptime_secs = parse_etime(etime_raw)?;
    let lstart = parts[..parts.len() - 1].join(" ");
    Some(ProcessRuntime {
        started_at: format_lstart(&lstart).unwrap_or(lstart),
        uptime_secs,
    })
}

/// Convert `ps -o lstart=` (`Tue Aug 18 11:27:48 2026`) to `YYYY-MM-DD HH:mm:ss`.
fn format_lstart(lstart: &str) -> Option<String> {
    let parts: Vec<&str> = lstart.split_whitespace().collect();
    if parts.len() != 5 {
        return None;
    }
    let month = month_from_abbr(parts[1])?;
    let day: u32 = parts[2].parse().ok()?;
    let time = parts[3];
    let year: u32 = parts[4].parse().ok()?;
    if time.split(':').count() != 3 {
        return None;
    }
    Some(format!("{:04}-{:02}-{:02} {}", year, month, day, time))
}

fn month_from_abbr(abbr: &str) -> Option<u32> {
    match abbr {
        "Jan" => Some(1),
        "Feb" => Some(2),
        "Mar" => Some(3),
        "Apr" => Some(4),
        "May" => Some(5),
        "Jun" => Some(6),
        "Jul" => Some(7),
        "Aug" => Some(8),
        "Sep" => Some(9),
        "Oct" => Some(10),
        "Nov" => Some(11),
        "Dec" => Some(12),
        _ => None,
    }
}

fn read_pid(pid_file: &Path) -> Option<u32> {
    let raw = fs::read_to_string(pid_file).ok()?;
    raw.trim().parse().ok()
}

fn port_listener_pids(port: u32) -> Vec<u32> {
    let output = Command::new("lsof")
        .args([
            "-ti",
            &format!(":{}", port),
            "-sTCP:LISTEN",
        ])
        .output();
    let Ok(output) = output else {
        return vec![];
    };
    if !output.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

fn collect_listening_ports() -> HashSet<u32> {
    let output = Command::new("lsof")
        .args(["-n", "-P", "-iTCP", "-sTCP:LISTEN"])
        .output();
    let Ok(output) = output else {
        return HashSet::new();
    };
    let mut ports = HashSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        let name_field = parts[8];
        if let Some(colon) = name_field.rfind(':') {
            if let Ok(port) = name_field[colon + 1..].parse::<u32>() {
                ports.insert(port);
            }
        }
    }
    ports
}

fn port_listening(port: u32, ctx: &ProbeContext) -> bool {
    ctx.listening_ports.contains(&port)
}

fn fetch_http_code(url: &str, timeout_secs: &str) -> Option<String> {
    let output = Command::new("curl")
        .args([
            "-s",
            "--max-time",
            timeout_secs,
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            url,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if code.is_empty() || code == "000" {
        return None;
    }
    Some(code)
}

fn url_localhost_variants(url: &str) -> Vec<String> {
    let mut urls = vec![url.to_string()];
    if url.contains("127.0.0.1") {
        urls.push(url.replace("127.0.0.1", "localhost"));
    }
    urls.sort();
    urls.dedup();
    urls
}

fn http_code_healthy(code: &str, health: &HealthConfig) -> bool {
    if !health.accept_http_codes.is_empty() {
        return health.accept_http_codes.iter().any(|c| c == code);
    }
    if health.status_ok {
        return code.starts_with('2');
    }
    code.starts_with('2')
}

fn check_health_url(url: &str, health: &HealthConfig, timeout_secs: &str) -> bool {
    if let Some(needle) = &health.contains {
        let body_output = Command::new("curl")
            .args(["-s", "--max-time", timeout_secs, url])
            .output();
        let Ok(body_output) = body_output else {
            return false;
        };
        if !body_output.status.success() {
            return false;
        }
        let body = String::from_utf8_lossy(&body_output.stdout);
        return body.contains(needle.as_str());
    }
    fetch_http_code(url, timeout_secs)
        .map(|code| http_code_healthy(&code, health))
        .unwrap_or(false)
}

/// Startup wait: longer timeout, try all fallback URLs.
fn check_health(health: &HealthConfig) -> bool {
    let timeout = health.timeout_secs.min(3).to_string();
    for u in std::iter::once(health.url.as_str()).chain(health.fallback_urls.iter().map(String::as_str))
    {
        for url in url_localhost_variants(u) {
            if check_health_url(&url, health, &timeout) {
                return true;
            }
        }
    }
    false
}

/// Status page: short timeout, primary + one fallback only.
fn check_health_probe(health: &HealthConfig, timeout_secs: &str) -> bool {
    for url in url_localhost_variants(&health.url) {
        if check_health_url(&url, health, timeout_secs) {
            return true;
        }
    }
    if let Some(fb) = health.fallback_urls.first() {
        for url in url_localhost_variants(fb) {
            if check_health_url(&url, health, timeout_secs) {
                return true;
            }
        }
    }
    false
}

fn is_frontend_stale(project_dir: &Path) -> bool {
    let out_index = project_dir.join("dashboard/out/index.html");
    if !out_index.exists() {
        return true;
    }
    let Ok(out_mtime) = fs::metadata(&out_index).and_then(|m| m.modified()) else {
        return true;
    };
    let pkg = project_dir.join("dashboard/package.json");
    if pkg.exists() {
        if let Ok(m) = fs::metadata(&pkg).and_then(|x| x.modified()) {
            if m > out_mtime {
                return true;
            }
        }
    }
    // Full src scan is only needed before start (preStart); status page uses mtime hint above.
    false
}

fn frontend_build_hint(project_dir: &Path) -> String {
    if !project_dir.join("dashboard/out/index.html").exists() {
        return "未构建".into();
    }
    if is_frontend_stale(project_dir) {
        "构建已过期".into()
    } else {
        "构建是最新的".into()
    }
}

fn is_frontend_stale_deep(project_dir: &Path) -> bool {
    if is_frontend_stale(project_dir) {
        return true;
    }
    let out_index = project_dir.join("dashboard/out/index.html");
    let out_str = out_index.to_string_lossy().into_owned();
    let src = project_dir.join("dashboard/src");
    let src_str = src.to_string_lossy().into_owned();
    if !src.exists() {
        return false;
    }
    Command::new("find")
        .args([&src_str, "-newer", &out_str, "-type", "f"])
        .output()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

fn run_pre_start(def: &ServiceDefinition) -> Result<(), String> {
    let Some(pre) = &def.pre_start else {
        return Ok(());
    };
    let project_dir = PathBuf::from(&def.project_dir);
    if pre.when == "frontendStale" && !is_frontend_stale_deep(&project_dir) {
        return Ok(());
    }
    let cwd = expand_template(&pre.cwd, &project_dir);
    let cmd_program = expand_template(&pre.command[0], &project_dir);
    let cmd_args: Vec<String> = pre.command[1..]
        .iter()
        .map(|arg| expand_template(arg, &project_dir))
        .collect();
    let mut cmd = Command::new(&cmd_program);
    cmd.args(&cmd_args).current_dir(&cwd);
    let output = cmd
        .output()
        .map_err(|e| format!("preStart 执行失败: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "preStart 失败 (exit {}): {}",
            output.status,
            stderr.trim()
        ));
    }
    Ok(())
}

fn probe_service(def: &ServiceDefinition, ctx: &ProbeContext) -> ServiceStatus {
    let project_dir = PathBuf::from(&def.project_dir);
    let pid_file = PathBuf::from(expand_template(&def.pid_file, &project_dir));
    let log_file = expand_template(&def.log_file, &project_dir);
    let mut extras = HashMap::new();

    if def.id == "voxlab" {
        extras.insert("frontend".into(), frontend_build_hint(&project_dir));
    }

    let pid_from_file = pid_file.exists().then(|| read_pid(&pid_file)).flatten();
    let all_ports_up = def.ports.iter().all(|p| port_listening(*p, ctx));
    let any_port_up = def.ports.iter().any(|p| port_listening(*p, ctx));
    let mut state = "stopped".to_string();
    let mut pid: Option<u32> = None;
    let mut managed_externally = false;

    if let Some(p) = pid_from_file {
        if pid_alive(p) {
            pid = Some(p);
            state = "running".to_string();
        } else if all_ports_up {
            state = "running".to_string();
            managed_externally = true;
            pid = def
                .ports
                .first()
                .and_then(|port| port_listener_pids(*port).first().copied());
        } else {
            state = "stale_pid".to_string();
        }
    } else if all_ports_up {
        state = "running".to_string();
        managed_externally = true;
        pid = def
            .ports
            .first()
            .and_then(|port| port_listener_pids(*port).first().copied());
    } else if any_port_up {
        state = "partial".to_string();
        pid = def
            .ports
            .iter()
            .find_map(|port| port_listener_pids(*port).first().copied());
    }

    if managed_externally {
        extras.insert("managedBy".into(), "external".into());
    }

    let ports: Vec<PortStatus> = def
        .ports
        .iter()
        .map(|p| PortStatus {
            port: *p,
            listening: port_listening(*p, ctx),
        })
        .collect();

    let health = if state == "running" || state == "partial" || any_port_up {
        if all_ports_up {
            if check_health_probe(&def.health, PROBE_HTTP_MAX_SECS) {
                "ok".into()
            } else {
                "ports_ok".into()
            }
        } else if check_health_probe(&def.health, PROBE_HTTP_MAX_SECS) {
            "ok".into()
        } else {
            "no_response".into()
        }
    } else {
        "unknown".into()
    };

    if (state == "running" || state == "partial") && health == "no_response" {
        state = "unhealthy".to_string();
    }

    if let Some(op) = pending_op(&def.id) {
        match op.as_str() {
            "starting" | "restarting" => {
                if state == "stopped" || state == "stale_pid" || state == "unhealthy" || state == "partial" {
                    state = "starting".to_string();
                }
            }
            "stopping" => {
                if state != "stopped" {
                    state = "stopping".to_string();
                }
            }
            _ => {}
        }
    }

    let runtime = pid.and_then(process_runtime);

    ServiceStatus {
        id: def.id.clone(),
        name: def.name.clone(),
        state,
        pid,
        ports,
        health,
        open_url: def.open_url.clone(),
        log_file,
        project_dir: def.project_dir.clone(),
        started_at: runtime.as_ref().map(|r| r.started_at.clone()),
        uptime_secs: runtime.map(|r| r.uptime_secs),
        last_error: None,
        extras: if extras.is_empty() { None } else { Some(extras) },
    }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

fn ensure_data_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn spawn_service(def: &ServiceDefinition) -> Result<u32, String> {
    let project_dir = PathBuf::from(&def.project_dir);
    if !project_dir.exists() {
        return Err(format!("项目目录不存在: {}", project_dir.display()));
    }

    if let Some(req) = &def.start.require_path {
        let req_path = PathBuf::from(expand_template(req, &project_dir));
        if !req_path.exists() {
            return Err(format!("依赖路径不存在: {}", req_path.display()));
        }
    }

    run_pre_start(def)?;

    let pid_file = PathBuf::from(expand_template(&def.pid_file, &project_dir));
    let log_file = PathBuf::from(expand_template(&def.log_file, &project_dir));
    ensure_data_dir(&pid_file)?;
    ensure_data_dir(&log_file)?;

    // Idempotent: already running
    if let Some(existing) = read_pid(&pid_file) {
        if pid_alive(existing) {
            return Ok(existing);
        }
        let _ = fs::remove_file(&pid_file);
    }

    // Port conflict guard (check primary port)
    if let Some(primary) = def.ports.first() {
        if port_listening(*primary, &ProbeContext {
            listening_ports: collect_listening_ports(),
        }) {
            return Err(format!(
                "端口 {} 已被占用，请先停止冲突进程",
                primary
            ));
        }
    }

    let cwd = expand_template(&def.start.cwd, &project_dir);
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| format!("无法打开日志文件: {}", e))?;

    let cmd_program = expand_template(&def.start.command[0], &project_dir);
    let cmd_args: Vec<String> = def.start.command[1..]
        .iter()
        .map(|arg| expand_template(arg, &project_dir))
        .collect();
    let mut cmd = Command::new(&cmd_program);
    cmd.args(&cmd_args)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log))
        .envs(&def.start.env);

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;
    let pid = child.id();
    fs::write(&pid_file, pid.to_string()).map_err(|e| e.to_string())?;

    Ok(pid)
}

fn wait_until_ready(def: &ServiceDefinition, pid: u32) -> Result<(), String> {
    let project_dir = PathBuf::from(&def.project_dir);
    let log_file = PathBuf::from(expand_template(&def.log_file, &project_dir));
    let timeout = def.health.timeout_secs;
    let interval = def.health.poll_interval_secs;
    let max_attempts = timeout.div_ceil(interval.max(1));

    for _ in 0..max_attempts {
        if !pid_alive(pid) {
            let tail = tail_log_file(&log_file, 20);
            return Err(format!("进程已退出。最近日志:\n{}", tail));
        }

        let ctx = ProbeContext {
            listening_ports: collect_listening_ports(),
        };
        let ports_ready = def.ports.iter().all(|p| port_listening(*p, &ctx));
        let health_ok = check_health(&def.health);

        if def.id == "repomind" {
            if ports_ready {
                return Ok(());
            }
        } else if health_ok {
            return Ok(());
        }

        thread::sleep(Duration::from_secs(interval));
    }

    Err(format!(
        "超时未就绪（{}s），请查看日志: {}",
        timeout,
        log_file.display()
    ))
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' || c == '\u{009b}' {
            while let Some(&next) = chars.peek() {
                if next.is_ascii_alphabetic() {
                    chars.next();
                    break;
                }
                chars.next();
            }
            continue;
        }
        out.push(c);
    }
    strip_orphan_sgr(&out)
}

fn strip_orphan_sgr(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let start = i;
            i += 1;
            let mut has_digit = false;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b';') {
                has_digit = true;
                i += 1;
            }
            if has_digit && i < bytes.len() && bytes[i] == b'm' {
                i += 1;
                continue;
            }
            result.push('[');
            i = start + 1;
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }
    result
}

fn normalize_carriage_returns(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch == '\r' {
            current.clear();
        } else if ch == '\n' {
            lines.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines.join("\n")
}

fn normalize_log_text(raw: &str) -> String {
    normalize_carriage_returns(&strip_ansi(raw))
}

fn read_tail_bytes(path: &Path, max_bytes: usize) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len() as usize;
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start as u64))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn tail_log_file(path: &Path, lines: usize) -> String {
    if !path.exists() {
        return "(日志文件不存在)".into();
    }
    let raw = match read_tail_bytes(path, 128 * 1024) {
        Ok(s) => s,
        Err(_) => {
            return fs::read_to_string(path).unwrap_or_else(|_| "(无法读取日志)".into());
        }
    };
    let normalized = normalize_log_text(&raw);
    normalized
        .lines()
        .rev()
        .take(lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn stop_service_impl(def: &ServiceDefinition, force: bool) -> ServiceActionResult {
    let project_dir = PathBuf::from(&def.project_dir);
    let pid_file = PathBuf::from(expand_template(&def.pid_file, &project_dir));
    let stop_cfg = def.stop.clone().unwrap_or(StopConfig {
        grace_secs: 15,
        cleanup_ports: def.ports.clone(),
    });

    let mut pids: Vec<u32> = Vec::new();
    if let Some(p) = read_pid(&pid_file) {
        if pid_alive(p) {
            pids.push(p);
        }
    }
    for port in &stop_cfg.cleanup_ports {
        for p in port_listener_pids(*port) {
            if !pids.contains(&p) {
                pids.push(p);
            }
        }
    }

    if pids.is_empty() {
        let _ = fs::remove_file(&pid_file);
        return ServiceActionResult {
            success: true,
            message: format!("{} 未在运行", def.name),
        };
    }

    if force {
        for pid in &pids {
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();
        }
    } else {
        for pid in &pids {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
        }
        for _ in 0..stop_cfg.grace_secs {
            if pids.iter().all(|p| !pid_alive(*p)) {
                break;
            }
            thread::sleep(Duration::from_secs(1));
        }
        for pid in &pids {
            if pid_alive(*pid) {
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
    }

    let _ = fs::remove_file(&pid_file);

    // Port cleanup for child processes (e.g. npm concurrently)
    for port in &stop_cfg.cleanup_ports {
        for pid in port_listener_pids(*port) {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .output();
            thread::sleep(Duration::from_secs(1));
            if pid_alive(pid) {
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
    }

    ServiceActionResult {
        success: true,
        message: format!("{} 已停止", def.name),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionResult {
    pub success: bool,
    pub message: String,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn service_list(app: AppHandle) -> Result<Vec<ServiceMeta>, String> {
    let config = load_config(&app)?;
    Ok(config
        .services
        .iter()
        .map(|s| ServiceMeta {
            id: s.id.clone(),
            name: s.name.clone(),
            ports: s.ports.clone(),
            open_url: s.open_url.clone(),
            project_dir: s.project_dir.clone(),
        })
        .collect())
}

#[tauri::command]
pub fn service_status(app: AppHandle, id: Option<String>) -> Result<Vec<ServiceStatus>, String> {
    let config = load_config(&app)?;
    let ctx = ProbeContext {
        listening_ports: collect_listening_ports(),
    };
    if let Some(sid) = id {
        let def = find_service(&config, &sid)?;
        return Ok(vec![probe_service(def, &ctx)]);
    }
    Ok(config
        .services
        .iter()
        .map(|s| probe_service(s, &ctx))
        .collect())
}

#[tauri::command]
pub fn service_start(app: AppHandle, id: String) -> Result<ServiceActionResult, String> {
    let config = load_config(&app)?;
    let def = find_service(&config, &id)?.clone();
    if let Some(op) = pending_op(&id) {
        return Ok(ServiceActionResult {
            success: false,
            message: format!("{} 正在{}，请稍候", def.name, pending_op_label(&op)),
        });
    }
    set_pending(&id, "starting");
    run_start_and_wait(app, def.clone(), "starting".into());
    Ok(ServiceActionResult {
        success: true,
        message: format!("{} 正在启动，请稍候…", def.name),
    })
}

#[tauri::command]
pub fn service_stop(app: AppHandle, id: String, force: Option<bool>) -> Result<ServiceActionResult, String> {
    let config = load_config(&app)?;
    let def = find_service(&config, &id)?.clone();
    if let Some(op) = pending_op(&id) {
        return Ok(ServiceActionResult {
            success: false,
            message: format!("{} 正在{}，请稍候", def.name, pending_op_label(&op)),
        });
    }
    if force.unwrap_or(false) {
        let result = stop_service_impl(&def, true);
        return Ok(result);
    }
    set_pending(&id, "stopping");
    run_stop_async(app, def.clone());
    Ok(ServiceActionResult {
        success: true,
        message: format!("{} 正在停止…", def.name),
    })
}

#[tauri::command]
pub fn service_restart(app: AppHandle, id: String) -> Result<ServiceActionResult, String> {
    let config = load_config(&app)?;
    let def = find_service(&config, &id)?.clone();
    if let Some(op) = pending_op(&id) {
        return Ok(ServiceActionResult {
            success: false,
            message: format!("{} 正在{}，请稍候", def.name, pending_op_label(&op)),
        });
    }
    set_pending(&id, "restarting");
    run_restart_async(app, def.clone());
    Ok(ServiceActionResult {
        success: true,
        message: format!("{} 正在重启，请稍候…", def.name),
    })
}

fn pending_op_label(op: &str) -> &'static str {
    match op {
        "starting" => "启动",
        "stopping" => "停止",
        "restarting" => "重启",
        _ => "处理",
    }
}

#[tauri::command]
pub fn service_open(app: AppHandle, id: String) -> Result<(), String> {
    let config = load_config(&app)?;
    let def = find_service(&config, &id)?;
    let ctx = ProbeContext {
        listening_ports: collect_listening_ports(),
    };
    let status = probe_service(def, &ctx);
    let can_open = matches!(status.state.as_str(), "running" | "partial")
        && matches!(status.health.as_str(), "ok" | "ports_ok")
        || status.ports.iter().any(|p| p.listening);
    if !can_open {
        return Err(format!("{} 未运行，请先启动", def.name));
    }
    open::that(&def.open_url).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledIdes {
    pub cursor: bool,
    pub antigravity: bool,
}

fn path_exists(p: &str) -> bool {
    Path::new(p).exists()
}

fn spawn_detached(bin: &str, args: &[&str]) -> Result<(), String> {
    Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("启动失败: {}", e))
}

fn cursor_bins() -> &'static [&'static str] {
    &[
        "/usr/local/bin/cursor",
        "/opt/homebrew/bin/cursor",
        "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        "/Applications/Cursor.app/Contents/Resources/app/bin/code",
    ]
}

fn antigravity_bins() -> &'static [&'static str] {
    &[
        "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
        "/usr/local/bin/antigravity-ide",
        "/opt/homebrew/bin/antigravity-ide",
        "/usr/local/bin/antigravity",
        "/opt/homebrew/bin/antigravity",
    ]
}

fn cursor_installed() -> bool {
    path_exists("/Applications/Cursor.app") || cursor_bins().iter().any(|p| path_exists(p))
}

fn antigravity_installed() -> bool {
    path_exists("/Applications/Antigravity IDE.app")
        || path_exists("/Applications/Antigravity.app")
        || antigravity_bins().iter().any(|p| path_exists(p))
}

fn open_with_bins(bins: &[&str], path: &str, app_names: &[&str]) -> Result<(), String> {
    for bin in bins {
        if path_exists(bin) && spawn_detached(bin, &[path]).is_ok() {
            return Ok(());
        }
    }
    for app in app_names {
        if spawn_detached("open", &["-a", app, path]).is_ok() {
            return Ok(());
        }
    }
    Err("未找到可用的 IDE".into())
}

#[tauri::command]
pub fn service_detect_ides() -> InstalledIdes {
    InstalledIdes {
        cursor: cursor_installed(),
        antigravity: antigravity_installed(),
    }
}

#[tauri::command]
pub fn service_open_in_ide(path: String, ide: String) -> Result<(), String> {
    if path.contains("..") || !Path::new(&path).is_absolute() {
        return Err("非法项目路径".into());
    }
    if !Path::new(&path).exists() {
        return Err(format!("路径不存在: {}", path));
    }
    match ide.as_str() {
        "cursor" => open_with_bins(cursor_bins(), &path, &["Cursor"]),
        "antigravity" => open_with_bins(
            antigravity_bins(),
            &path,
            &["Antigravity IDE", "Antigravity"],
        ),
        _ => Err(format!("暂不支持的 IDE: {}", ide)),
    }
}

#[tauri::command]
pub fn service_tail_log(app: AppHandle, id: String, lines: Option<u32>) -> Result<String, String> {
    let config = load_config(&app)?;
    let def = find_service(&config, &id)?;
    let project_dir = PathBuf::from(&def.project_dir);
    let log_file = PathBuf::from(expand_template(&def.log_file, &project_dir));
    let n = lines.unwrap_or(30) as usize;
    Ok(tail_log_file(&log_file, n))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_template_replaces_project_dir() {
        let project = PathBuf::from("/tmp/voxlab");
        let out = expand_template("{projectDir}/data/x.pid", &project);
        assert_eq!(out, "/tmp/voxlab/data/x.pid");
    }

    #[test]
    fn normalize_carriage_returns_collapses_tqdm() {
        let raw = "INFO start\n\rGenerating: 0%|\rGenerating: 50%|====\rGenerating: 100%|====|\nDONE\n";
        let out = normalize_log_text(raw);
        assert!(out.contains("INFO start"));
        assert!(out.contains("Generating: 100%|====|"));
        assert!(!out.contains("Generating: 0%"));
        assert!(out.contains("DONE"));
    }

    #[test]
    fn parse_ps_lstart_etime_line() {
        let line = "Tue Aug 18 11:27:48 2026 10:28";
        let parts: Vec<&str> = line.split_whitespace().collect();
        assert_eq!(parts.len(), 6);
        assert_eq!(parse_etime(parts.last().unwrap()).unwrap(), 10 * 60 + 28);
        assert_eq!(
            format_lstart(&parts[..parts.len() - 1].join(" ")).unwrap(),
            "2026-08-18 11:27:48"
        );
    }

    #[test]
    fn format_lstart_december() {
        assert_eq!(
            format_lstart("Wed Dec  3 12:33:12 2005").unwrap(),
            "2005-12-03 12:33:12"
        );
    }

    #[test]
    fn parse_etime_formats() {
        assert_eq!(parse_etime("45").unwrap(), 45);
        assert_eq!(parse_etime("10:28").unwrap(), 628);
        assert_eq!(parse_etime("1:23:45").unwrap(), 5025);
        assert_eq!(parse_etime("2-03:04:05").unwrap(), 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
    }

    #[test]
    fn strip_orphan_sgr_codes() {
        let raw = "[94mVoice:[0m hello";
        assert_eq!(strip_ansi(raw), "Voice: hello");
    }

    #[test]
    fn default_config_contains_miloco() {
        let home = PathBuf::from("/Users/test");
        let cfg = default_config(&home);
        assert!(cfg.services.iter().any(|s| s.id == "miloco" && s.ports == vec![1810]));
    }
}
