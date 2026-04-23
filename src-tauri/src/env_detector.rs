use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::process::Command;
use tauri::{AppHandle, Manager};

// ==================== Types ====================

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvTool {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub command: String,
    pub status: String, // "ok" | "not_installed" | "error"
    pub checked_at: String,
    pub error: Option<String>,
}

// ==================== Static tool catalog ====================

struct ToolSpec {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    description: &'static str,
    tags: &'static [&'static str],
    /// Binary name passed to `which`
    binary: &'static str,
    /// Args to retrieve version string
    version_args: &'static [&'static str],
}

static TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "node",
        name: "Node.js",
        category: "Runtime",
        description: "JavaScript 运行时，广泛用于后端服务和工具链",
        tags: &["js", "backend", "runtime"],
        binary: "node",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "npm",
        name: "npm",
        category: "Package Manager",
        description: "Node.js 默认包管理器",
        tags: &["js", "package-manager"],
        binary: "npm",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "pnpm",
        name: "pnpm",
        category: "Package Manager",
        description: "高性能 Node.js 包管理器，节省磁盘空间",
        tags: &["js", "package-manager"],
        binary: "pnpm",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "yarn",
        name: "Yarn",
        category: "Package Manager",
        description: "快速可靠的 JavaScript 包管理器",
        tags: &["js", "package-manager"],
        binary: "yarn",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "bun",
        name: "Bun",
        category: "Runtime",
        description: "超快 JavaScript 运行时 & 包管理器",
        tags: &["js", "runtime", "package-manager"],
        binary: "bun",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "python",
        name: "Python",
        category: "Runtime",
        description: "通用编程语言，AI/ML 领域首选",
        tags: &["python", "ai", "runtime"],
        binary: "python3",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "pip",
        name: "pip",
        category: "Package Manager",
        description: "Python 包管理器",
        tags: &["python", "package-manager"],
        binary: "pip3",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "git",
        name: "Git",
        category: "VCS",
        description: "分布式版本控制系统",
        tags: &["vcs", "cli"],
        binary: "git",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "gh",
        name: "GitHub CLI",
        category: "CLI Tool",
        description: "GitHub 官方命令行工具，管理 PR/Issue/Repo",
        tags: &["github", "cli", "vcs"],
        binary: "gh",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "docker",
        name: "Docker",
        category: "Container",
        description: "容器化平台，用于打包和部署应用",
        tags: &["container", "devops"],
        binary: "docker",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "go",
        name: "Go",
        category: "Runtime",
        description: "Google 开发的静态类型系统级语言",
        tags: &["go", "runtime", "backend"],
        binary: "go",
        version_args: &["version"],
    },
    ToolSpec {
        id: "rust",
        name: "Rust (rustc)",
        category: "Runtime",
        description: "内存安全的系统级编程语言",
        tags: &["rust", "runtime", "systems"],
        binary: "rustc",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "cargo",
        name: "Cargo",
        category: "Build Tool",
        description: "Rust 官方构建系统与包管理器",
        tags: &["rust", "package-manager"],
        binary: "cargo",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "ollama",
        name: "Ollama",
        category: "AI",
        description: "本地运行大语言模型的工具，支持 Llama/Mistral 等",
        tags: &["ai", "llm", "local"],
        binary: "ollama",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "ffmpeg",
        name: "FFmpeg",
        category: "Media",
        description: "跨平台音视频处理工具，支持转码/剪辑/流媒体",
        tags: &["media", "video", "audio", "cli"],
        binary: "ffmpeg",
        version_args: &["-version"],
    },
    ToolSpec {
        id: "jq",
        name: "jq",
        category: "CLI Tool",
        description: "命令行 JSON 处理器，Agent 任务必备",
        tags: &["json", "cli", "agent"],
        binary: "jq",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "rg",
        name: "ripgrep",
        category: "CLI Tool",
        description: "超快代码搜索工具，替代 grep",
        tags: &["search", "cli", "agent"],
        binary: "rg",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "fzf",
        name: "fzf",
        category: "CLI Tool",
        description: "命令行模糊查找器，提升终端工作效率",
        tags: &["search", "cli", "agent"],
        binary: "fzf",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "fd",
        name: "fd",
        category: "CLI Tool",
        description: "简单快速的文件查找工具，替代 find",
        tags: &["search", "cli"],
        binary: "fd",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "sqlite3",
        name: "SQLite",
        category: "Database",
        description: "嵌入式关系型数据库",
        tags: &["database", "sql"],
        binary: "sqlite3",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "psql",
        name: "PostgreSQL CLI",
        category: "Database",
        description: "PostgreSQL 交互式终端",
        tags: &["database", "sql", "postgres"],
        binary: "psql",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "mysql",
        name: "MySQL CLI",
        category: "Database",
        description: "MySQL 命令行客户端",
        tags: &["database", "sql", "mysql"],
        binary: "mysql",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "redis-cli",
        name: "Redis CLI",
        category: "Database",
        description: "Redis 命令行客户端",
        tags: &["database", "redis", "cache"],
        binary: "redis-cli",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "pandoc",
        name: "Pandoc",
        category: "Productivity",
        description: "万能文档格式转换工具",
        tags: &["document", "conversion", "cli"],
        binary: "pandoc",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "yt-dlp",
        name: "yt-dlp",
        category: "Media",
        description: "下载 YouTube/B站等平台视频和音频",
        tags: &["media", "download", "cli"],
        binary: "yt-dlp",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "curl",
        name: "curl",
        category: "Network",
        description: "命令行 HTTP/网络请求工具",
        tags: &["network", "http", "cli"],
        binary: "curl",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "wget",
        name: "wget",
        category: "Network",
        description: "命令行文件下载工具，支持断点续传",
        tags: &["network", "download", "cli"],
        binary: "wget",
        version_args: &["--version"],
    },
    ToolSpec {
        id: "make",
        name: "Make",
        category: "Build Tool",
        description: "经典构建自动化工具",
        tags: &["build", "cli"],
        binary: "make",
        version_args: &["--version"],
    },
];

// ==================== Helpers ====================

/// Extract the first X.Y.Z or X.Y version string found in text
fn extract_version(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            // Consume digits and dots
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            let candidate = &text[start..i];
            // Must have at least one dot and no empty segments
            let parts: Vec<&str> = candidate.split('.').collect();
            if parts.len() >= 2
                && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
            {
                return Some(candidate.to_string());
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Run `which <binary>` and return the path if found
fn which(binary: &str) -> Option<String> {
    let output = Command::new("which").arg(binary).output().ok()?;
    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(path);
        }
    }
    None
}

/// Run a command and return combined stdout+stderr
fn run_version_cmd(binary: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(binary)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(combined.trim().to_string())
}

fn descriptions_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let base = app.path().app_data_dir().ok()?;
    Some(base.join("userData").join("env").join("descriptions.json"))
}

fn load_descriptions(app: &AppHandle) -> HashMap<String, String> {
    let path = match descriptions_path(app) {
        Some(p) => p,
        None => return HashMap::new(),
    };
    if !path.exists() {
        return HashMap::new();
    }
    let content = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&content).unwrap_or_default()
}

fn current_timestamp() -> String {
    // Simple ISO-like timestamp using SystemTime
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as rough ISO string (good enough for display)
    let dt = secs;
    let s = dt % 60;
    let m = (dt / 60) % 60;
    let h = (dt / 3600) % 24;
    let days = dt / 86400;
    // Days since epoch → year/month/day (approximate, no timezone)
    let year = 1970 + days / 365;
    let day_of_year = days % 365;
    let month = day_of_year / 30 + 1;
    let day = day_of_year % 30 + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, h, m, s
    )
}

// ==================== Commands ====================

#[tauri::command]
pub fn env_detect(app: AppHandle) -> Vec<EnvTool> {
    let descriptions = load_descriptions(&app);
    let now = current_timestamp();

    TOOLS
        .iter()
        .map(|spec| {
            let path = which(spec.binary);
            let saved_desc = descriptions.get(spec.id).cloned();
            let description = saved_desc.or_else(|| Some(spec.description.to_string()));

            if let Some(ref bin_path) = path {
                // Tool found – get version
                match run_version_cmd(spec.binary, spec.version_args) {
                    Ok(output) => {
                        let version = extract_version(&output);
                        EnvTool {
                            id: spec.id.to_string(),
                            name: spec.name.to_string(),
                            category: spec.category.to_string(),
                            description,
                            tags: spec.tags.iter().map(|t| t.to_string()).collect(),
                            installed: true,
                            version,
                            path: Some(bin_path.clone()),
                            command: format!("{} {}", spec.binary, spec.version_args.join(" ")),
                            status: "ok".to_string(),
                            checked_at: now.clone(),
                            error: None,
                        }
                    }
                    Err(e) => EnvTool {
                        id: spec.id.to_string(),
                        name: spec.name.to_string(),
                        category: spec.category.to_string(),
                        description,
                        tags: spec.tags.iter().map(|t| t.to_string()).collect(),
                        installed: true,
                        version: None,
                        path: Some(bin_path.clone()),
                        command: spec.binary.to_string(),
                        status: "error".to_string(),
                        checked_at: now.clone(),
                        error: Some(e),
                    },
                }
            } else {
                EnvTool {
                    id: spec.id.to_string(),
                    name: spec.name.to_string(),
                    category: spec.category.to_string(),
                    description,
                    tags: spec.tags.iter().map(|t| t.to_string()).collect(),
                    installed: false,
                    version: None,
                    path: None,
                    command: spec.binary.to_string(),
                    status: "not_installed".to_string(),
                    checked_at: now.clone(),
                    error: None,
                }
            }
        })
        .collect()
}

#[tauri::command]
pub fn env_save_description(app: AppHandle, id: String, description: String) -> Result<(), String> {
    let path = descriptions_path(&app).ok_or("Cannot resolve app data dir")?;

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut descriptions = load_descriptions(&app);
    descriptions.insert(id, description);

    let json = serde_json::to_string_pretty(&descriptions).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(())
}
