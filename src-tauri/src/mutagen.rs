use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MutagenEndpoint {
    pub protocol: Option<String>,
    pub user: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub path: Option<String>,
    pub connected: Option<bool>,
    pub scanned: Option<bool>,
    pub directories: Option<u64>,
    pub files: Option<u64>,
    pub total_file_size: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MutagenIgnore {
    pub paths: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MutagenSession {
    pub identifier: String,
    pub name: Option<String>,
    pub version: Option<u32>,
    pub creation_time: Option<String>,
    pub mode: Option<String>,
    pub alpha: MutagenEndpoint,
    pub beta: MutagenEndpoint,
    pub ignore: Option<MutagenIgnore>,
    pub paused: Option<bool>,
    pub status: String,
    pub last_error: Option<String>,
    pub successful_cycles: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MutagenStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionPayload {
    pub name: String,
    pub alpha_path: String,
    pub beta_target: String,
    pub sync_mode: Option<String>,
    pub ignore_paths: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
}

static CACHED_BIN: OnceLock<Option<String>> = OnceLock::new();
static CACHED_STATUS: OnceLock<MutagenStatus> = OnceLock::new();

/// Locate mutagen binary on macOS / Linux (cached in-memory)
pub fn find_mutagen_binary() -> Option<String> {
    CACHED_BIN
        .get_or_init(|| {
            // 1. Try standard locations on macOS / Linux
            let candidates = [
                "/opt/homebrew/bin/mutagen",
                "/usr/local/bin/mutagen",
                "/usr/bin/mutagen",
            ];

            for path in &candidates {
                if std::path::Path::new(path).exists() {
                    return Some(path.to_string());
                }
            }

            // 2. Try which
            if let Ok(output) = Command::new("which").arg("mutagen").output() {
                if output.status.success() {
                    let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !p.is_empty() && std::path::Path::new(&p).exists() {
                        return Some(p);
                    }
                }
            }

            // 3. Check home dir ~/.mutagen/bin/mutagen
            if let Ok(home) = std::env::var("HOME") {
                let p = PathBuf::from(home).join(".mutagen").join("bin").join("mutagen");
                if p.exists() {
                    return Some(p.to_string_lossy().to_string());
                }
            }

            None
        })
        .clone()
}

/// Helper to run mutagen with standard environment PATH
fn create_mutagen_cmd(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if !path_env.contains("/opt/homebrew/bin") {
        path_env = format!("/opt/homebrew/bin:/usr/local/bin:{}", path_env);
    }
    cmd.env("PATH", path_env);
    cmd
}

#[tauri::command]
pub fn mutagen_get_status() -> MutagenStatus {
    if let Some(status) = CACHED_STATUS.get() {
        return status.clone();
    }

    let bin = match find_mutagen_binary() {
        Some(b) => b,
        None => {
            return MutagenStatus {
                installed: false,
                version: None,
                path: None,
                error: Some("未检测到 mutagen，请通过 'brew install mutagen-io/mutagen/mutagen' 安装".to_string()),
            };
        }
    };

    let mut cmd = create_mutagen_cmd(&bin);
    let status = match cmd.arg("version").output() {
        Ok(out) => {
            if out.status.success() {
                let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                MutagenStatus {
                    installed: true,
                    version: Some(ver),
                    path: Some(bin),
                    error: None,
                }
            } else {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                MutagenStatus {
                    installed: true,
                    version: None,
                    path: Some(bin),
                    error: Some(err),
                }
            }
        }
        Err(e) => MutagenStatus {
            installed: false,
            version: None,
            path: Some(bin),
            error: Some(e.to_string()),
        },
    };

    if status.installed {
        let _ = CACHED_STATUS.set(status.clone());
    }

    status
}

#[tauri::command]
pub fn mutagen_list_sessions() -> Result<Vec<MutagenSession>, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;

    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "list", "--template", "{{json .}}"]);

    let output = cmd.output().map_err(|e| format!("执行 mutagen 失败: {}", e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err_msg.is_empty() {
            "无法获取 mutagen 同步会话列表".to_string()
        } else {
            err_msg
        });
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout_str.is_empty() || stdout_str == "null" {
        return Ok(Vec::new());
    }

    let sessions: Vec<MutagenSession> = serde_json::from_str(&stdout_str)
        .map_err(|e| format!("解析会话 JSON 失败: {} (原始数据: {})", e, stdout_str))?;

    Ok(sessions)
}

#[tauri::command]
pub fn mutagen_create_session(payload: CreateSessionPayload) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;

    if payload.name.trim().is_empty() {
        return Err("会话名称不能为空".to_string());
    }
    if payload.alpha_path.trim().is_empty() {
        return Err("本地路径不能为空".to_string());
    }
    if payload.beta_target.trim().is_empty() {
        return Err("远程或目标端路径不能为空".to_string());
    }

    let sync_mode = payload
        .sync_mode
        .unwrap_or_else(|| "two-way-resolved".to_string());

    let mut cmd = create_mutagen_cmd(&bin);
    cmd.arg("sync")
        .arg("create")
        .arg(format!("--name={}", payload.name.trim()))
        .arg(format!("--sync-mode={}", sync_mode));

    if let Some(ignores) = payload.ignore_paths {
        for ign in ignores {
            let trimmed = ign.trim();
            if !trimmed.is_empty() {
                cmd.arg(format!("--ignore={}", trimmed));
            }
        }
    }

    cmd.arg(payload.alpha_path.trim());
    cmd.arg(payload.beta_target.trim());

    let output = cmd.output().map_err(|e| format!("创建会话执行失败: {}", e))?;

    if output.status.success() {
        let stdout_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(ActionResult {
            success: true,
            message: if stdout_str.is_empty() {
                "创建同步会话成功".to_string()
            } else {
                stdout_str
            },
        })
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err_msg.is_empty() {
            "创建同步会话失败".to_string()
        } else {
            err_msg
        })
    }
}

#[tauri::command]
pub fn mutagen_pause_session(session: String) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;
    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "pause", &session]);

    let output = cmd.output().map_err(|e| format!("暂停同步失败: {}", e))?;
    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("已暂停会话 {}", session),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn mutagen_resume_session(session: String) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;
    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "resume", &session]);

    let output = cmd.output().map_err(|e| format!("恢复同步失败: {}", e))?;
    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("已恢复会话 {}", session),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn mutagen_flush_session(session: String) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;
    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "flush", &session]);

    let output = cmd.output().map_err(|e| format!("强制刷写同步失败: {}", e))?;
    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("会话 {} 刷写完成", session),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn mutagen_reset_session(session: String) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;
    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "reset", &session]);

    let output = cmd.output().map_err(|e| format!("重置会话失败: {}", e))?;
    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("会话 {} 已重置", session),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn mutagen_terminate_session(session: String) -> Result<ActionResult, String> {
    let bin = find_mutagen_binary().ok_or_else(|| "mutagen 未安装".to_string())?;
    let mut cmd = create_mutagen_cmd(&bin);
    cmd.args(["sync", "terminate", &session]);

    let output = cmd.output().map_err(|e| format!("删除会话失败: {}", e))?;
    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("已删除会话 {}", session),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn mutagen_test_ssh(target: String) -> Result<ActionResult, String> {
    let host_part = if let Some(idx) = target.find(':') {
        &target[..idx]
    } else {
        target.as_str()
    };

    let mut cmd = Command::new("ssh");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=3",
        "-q",
        host_part,
        "exit",
    ]);

    let output = cmd
        .output()
        .map_err(|e| format!("无法执行 ssh 命令: {}", e))?;

    if output.status.success() {
        Ok(ActionResult {
            success: true,
            message: format!("SSH 连接到 {} 验证成功", host_part),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("SSH 连接到 {} 失败，请检查免密配置或主机是否在线", host_part)
        } else {
            err
        })
    }
}
