//! CDN / Image bed — Aliyun OSS upload + PicList-compatible helpers.
//!
//! Secrets (AccessKeySecret) live in macOS Keychain.
//! Non-secret config: userData/cdn_config.json

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

type HmacSha1 = Hmac<Sha1>;

const CONFIG_FILENAME: &str = "cdn_config.json";
const KEYCHAIN_SERVICE: &str = "com.xiyangxie.eva.cdn";
const KEYCHAIN_ACCOUNT_ALIYUN_SECRET: &str = "aliyun-access-key-secret";
const KEYCHAIN_ACCOUNT_R2_SECRET: &str = "r2-secret-access-key";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunOssConfig {
    #[serde(default)]
    pub access_key_id: String,
    /// Never persisted here; only accepted on save from UI.
    #[serde(default, skip_serializing)]
    pub access_key_secret: String,
    #[serde(default)]
    pub bucket: String,
    /// e.g. oss-cn-beijing
    #[serde(default = "default_area")]
    pub area: String,
    /// Prefix without trailing slash, e.g. "img" → keys img/YYYYMM/...
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
    #[serde(default)]
    pub custom_url: String,
}

fn default_area() -> String {
    "oss-cn-beijing".into()
}
fn default_path_prefix() -> String {
    "img".into()
}

impl Default for AliyunOssConfig {
    fn default() -> Self {
        Self {
            access_key_id: String::new(),
            access_key_secret: String::new(),
            bucket: String::new(),
            area: default_area(),
            path_prefix: default_path_prefix(),
            custom_url: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct R2Config {
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub access_key_id: String,
    #[serde(default, skip_serializing)]
    pub secret_access_key: String,
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub public_base_url: String,
    #[serde(default = "default_path_prefix")]
    pub path_prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdnConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// aliyun | r2 (r2 is stub for Phase B)
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub aliyun: AliyunOssConfig,
    #[serde(default)]
    pub r2: R2Config,
    /// Also listen on PicList's classic port for zero Obsidian config change.
    #[serde(default = "default_true")]
    pub piclist_compat_enabled: bool,
    #[serde(default = "default_piclist_port")]
    pub piclist_compat_port: u16,
}

fn default_true() -> bool {
    true
}
fn default_provider() -> String {
    "aliyun".into()
}
fn default_piclist_port() -> u16 {
    36677
}

impl Default for CdnConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: default_provider(),
            aliyun: AliyunOssConfig::default(),
            r2: R2Config::default(),
            piclist_compat_enabled: true,
            piclist_compat_port: default_piclist_port(),
        }
    }
}

/// Safe view for UI — secrets never leave backend as plaintext.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdnConfigView {
    pub enabled: bool,
    pub provider: String,
    pub aliyun: AliyunOssView,
    pub r2: R2ConfigView,
    pub piclist_compat_enabled: bool,
    pub piclist_compat_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunOssView {
    pub access_key_id: String,
    pub access_key_secret_set: bool,
    pub access_key_secret_masked: String,
    pub bucket: String,
    pub area: String,
    pub path_prefix: String,
    pub custom_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct R2ConfigView {
    pub account_id: String,
    pub access_key_id: String,
    pub secret_access_key_set: bool,
    pub bucket: String,
    pub public_base_url: String,
    pub path_prefix: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdnConfigSaveRequest {
    pub enabled: Option<bool>,
    pub provider: Option<String>,
    pub aliyun: Option<AliyunOssSave>,
    pub r2: Option<R2Save>,
    pub piclist_compat_enabled: Option<bool>,
    pub piclist_compat_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliyunOssSave {
    pub access_key_id: Option<String>,
    /// Empty / omitted / "***" → keep existing secret
    pub access_key_secret: Option<String>,
    pub bucket: Option<String>,
    pub area: Option<String>,
    pub path_prefix: Option<String>,
    pub custom_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct R2Save {
    pub account_id: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub bucket: Option<String>,
    pub public_base_url: Option<String>,
    pub path_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    pub success: bool,
    pub url: Option<String>,
    pub key: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CdnTestResult {
    pub success: bool,
    pub message: String,
    pub sample_endpoint: Option<String>,
}

pub struct CdnState {
    pub user_data_dir: PathBuf,
    pub config_path: PathBuf,
}

pub type SharedCdnState = Arc<Mutex<CdnState>>;

// ──────────────────────────────────────────────────
// Keychain helpers (same pattern as vault.rs)
// ──────────────────────────────────────────────────

fn keychain_get(service: &str, account: &str) -> Option<String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", service, "-a", account, "-w"])
        .output()
        .ok()?;
    if output.status.success() {
        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    } else {
        None
    }
}

fn keychain_set(service: &str, account: &str, value: &str) -> bool {
    Command::new("security")
        .args([
            "add-generic-password",
            "-s",
            service,
            "-a",
            account,
            "-w",
            value,
            "-U",
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}


fn mask_secret(secret: &str) -> String {
    let len = secret.chars().count();
    if len == 0 {
        return String::new();
    }
    if len <= 4 {
        return "*".repeat(len);
    }
    let tail: String = secret.chars().rev().take(4).collect::<String>().chars().rev().collect();
    format!("{}{}", "*".repeat(len.saturating_sub(4)), tail)
}

fn is_placeholder_secret(s: &str) -> bool {
    let t = s.trim();
    t.is_empty() || t.chars().all(|c| c == '*') || t == "(unchanged)"
}

// ──────────────────────────────────────────────────
// Config IO
// ──────────────────────────────────────────────────


pub fn config_path(user_data: &Path) -> PathBuf {
    user_data.join(CONFIG_FILENAME)
}

pub fn load_config(user_data: &Path) -> CdnConfig {
    let path = config_path(user_data);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<CdnConfig>(&content) {
                return cfg;
            }
        }
    }
    CdnConfig::default()
}

fn save_config_file(user_data: &Path, cfg: &CdnConfig) -> Result<(), String> {
    let path = config_path(user_data);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Serialize without secrets (skip_serializing on secret fields)
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn aliyun_secret(user_data: &Path) -> Option<String> {
    keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ALIYUN_SECRET).or_else(|| {
        // Dev fallback: optional local file (gitignored path) — never commit
        let p = user_data.join(".cdn_aliyun_secret");
        fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    })
}

fn r2_secret(_user_data: &Path) -> Option<String> {
    keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_R2_SECRET)
}

pub fn to_view(user_data: &Path, cfg: &CdnConfig) -> CdnConfigView {
    let ak_secret = aliyun_secret(user_data).unwrap_or_default();
    let r2_secret_v = r2_secret(user_data).unwrap_or_default();
    CdnConfigView {
        enabled: cfg.enabled,
        provider: cfg.provider.clone(),
        aliyun: AliyunOssView {
            access_key_id: cfg.aliyun.access_key_id.clone(),
            access_key_secret_set: !ak_secret.is_empty(),
            access_key_secret_masked: mask_secret(&ak_secret),
            bucket: cfg.aliyun.bucket.clone(),
            area: cfg.aliyun.area.clone(),
            path_prefix: cfg.aliyun.path_prefix.clone(),
            custom_url: cfg.aliyun.custom_url.clone(),
        },
        r2: R2ConfigView {
            account_id: cfg.r2.account_id.clone(),
            access_key_id: cfg.r2.access_key_id.clone(),
            secret_access_key_set: !r2_secret_v.is_empty(),
            bucket: cfg.r2.bucket.clone(),
            public_base_url: cfg.r2.public_base_url.clone(),
            path_prefix: cfg.r2.path_prefix.clone(),
        },
        piclist_compat_enabled: cfg.piclist_compat_enabled,
        piclist_compat_port: cfg.piclist_compat_port,
    }
}

pub fn apply_save(user_data: &Path, req: CdnConfigSaveRequest) -> Result<CdnConfigView, String> {
    let mut cfg = load_config(user_data);

    if let Some(v) = req.enabled {
        cfg.enabled = v;
    }
    if let Some(v) = req.provider {
        cfg.provider = v;
    }
    if let Some(v) = req.piclist_compat_enabled {
        cfg.piclist_compat_enabled = v;
    }
    if let Some(v) = req.piclist_compat_port {
        cfg.piclist_compat_port = v;
    }

    if let Some(a) = req.aliyun {
        if let Some(v) = a.access_key_id {
            cfg.aliyun.access_key_id = v;
        }
        if let Some(v) = a.bucket {
            cfg.aliyun.bucket = v;
        }
        if let Some(v) = a.area {
            cfg.aliyun.area = v;
        }
        if let Some(v) = a.path_prefix {
            cfg.aliyun.path_prefix = v.trim_matches('/').to_string();
        }
        if let Some(v) = a.custom_url {
            cfg.aliyun.custom_url = v.trim_end_matches('/').to_string();
        }
        if let Some(secret) = a.access_key_secret {
            if !is_placeholder_secret(&secret) {
                if !keychain_set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_ALIYUN_SECRET, secret.trim()) {
                    // Fallback file if keychain blocked (still outside git)
                    let p = user_data.join(".cdn_aliyun_secret");
                    fs::write(&p, secret.trim()).map_err(|e| e.to_string())?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
                    }
                }
            }
        }
    }

    if let Some(r) = req.r2 {
        if let Some(v) = r.account_id {
            cfg.r2.account_id = v;
        }
        if let Some(v) = r.access_key_id {
            cfg.r2.access_key_id = v;
        }
        if let Some(v) = r.bucket {
            cfg.r2.bucket = v;
        }
        if let Some(v) = r.public_base_url {
            cfg.r2.public_base_url = v.trim_end_matches('/').to_string();
        }
        if let Some(v) = r.path_prefix {
            cfg.r2.path_prefix = v.trim_matches('/').to_string();
        }
        if let Some(secret) = r.secret_access_key {
            if !is_placeholder_secret(&secret) {
                let _ = keychain_set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_R2_SECRET, secret.trim());
            }
        }
    }

    save_config_file(user_data, &cfg)?;
    Ok(to_view(user_data, &cfg))
}

// ──────────────────────────────────────────────────
// Object key & MIME
// ──────────────────────────────────────────────────

fn now_ym() -> (String, String) {
    // YYYYMM and compact timestamp without chrono
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Approximate civil date via days — good enough for path prefix
    // Use local offset +8 for Asia/Shanghai path naming consistency with PicList
    let local = secs + 8 * 3600;
    let days = (local / 86400) as i64;
    let tod = (local % 86400) as u32;
    let (y, m, d) = civil_from_days(days);
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis();
    let ym = format!("{:04}{:02}", y, m);
    let stamp = format!(
        "{:04}{:02}{:02}{:02}{:02}{:02}{:03}",
        y, m, d, hh, mm, ss, millis
    );
    (ym, stamp)
}

/// Howard Hinnant civil_from_days (proleptic Gregorian)
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

pub fn build_object_key(path_prefix: &str, filename: &str) -> String {
    let (ym, stamp) = now_ym();
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let rand4 = &Uuid::new_v4().to_string().replace('-', "")[..4];
    let prefix = path_prefix.trim().trim_matches('/');
    if prefix.is_empty() {
        format!("{}/{}_{}.{}", ym, stamp, rand4, ext)
    } else {
        format!("{}/{}/{}_{}.{}", prefix, ym, stamp, rand4, ext)
    }
}

pub fn guess_mime(filename: &str) -> &'static str {
    let f = filename.to_lowercase();
    if f.ends_with(".png") {
        "image/png"
    } else if f.ends_with(".jpg") || f.ends_with(".jpeg") {
        "image/jpeg"
    } else if f.ends_with(".gif") {
        "image/gif"
    } else if f.ends_with(".webp") {
        "image/webp"
    } else if f.ends_with(".svg") {
        "image/svg+xml"
    } else if f.ends_with(".mp4") {
        "video/mp4"
    } else if f.ends_with(".mov") {
        "video/quicktime"
    } else if f.ends_with(".webm") {
        "video/webm"
    } else if f.ends_with(".mp3") {
        "audio/mpeg"
    } else if f.ends_with(".wav") {
        "audio/wav"
    } else if f.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

// ──────────────────────────────────────────────────
// Aliyun OSS V1 signature PUT
// ──────────────────────────────────────────────────

fn oss_sign(
    secret: &str,
    method: &str,
    content_md5: &str,
    content_type: &str,
    date: &str,
    canonical_resource: &str,
) -> String {
    let string_to_sign = format!(
        "{}\n{}\n{}\n{}\n{}",
        method, content_md5, content_type, date, canonical_resource
    );
    let mut mac = HmacSha1::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(string_to_sign.as_bytes());
    B64.encode(mac.finalize().into_bytes())
}

fn oss_endpoint(bucket: &str, area: &str) -> String {
    format!("https://{}.{}.aliyuncs.com", bucket, area)
}

fn oss_public_url(cfg: &AliyunOssConfig, key: &str) -> String {
    if !cfg.custom_url.is_empty() {
        format!("{}/{}", cfg.custom_url.trim_end_matches('/'), key)
    } else {
        format!("{}/{}", oss_endpoint(&cfg.bucket, &cfg.area), key)
    }
}

pub fn upload_bytes_aliyun(
    cfg: &AliyunOssConfig,
    secret: &str,
    data: &[u8],
    filename: &str,
) -> Result<(String, String), String> {
    if cfg.access_key_id.trim().is_empty() || secret.trim().is_empty() {
        return Err("阿里云 OSS 凭证未配置".into());
    }
    if cfg.bucket.trim().is_empty() || cfg.area.trim().is_empty() {
        return Err("请填写 bucket 与 region (area)".into());
    }

    let key = build_object_key(&cfg.path_prefix, filename);
    let content_type = guess_mime(filename);
    let date = httpdate::fmt_http_date(SystemTime::now());
    let canonical_resource = format!("/{}/{}", cfg.bucket, key);
    let signature = oss_sign(secret, "PUT", "", content_type, &date, &canonical_resource);
    let auth = format!("OSS {}:{}", cfg.access_key_id.trim(), signature);
    let url = format!("{}/{}", oss_endpoint(&cfg.bucket, &cfg.area), key);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .put(&url)
        .header("Date", &date)
        .header("Content-Type", content_type)
        .header("Authorization", auth)
        .header("Content-Length", data.len())
        .body(data.to_vec())
        .send()
        .map_err(|e| format!("OSS 上传请求失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_default();
        return Err(format!("OSS 上传失败 HTTP {}: {}", status.as_u16(), body));
    }

    Ok((oss_public_url(cfg, &key), key))
}

/// Parse OSS object key from a public CDN / custom-domain URL.
pub fn object_key_from_url(cfg: &AliyunOssConfig, url: &str) -> Result<String, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("空的 CDN URL".into());
    }

    if !cfg.custom_url.is_empty() {
        let base = cfg.custom_url.trim_end_matches('/');
        if let Some(rest) = url.strip_prefix(base) {
            let key = rest.trim_start_matches('/');
            if !key.is_empty() && !key.contains("..") {
                return Ok(key.to_string());
            }
        }
    }

    for scheme in ["https", "http"] {
        let prefix = format!(
            "{}://{}.{}.aliyuncs.com/",
            scheme,
            cfg.bucket.trim(),
            cfg.area.trim()
        );
        if let Some(key) = url.strip_prefix(&prefix) {
            let key = key.split('?').next().unwrap_or(key);
            if !key.is_empty() && !key.contains("..") {
                return Ok(key.to_string());
            }
        }
    }

    // Fallback: path after host
    if let Some(idx) = url.find("://") {
        let after = &url[idx + 3..];
        if let Some(slash) = after.find('/') {
            let key = after[slash + 1..].split('?').next().unwrap_or("");
            if !key.is_empty() && !key.contains("..") {
                return Ok(key.to_string());
            }
        }
    }
    Err(format!("无法从 URL 解析对象键: {}", url))
}

/// Delete an object from Aliyun OSS (V1 signature). Treats 404/NoSuchKey as success.
pub fn delete_object_aliyun(
    cfg: &AliyunOssConfig,
    secret: &str,
    key: &str,
) -> Result<(), String> {
    if cfg.access_key_id.trim().is_empty() || secret.trim().is_empty() {
        return Err("阿里云 OSS 凭证未配置".into());
    }
    if cfg.bucket.trim().is_empty() || cfg.area.trim().is_empty() {
        return Err("请填写 bucket 与 region (area)".into());
    }
    let key = key.trim().trim_start_matches('/');
    if key.is_empty() {
        return Err("对象键为空".into());
    }

    let date = httpdate::fmt_http_date(SystemTime::now());
    let canonical_resource = format!("/{}/{}", cfg.bucket, key);
    let signature = oss_sign(secret, "DELETE", "", "", &date, &canonical_resource);
    let auth = format!("OSS {}:{}", cfg.access_key_id.trim(), signature);
    let url = format!("{}/{}", oss_endpoint(&cfg.bucket, &cfg.area), key);

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .delete(&url)
        .header("Date", &date)
        .header("Authorization", auth)
        .send()
        .map_err(|e| format!("OSS 删除请求失败: {}", e))?;

    let status = resp.status();
    if status.is_success() || status.as_u16() == 204 || status.as_u16() == 404 {
        return Ok(());
    }
    let body = resp.text().unwrap_or_default();
    // Idempotent: object already gone
    if body.contains("NoSuchKey") {
        return Ok(());
    }
    if body.contains("AccessDenied") || body.contains("oss:DeleteObject") {
        return Err(format!(
            "OSS 拒绝删除（当前 AccessKey 缺少 oss:DeleteObject 权限）。HTTP {}: {}",
            status.as_u16(),
            body.chars().take(280).collect::<String>()
        ));
    }
    Err(format!(
        "OSS 删除失败 HTTP {}: {}",
        status.as_u16(),
        body.chars().take(280).collect::<String>()
    ))
}

/// Delete the OSS object referenced by a public CDN URL using current config.
pub fn delete_public_url(user_data: &Path, cdn_url: &str) -> Result<(), String> {
    let cfg = load_config(user_data);
    if cfg.provider != "aliyun" {
        return Err(format!(
            "Provider '{}' 尚未实现云端删除（仅阿里云 OSS）",
            cfg.provider
        ));
    }
    let secret =
        aliyun_secret(user_data).ok_or_else(|| "未找到 AccessKeySecret（请在设置中保存）".to_string())?;
    let key = object_key_from_url(&cfg.aliyun, cdn_url)?;
    log::info!("[CDN] DeleteObject key={}", key);
    delete_object_aliyun(&cfg.aliyun, &secret, &key)
}

pub fn upload_path(user_data: &Path, local_path: &Path) -> Result<(String, String, String), String> {
    let cfg = load_config(user_data);
    if !cfg.enabled {
        return Err("图床未启用".into());
    }
    if cfg.provider != "aliyun" {
        return Err(format!(
            "Provider '{}' 尚未实现上传（Phase B 仅阿里云 OSS）",
            cfg.provider
        ));
    }
    let secret = aliyun_secret(user_data).ok_or_else(|| "未找到 AccessKeySecret（请在设置中保存）".to_string())?;
    let mut file = fs::File::open(local_path).map_err(|e| format!("无法读取文件: {}", e))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let filename = local_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("upload.bin")
        .to_string();
    let (url, key) = upload_bytes_aliyun(&cfg.aliyun, &secret, &data, &filename)?;
    Ok((url, key, filename))
}

pub fn upload_bytes(
    user_data: &Path,
    data: &[u8],
    filename: &str,
) -> Result<(String, String), String> {
    let cfg = load_config(user_data);
    if !cfg.enabled {
        return Err("图床未启用".into());
    }
    if cfg.provider != "aliyun" {
        return Err(format!(
            "Provider '{}' 尚未实现上传（Phase B 仅阿里云 OSS）",
            cfg.provider
        ));
    }
    let secret = aliyun_secret(user_data).ok_or_else(|| "未找到 AccessKeySecret（请在设置中保存）".to_string())?;
    upload_bytes_aliyun(&cfg.aliyun, &secret, data, filename)
}

pub fn test_connection(user_data: &Path) -> CdnTestResult {
    let cfg = load_config(user_data);
    if cfg.provider != "aliyun" {
        return CdnTestResult {
            success: false,
            message: "R2 上传尚未实现，请先使用阿里云 OSS".into(),
            sample_endpoint: None,
        };
    }
    if aliyun_secret(user_data).is_none() {
        return CdnTestResult {
            success: false,
            message: "AccessKeySecret 未配置".into(),
            sample_endpoint: None,
        };
    }
    if cfg.aliyun.access_key_id.is_empty() || cfg.aliyun.bucket.is_empty() {
        return CdnTestResult {
            success: false,
            message: "请填写 AccessKeyId 与 Bucket".into(),
            sample_endpoint: None,
        };
    }

    let endpoint = oss_endpoint(&cfg.aliyun.bucket, &cfg.aliyun.area);
    // Probe with a real PutObject (many keys lack ListObjects permission)
    let probe = b"eva-cdn-probe";
    match upload_bytes_aliyun(&cfg.aliyun, &aliyun_secret(user_data).unwrap(), probe, "eva-cdn-probe.txt") {
        Ok((url, key)) => CdnTestResult {
            success: true,
            message: format!(
                "连接成功（PutObject OK），bucket={} region={} key={}",
                cfg.aliyun.bucket, cfg.aliyun.area, key
            ),
            sample_endpoint: Some(url),
        },
        Err(e) => CdnTestResult {
            success: false,
            message: e,
            sample_endpoint: Some(endpoint),
        },
    }
}

/// Import non-secret + secret fields from PicList data.json (never logs secrets).
pub fn import_from_piclist(user_data: &Path) -> Result<CdnConfigView, String> {
    let piclist = dirs::home_dir()
        .ok_or_else(|| "无法定位 Home".to_string())?
        .join("Library/Application Support/piclist/data.json");
    if !piclist.exists() {
        return Err(format!("未找到 PicList 配置: {}", piclist.display()));
    }
    let raw = fs::read_to_string(&piclist).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let aliyun = v
        .pointer("/picBed/aliyun")
        .cloned()
        .ok_or_else(|| "PicList 中没有 aliyun 图床配置".to_string())?;

    let access_key_id = aliyun
        .get("accessKeyId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let access_key_secret = aliyun
        .get("accessKeySecret")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let bucket = aliyun
        .get("bucket")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let area = aliyun
        .get("area")
        .and_then(|x| x.as_str())
        .unwrap_or("oss-cn-beijing")
        .to_string();
    let custom_url = aliyun
        .get("customUrl")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    // PicList path like "img/202606/" → prefix "img"
    let path_raw = aliyun
        .get("path")
        .and_then(|x| x.as_str())
        .unwrap_or("img/")
        .trim_matches('/');
    let path_prefix = path_raw
        .split('/')
        .next()
        .unwrap_or("img")
        .to_string();

    if access_key_id.is_empty() || bucket.is_empty() {
        return Err("PicList aliyun 配置缺少 accessKeyId 或 bucket".into());
    }

    apply_save(
        user_data,
        CdnConfigSaveRequest {
            enabled: Some(true),
            provider: Some("aliyun".into()),
            aliyun: Some(AliyunOssSave {
                access_key_id: Some(access_key_id),
                access_key_secret: if access_key_secret.is_empty() {
                    None
                } else {
                    Some(access_key_secret)
                },
                bucket: Some(bucket),
                area: Some(area),
                path_prefix: Some(path_prefix),
                custom_url: Some(custom_url),
            }),
            r2: None,
            piclist_compat_enabled: Some(true),
            piclist_compat_port: Some(36677),
        },
    )
}

/// After successful upload, ingest into media-assets.
pub fn ingest_after_upload(
    user_data: &Path,
    cdn_url: &str,
    local_path: Option<&str>,
    filename: &str,
    file_size: Option<i64>,
) {
    let (width, height) = if let Some(p) = local_path {
        read_image_size(Path::new(p))
    } else {
        (None, None)
    };
    let req = crate::media_assets::IngestRequest {
        cdn_url: Some(cdn_url.to_string()),
        local_path: local_path.map(|s| s.to_string()),
        filename: Some(filename.to_string()),
        mime_type: Some(guess_mime(filename).to_string()),
        media_kind: None,
        content_hash: None,
        width,
        height,
        duration_ms: None,
        file_size,
        prompt: None,
        source: Some("eva-upload".into()),
        source_ref: None,
        cdn_provider: None,
        favorite: Some(false),
        notes: None,
        created_at: None,
        tags: vec![],
        purpose_tags: vec![],
        style_tags: vec![],
    };
    match crate::media_assets::ingest_asset(user_data, req) {
        Ok(_) => log::info!("[CDN] ingested asset after upload: {}", filename),
        Err(e) => log::warn!("[CDN] ingest after upload failed: {}", e),
    }
}

fn read_image_size(path: &Path) -> (Option<i64>, Option<i64>) {
    match image::image_dimensions(path) {
        Ok((w, h)) => (Some(w as i64), Some(h as i64)),
        Err(_) => (None, None),
    }
}

// ──────────────────────────────────────────────────
// Multipart (minimal)
// ──────────────────────────────────────────────────

#[derive(Debug)]
pub struct MultipartFile {
    pub field: String,
    pub filename: String,
    pub data: Vec<u8>,
}

/// Parse multipart/form-data; prefer fields named image or file.
pub fn parse_multipart(body: &[u8], content_type: &str) -> Result<MultipartFile, String> {
    let boundary = content_type
        .split(';')
        .find_map(|part| {
            let p = part.trim();
            p.strip_prefix("boundary=")
                .map(|b| b.trim_matches('"').to_string())
        })
        .ok_or_else(|| "multipart 缺少 boundary".to_string())?;

    let delim = format!("--{}", boundary);
    let delim_bytes = delim.as_bytes();

    let mut pos = 0usize;
    let mut candidates: Vec<MultipartFile> = Vec::new();

    while pos < body.len() {
        // find next boundary
        let Some(rel) = find_subslice(&body[pos..], delim_bytes) else {
            break;
        };
        pos += rel + delim_bytes.len();
        if body.get(pos..pos + 2) == Some(b"--") {
            break; // closing
        }
        if body.get(pos..pos + 2) == Some(b"\r\n") {
            pos += 2;
        } else if body.get(pos..pos + 1) == Some(b"\n") {
            pos += 1;
        }

        // headers until blank line
        let header_end = find_header_end(&body[pos..]).ok_or_else(|| "multipart 头解析失败".to_string())?;
        let header_bytes = &body[pos..pos + header_end];
        let headers = String::from_utf8_lossy(header_bytes);
        pos += header_end;
        // skip blank line delimiter that find_header_end pointed at
        if body.get(pos..pos + 4) == Some(b"\r\n\r\n") {
            pos += 4;
        } else if body.get(pos..pos + 2) == Some(b"\n\n") {
            pos += 2;
        }
        // body until next boundary (preceded by CRLF)
        let next = find_subslice(&body[pos..], delim_bytes).unwrap_or(body.len() - pos);
        let mut end = pos + next;
        // trim trailing CRLF before boundary
        if end >= 2 && &body[end - 2..end] == b"\r\n" {
            end -= 2;
        } else if end >= 1 && body[end - 1] == b'\n' {
            end -= 1;
        }
        let data = body[pos..end].to_vec();
        pos = pos + next;

        let mut field = String::new();
        let mut filename = String::from("upload.bin");
        for line in headers.lines() {
            let lower = line.to_ascii_lowercase();
            if lower.starts_with("content-disposition:") {
                if let Some(n) = extract_disp_param(line, "name") {
                    field = n;
                }
                if let Some(f) = extract_disp_param(line, "filename") {
                    filename = f;
                }
            }
        }
        if !field.is_empty() {
            candidates.push(MultipartFile { field, filename, data });
        }
    }

    // Prefer image/file; also accept "list" (Obsidian remoteServerMode FormData field).
    if let Some(f) = candidates.into_iter().find(|c| {
        matches!(c.field.as_str(), "image" | "file" | "list") && !c.data.is_empty()
    }) {
        return Ok(f);
    }
    Err("未找到 multipart 字段 image/file/list".into())
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    if let Some(i) = find_subslice(data, b"\r\n\r\n") {
        return Some(i);
    }
    find_subslice(data, b"\n\n")
}

fn extract_disp_param(line: &str, key: &str) -> Option<String> {
    // name="foo" or filename="bar.png"
    let pattern = format!("{}=", key);
    let lower = line.to_ascii_lowercase();
    let idx = lower.find(&pattern)?;
    let rest = &line[idx + pattern.len()..];
    if let Some(stripped) = rest.strip_prefix('"') {
        let end = stripped.find('"')?;
        Some(stripped[..end].to_string())
    } else {
        let end = rest.find([';', ';']).unwrap_or(rest.len());
        Some(rest[..end].trim().to_string())
    }
}

// ──────────────────────────────────────────────────
// Lifecycle / Tauri
// ──────────────────────────────────────────────────

pub fn init(app: &AppHandle) -> SharedCdnState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| {
            dirs::data_dir()
                .map(|d| d.join("com.xiyangxie.eva"))
                .unwrap_or_else(|| PathBuf::from("./"))
        });
    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);
    let path = config_path(&user_data);
    log::info!("[CDN] config path {}", path.display());
    Arc::new(Mutex::new(CdnState {
        user_data_dir: user_data,
        config_path: path,
    }))
}

fn state_user_data(state: &State<SharedCdnState>) -> Result<PathBuf, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.user_data_dir.clone())
}

#[tauri::command]
pub fn cdn_get_config(state: State<SharedCdnState>) -> Result<CdnConfigView, String> {
    let ud = state_user_data(&state)?;
    let cfg = load_config(&ud);
    Ok(to_view(&ud, &cfg))
}

#[tauri::command]
pub fn cdn_save_config(
    state: State<SharedCdnState>,
    config: CdnConfigSaveRequest,
) -> Result<CdnConfigView, String> {
    let ud = state_user_data(&state)?;
    apply_save(&ud, config)
}

#[tauri::command]
pub fn cdn_test_connection(state: State<SharedCdnState>) -> Result<CdnTestResult, String> {
    let ud = state_user_data(&state)?;
    Ok(test_connection(&ud))
}

#[tauri::command]
pub fn cdn_import_from_piclist(state: State<SharedCdnState>) -> Result<CdnConfigView, String> {
    let ud = state_user_data(&state)?;
    import_from_piclist(&ud)
}

#[tauri::command]
pub fn cdn_upload_file(
    state: State<SharedCdnState>,
    path: String,
) -> Result<UploadResult, String> {
    let ud = state_user_data(&state)?;
    match upload_path(&ud, Path::new(&path)) {
        Ok((url, key, filename)) => {
            let size = fs::metadata(&path).ok().map(|m| m.len() as i64);
            ingest_after_upload(&ud, &url, Some(&path), &filename, size);
            Ok(UploadResult {
                success: true,
                url: Some(url),
                key: Some(key),
                message: "success".into(),
            })
        }
        Err(e) => Ok(UploadResult {
            success: false,
            url: None,
            key: None,
            message: e,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_key_from_default_oss_url() {
        let cfg = AliyunOssConfig {
            access_key_id: "x".into(),
            access_key_secret: String::new(),
            bucket: "my-bucket".into(),
            area: "oss-cn-beijing".into(),
            path_prefix: "img".into(),
            custom_url: String::new(),
        };
        let url = "https://my-bucket.oss-cn-beijing.aliyuncs.com/img/202610/a_b.png";
        assert_eq!(
            object_key_from_url(&cfg, url).unwrap(),
            "img/202610/a_b.png"
        );
    }

    #[test]
    fn object_key_from_custom_url() {
        let cfg = AliyunOssConfig {
            access_key_id: "x".into(),
            access_key_secret: String::new(),
            bucket: "my-bucket".into(),
            area: "oss-cn-beijing".into(),
            path_prefix: "img".into(),
            custom_url: "https://cdn.example.com".into(),
        };
        let url = "https://cdn.example.com/img/202610/a_b.png";
        assert_eq!(
            object_key_from_url(&cfg, url).unwrap(),
            "img/202610/a_b.png"
        );
    }

    #[test]
    fn object_key_has_prefix_and_ext() {
        let key = build_object_key("img", "shot.PNG");
        assert!(key.starts_with("img/"));
        assert!(key.ends_with(".png"));
        let parts: Vec<_> = key.split('/').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[1].len(), 6); // YYYYMM
    }

    #[test]
    fn mime_guess() {
        assert_eq!(guess_mime("a.jpg"), "image/jpeg");
        assert_eq!(guess_mime("a.PNG"), "image/png");
    }

    #[test]
    fn multipart_image_field() {
        let body = b"\
--bound\r\n\
Content-Disposition: form-data; name=\"image\"; filename=\"x.png\"\r\n\
Content-Type: image/png\r\n\
\r\n\
PNGDATA\r\n\
--bound--\r\n";
        let f = parse_multipart(body, "multipart/form-data; boundary=bound").unwrap();
        assert_eq!(f.field, "image");
        assert_eq!(f.filename, "x.png");
        assert_eq!(f.data, b"PNGDATA");
    }

    #[test]
    fn multipart_list_field() {
        let body = b"\
--bound\r\n\
Content-Disposition: form-data; name=\"list\"; filename=\"y.jpg\"\r\n\
Content-Type: image/jpeg\r\n\
\r\n\
JPEGDATA\r\n\
--bound--\r\n";
        let f = parse_multipart(body, "multipart/form-data; boundary=bound").unwrap();
        assert_eq!(f.field, "list");
        assert_eq!(f.filename, "y.jpg");
        assert_eq!(f.data, b"JPEGDATA");
    }

    #[test]
    fn oss_sign_stable() {
        // Smoke: signature length / base64-ish
        let sig = oss_sign("secret", "PUT", "", "image/png", "Mon, 01 Jan 2024 00:00:00 GMT", "/bucket/key.png");
        assert!(!sig.is_empty());
        assert!(B64.decode(&sig).is_ok());
    }

    #[test]
    #[ignore = "live OSS; run with --ignored when credentials configured"]
    fn smoke_aliyun_list_bucket_if_configured() {
        let ud = dirs::data_dir()
            .expect("data_dir")
            .join("com.xiyangxie.eva")
            .join("userData");
        if !config_path(&ud).exists() || aliyun_secret(&ud).is_none() {
            eprintln!("skip smoke: no cdn config");
            return;
        }
        let res = test_connection(&ud);
        eprintln!("test_connection: success={} msg={}", res.success, res.message);
        assert!(res.success, "{}", res.message);

        // tiny 1x1 png
        let png: &[u8] = &[
            0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
            0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
            0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0xF8,0xCF,0xC0,0x00,
            0x00,0x00,0x03,0x00,0x01,0x00,0x05,0xFE,0x02,0xFE,0xDC,0xCC,0x59,0xE7,0x00,0x00,
            0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82,
        ];
        let (url, key) = upload_bytes(&ud, png, "eva-phaseb-smoke.png").expect("upload");
        eprintln!("uploaded key={} url_host_ok={}", key, url.starts_with("https://"));
        assert!(url.starts_with("https://"));
        assert!(key.contains("img/"));
    }


    /// Real OSS Put+Delete smoke. Run: cargo test --lib smoke_upload_then_delete -- --ignored --nocapture
    #[test]
    #[ignore]
    fn smoke_upload_then_delete() {
        let ud = dirs_user_data();
        if ud.is_none() {
            eprintln!("skip: no userData");
            return;
        }
        let ud = ud.unwrap();
        let cfg = load_config(&ud);
        if !cfg.enabled || cfg.provider != "aliyun" || aliyun_secret(&ud).is_none() {
            eprintln!("skip: aliyun not configured");
            return;
        }
        // 1x1 PNG
        let png: &[u8] = &[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
            0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
            0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8,
            0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
            0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        let filename = format!("eva-delete-smoke-{}.png", Uuid::new_v4());
        let (url, key) = upload_bytes(&ud, png, &filename).expect("upload");
        eprintln!("uploaded {} -> {}", key, url);
        let ingest = crate::media_assets::ingest_asset(
            &ud,
            crate::media_assets::IngestRequest {
                cdn_url: Some(url.clone()),
                local_path: None,
                filename: Some(filename),
                mime_type: Some("image/png".into()),
                media_kind: Some("image".into()),
                content_hash: None,
                width: Some(1),
                height: Some(1),
                duration_ms: None,
                file_size: Some(png.len() as i64),
                prompt: None,
                source: Some("eva-delete-smoke".into()),
                source_ref: None,
                cdn_provider: None,
                favorite: None,
                notes: None,
                created_at: None,
                tags: vec![],
                purpose_tags: vec![],
                style_tags: vec![],
            },
        )
        .expect("ingest");
        let id = ingest.asset.id.clone();
        match crate::media_assets::delete_asset(&ud, &id) {
            Ok(del) => {
                assert!(del.cloud_deleted);
                assert!(crate::media_assets::get_asset(&ud, &id)
                    .unwrap()
                    .is_none());
                let client = Client::builder()
                    .timeout(std::time::Duration::from_secs(15))
                    .build()
                    .unwrap();
                let status = client.head(&url).send().map(|r| r.status().as_u16()).unwrap_or(0);
                eprintln!("HEAD after delete: {}", status);
                assert!(
                    status == 404 || status == 403 || status == 0,
                    "expected object gone, got {}",
                    status
                );
            }
            Err(e) => {
                // Current PicList-imported AK may lack oss:DeleteObject — fail closed.
                assert!(
                    e.contains("云端删除失败") && e.contains("本地记录未删除"),
                    "unexpected error: {}",
                    e
                );
                assert!(
                    crate::media_assets::get_asset(&ud, &id).unwrap().is_some(),
                    "local row must remain when cloud delete fails"
                );
                eprintln!("cloud delete denied (expected if IAM lacks DeleteObject): {}", e);
                // Best-effort local cleanup of smoke row only (no cloud)
                let conn = crate::media_assets::open_db(&ud).unwrap();
                let _ = conn.execute("DELETE FROM assets_fts WHERE id = ?1", [&id]);
                let _ = conn.execute("DELETE FROM assets WHERE id = ?1", [&id]);
            }
        }
    }

    fn dirs_user_data() -> Option<PathBuf> {
        let home = std::env::var_os("HOME")?;
        let p = PathBuf::from(home)
            .join("Library/Application Support/com.xiyangxie.eva/userData");
        if p.is_dir() {
            Some(p)
        } else {
            None
        }
    }

}
