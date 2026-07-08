/**
 * vault.rs - 保险箱模块
 *
 * 加密存储方案：AES-256-CBC (与 super-dashboard 相同格式，支持无缝迁移)
 * 文件格式：iv_hex:ciphertext_hex
 * 密钥存储：macOS Keychain (security CLI)，服务名 com.devdash.vault (沿用旧名以支持迁移)
 */

use aes::Aes256;
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

// ==================== 类型定义 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAttachment {
    pub id: String,
    pub name: String,
    pub data: String, // Base64
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub item_type: String, // document | note | mfa | password
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<VaultAttachment>>,
    // MFA
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mfa_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mfa_issuer: Option<String>,
    // Password
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStore {
    pub items: Vec<VaultItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultUnlockResult {
    pub success: bool,
    pub data: Option<VaultStore>,
    pub error: Option<String>,
    pub need_password: Option<bool>,
    pub need_set_password: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSaveResult {
    pub success: bool,
    pub error: Option<String>,
}

// ==================== 状态 ====================

pub struct VaultState {
    pub is_unlocked: Mutex<bool>,
    pub master_key: Mutex<Option<[u8; 32]>>,
    pub data_path: String,
}

// Keychain 常量 (沿用 super-dashboard 的服务名，以便数据迁移)
const KEYCHAIN_SERVICE: &str = "com.devdash.vault";
const KEYCHAIN_ACCOUNT_KEY: &str = "master-key";
const KEYCHAIN_ACCOUNT_HASH: &str = "master-password-hash";

// ==================== Keychain 辅助函数 ====================

fn keychain_get(service: &str, account: &str) -> Option<String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            service,
            "-a",
            account,
            "-w",
        ])
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
    // -U: update if exists
    let output = Command::new("security")
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
        .output();

    output.map(|o| o.status.success()).unwrap_or(false)
}

// ==================== 加密/解密 (AES-256-CBC) ====================

type Aes256CbcEnc = cbc::Encryptor<Aes256>;
type Aes256CbcDec = cbc::Decryptor<Aes256>;

fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<String, String> {
    // 使用 UUID v4 的 16 字节作为随机 IV
    let iv_bytes = *Uuid::new_v4().as_bytes();
    let iv_hex = hex::encode(iv_bytes);

    let cipher = Aes256CbcEnc::new(key.into(), &iv_bytes.into());
    let ciphertext = cipher.encrypt_padded_vec_mut::<Pkcs7>(plaintext);
    let cipher_hex = hex::encode(&ciphertext);

    Ok(format!("{}:{}", iv_hex, cipher_hex))
}

fn decrypt(encrypted: &str, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let parts: Vec<&str> = encrypted.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err("invalid vault format".to_string());
    }

    let iv_bytes = hex::decode(parts[0]).map_err(|e| format!("invalid iv: {}", e))?;
    let ciphertext = hex::decode(parts[1]).map_err(|e| format!("invalid ciphertext: {}", e))?;

    if iv_bytes.len() != 16 {
        return Err("iv must be 16 bytes".to_string());
    }

    let iv_arr: [u8; 16] = iv_bytes.try_into().unwrap();
    let cipher = Aes256CbcDec::new(key.into(), &iv_arr.into());
    cipher
        .decrypt_padded_vec_mut::<Pkcs7>(&ciphertext)
        .map_err(|e| format!("decryption failed: {:?}", e))
}

// ==================== 密钥管理 ====================

/// 获取或生成主密钥（32 字节，hex 存储在 Keychain）
fn get_or_create_master_key() -> Option<[u8; 32]> {
    if let Some(hex_key) = keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_KEY) {
        if let Ok(bytes) = hex::decode(&hex_key) {
            if bytes.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&bytes);
                return Some(arr);
            }
        }
    }

    // 生成新密钥
    let key_bytes = generate_random_32();
    let hex_key = hex::encode(key_bytes);
    if keychain_set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_KEY, &hex_key) {
        Some(key_bytes)
    } else {
        log::error!("[vault] failed to store master key in keychain");
        None
    }
}

fn generate_random_32() -> [u8; 32] {
    // 用两个 UUID v4 拼成 32 字节随机数
    let a = *Uuid::new_v4().as_bytes();
    let b = *Uuid::new_v4().as_bytes();
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(&a);
    out[16..].copy_from_slice(&b);
    out
}

// ==================== 密码哈希 ====================

use sha2::{Digest, Sha256};

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

// ==================== 文件操作 ====================

fn vault_file_path(data_path: &str) -> PathBuf {
    PathBuf::from(data_path).join("vault.enc")
}

fn load_vault(data_path: &str, key: &[u8; 32]) -> Result<VaultStore, String> {
    let path = vault_file_path(data_path);
    if !path.exists() {
        return Ok(VaultStore { items: vec![] });
    }

    let encrypted = fs::read_to_string(&path).map_err(|e| format!("read error: {}", e))?;
    let encrypted = encrypted.trim();

    let plaintext = decrypt(encrypted, key)?;
    serde_json::from_slice(&plaintext).map_err(|e| format!("json parse error: {}", e))
}

fn save_vault(data_path: &str, key: &[u8; 32], store: &VaultStore) -> Result<(), String> {
    let json = serde_json::to_vec(store).map_err(|e| format!("json error: {}", e))?;
    let encrypted = encrypt(&json, key)?;

    let path = vault_file_path(data_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir error: {}", e))?;
    }
    fs::write(&path, encrypted).map_err(|e| format!("write error: {}", e))
}

// ==================== 初始化 ====================

pub fn init(app: &AppHandle) -> VaultState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("userData");
    let data_path = data_dir.to_string_lossy().to_string();

    VaultState {
        is_unlocked: Mutex::new(false),
        master_key: Mutex::new(None),
        data_path,
    }
}

// ==================== macOS Touch ID (LAContext) ====================

#[cfg(target_os = "macos")]
fn la_check_available() -> bool {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let cls = class!(LAContext);
        let ctx: *mut Object = msg_send![cls, new];
        let mut err: *mut Object = std::ptr::null_mut();
        // LAPolicyDeviceOwnerAuthenticationWithBiometrics = 1
        let ok: bool = msg_send![ctx, canEvaluatePolicy: 1i64 error: &mut err];
        let _: () = msg_send![ctx, release];
        ok
    }
}

#[cfg(not(target_os = "macos"))]
fn la_check_available() -> bool {
    false
}

/// 触发 Touch ID 弹窗，同步等待结果（最长 60 秒）
#[cfg(target_os = "macos")]
fn la_prompt_sync(reason: &str) -> bool {
    use block::ConcreteBlock;
    use objc::runtime::{Object, BOOL, NO};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::CString;
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<bool>();

    unsafe {
        let cls = class!(LAContext);
        let ctx: *mut Object = msg_send![cls, new];

        // NSString from Rust &str
        let ns_string_cls = class!(NSString);
        let c_reason = CString::new(reason).unwrap_or_else(|_| CString::new("Unlock").unwrap());
        let ns_reason: *mut Object =
            msg_send![ns_string_cls, stringWithUTF8String: c_reason.as_ptr()];

        let block = ConcreteBlock::new(move |success: BOOL, _error: *mut Object| {
            let _ = tx.send(success != NO);
        });
        let block = block.copy();

        // LAPolicyDeviceOwnerAuthenticationWithBiometrics = 1
        let _: () = msg_send![ctx, evaluatePolicy: 1i64
                                   localizedReason: ns_reason
                                             reply: &*block];
        let _: () = msg_send![ctx, release];
    }

    rx.recv_timeout(std::time::Duration::from_secs(60))
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn la_prompt_sync(_reason: &str) -> bool {
    false
}

// ==================== Tauri Commands ====================

/// 检查是否可以使用生物识别（Touch ID）
#[tauri::command]
pub fn vault_can_use_biometric() -> bool {
    la_check_available()
}

/// 生物识别解锁（当前回退到密码流程）
#[tauri::command]
pub fn vault_unlock(state: State<'_, VaultState>) -> VaultUnlockResult {
    // 如果已解锁，直接返回数据
    let already_unlocked = *state.is_unlocked.lock().unwrap();
    if already_unlocked {
        let key_guard = state.master_key.lock().unwrap();
        if let Some(key) = key_guard.as_ref() {
            match load_vault(&state.data_path, key) {
                Ok(store) => {
                    return VaultUnlockResult {
                        success: true,
                        data: Some(store),
                        error: None,
                        need_password: None,
                        need_set_password: None,
                    }
                }
                Err(e) => {
                    return VaultUnlockResult {
                        success: false,
                        data: None,
                        error: Some(e),
                        need_password: None,
                        need_set_password: None,
                    }
                }
            }
        }
    }

    // 检查是否设置了密码
    let has_pw = keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_HASH).is_some();
    VaultUnlockResult {
        success: false,
        data: None,
        error: None,
        need_password: Some(true),
        need_set_password: if !has_pw { Some(true) } else { None },
    }
}

/// 检查是否已设置密码
#[tauri::command]
pub fn vault_has_password() -> bool {
    keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_HASH).is_some()
}

/// 使用密码解锁
#[tauri::command]
pub fn vault_unlock_with_password(
    password: String,
    state: State<'_, VaultState>,
) -> VaultUnlockResult {
    // 如果还没有设置密码，返回 needSetPassword
    let stored_hash = match keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_HASH) {
        Some(h) => h,
        None => {
            return VaultUnlockResult {
                success: false,
                data: None,
                error: None,
                need_password: None,
                need_set_password: Some(true),
            };
        }
    };

    let input_hash = hash_password(&password);
    if input_hash != stored_hash {
        return VaultUnlockResult {
            success: false,
            data: None,
            error: Some("密码错误".to_string()),
            need_password: None,
            need_set_password: None,
        };
    }

    // 密码正确，获取/创建主密钥
    let key = match get_or_create_master_key() {
        Some(k) => k,
        None => {
            return VaultUnlockResult {
                success: false,
                data: None,
                error: Some("无法访问密钥链".to_string()),
                need_password: None,
                need_set_password: None,
            };
        }
    };

    match load_vault(&state.data_path, &key) {
        Ok(store) => {
            *state.is_unlocked.lock().unwrap() = true;
            *state.master_key.lock().unwrap() = Some(key);
            VaultUnlockResult {
                success: true,
                data: Some(store),
                error: None,
                need_password: None,
                need_set_password: None,
            }
        }
        Err(e) => VaultUnlockResult {
            success: false,
            data: None,
            error: Some(e),
            need_password: None,
            need_set_password: None,
        },
    }
}

/// 设置/修改密码
#[tauri::command]
pub fn vault_set_password(password: String) -> bool {
    let hash = hash_password(&password);
    let stored = keychain_set(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_HASH, &hash);
    if !stored {
        log::error!("[vault] failed to store password hash");
        return false;
    }

    // 确保主密钥存在
    get_or_create_master_key().is_some()
}

/// 锁定保险箱
#[tauri::command]
pub fn vault_lock(state: State<'_, VaultState>) {
    *state.is_unlocked.lock().unwrap() = false;
    *state.master_key.lock().unwrap() = None;
}

/// 保存数据
#[tauri::command]
pub fn vault_save(data: VaultStore, state: State<'_, VaultState>) -> VaultSaveResult {
    let key_guard = state.master_key.lock().unwrap();
    let key = match key_guard.as_ref() {
        Some(k) => *k,
        None => {
            return VaultSaveResult {
                success: false,
                error: Some("保险箱未解锁".to_string()),
            }
        }
    };
    drop(key_guard);

    match save_vault(&state.data_path, &key, &data) {
        Ok(_) => VaultSaveResult {
            success: true,
            error: None,
        },
        Err(e) => VaultSaveResult {
            success: false,
            error: Some(e),
        },
    }
}

/// 内容保护（Electron 专用，Eva 中为空操作）
#[tauri::command]
pub fn vault_set_content_protection(_enabled: bool) {}

/// 触发 Touch ID 弹窗（由 desktopBridge 在调用 vault_unlock_with_biometric 前调用）
#[tauri::command]
pub fn vault_prompt_biometric(reason: Option<String>) -> bool {
    let r = reason.as_deref().unwrap_or("解锁 EVA 保险箱");
    la_prompt_sync(r)
}

/// 生物识别解锁（由前端验证指纹，后端信任结果）
/// 要求必须先设置过密码（确保 master-key 已在 Keychain 中）
#[tauri::command]
pub fn vault_unlock_with_biometric(state: State<'_, VaultState>) -> VaultUnlockResult {
    // 已解锁时直接返回数据
    let already_unlocked = *state.is_unlocked.lock().unwrap();
    if already_unlocked {
        let key_guard = state.master_key.lock().unwrap();
        if let Some(key) = key_guard.as_ref() {
            return match load_vault(&state.data_path, key) {
                Ok(store) => VaultUnlockResult {
                    success: true,
                    data: Some(store),
                    error: None,
                    need_password: None,
                    need_set_password: None,
                },
                Err(e) => VaultUnlockResult {
                    success: false,
                    data: None,
                    error: Some(e),
                    need_password: None,
                    need_set_password: None,
                },
            };
        }
    }

    // 必须先设置过密码，否则 master-key 可能尚未创建
    if keychain_get(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_HASH).is_none() {
        return VaultUnlockResult {
            success: false,
            data: None,
            error: None,
            need_password: None,
            need_set_password: Some(true),
        };
    }

    let key = match get_or_create_master_key() {
        Some(k) => k,
        None => {
            return VaultUnlockResult {
                success: false,
                data: None,
                error: Some("无法访问密钥链".to_string()),
                need_password: None,
                need_set_password: None,
            }
        }
    };

    match load_vault(&state.data_path, &key) {
        Ok(store) => {
            *state.is_unlocked.lock().unwrap() = true;
            *state.master_key.lock().unwrap() = Some(key);
            VaultUnlockResult {
                success: true,
                data: Some(store),
                error: None,
                need_password: None,
                need_set_password: None,
            }
        }
        Err(e) => VaultUnlockResult {
            success: false,
            data: None,
            error: Some(e),
            need_password: None,
            need_set_password: None,
        },
    }
}

