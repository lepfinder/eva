use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;

// ==================== Types ====================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetail {
    pub pid: u32,
    pub name: String,
    pub rss: u64, // bytes
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMemoryGroup {
    pub name: String,
    pub total_rss: u64,      // bytes
    pub formatted_rss: String,
    pub process_count: u32,
    pub processes: Vec<ProcessDetail>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryInfo {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub percent: f64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub app_memory: Option<u64>,
    pub wired: Option<u64>,
    pub compressed: Option<u64>,
    pub cached: Option<u64>,
    pub active: Option<u64>,
    pub inactive: Option<u64>,
}

#[derive(Serialize)]
pub struct MemoryAnalysisResult {
    pub system: SystemMemoryInfo,
    pub apps: Vec<AppMemoryGroup>,
}

// ==================== Helpers ====================

fn format_bytes(bytes: u64) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    const MB: u64 = 1024 * 1024;
    const KB: u64 = 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn run_cmd(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if output.status.success() || !output.stdout.is_empty() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

/// Parse `sysctl -n <key>` as u64
fn sysctl_u64(key: &str) -> Option<u64> {
    let out = run_cmd("sysctl", &["-n", key])?;
    out.trim().parse().ok()
}

/// Parse a numeric value from a `vm_stat` line like "Pages free:  123456."
fn parse_vm_stat_line(line: &str) -> Option<u64> {
    let colon = line.find(':')?;
    let val_str = line[colon + 1..].trim().trim_end_matches('.');
    val_str.parse().ok()
}

fn get_system_memory() -> SystemMemoryInfo {
    let total = sysctl_u64("hw.memsize").unwrap_or(0);
    let page_size = sysctl_u64("hw.pagesize").unwrap_or(4096);

    // Parse vm_stat
    let mut free_pages: u64 = 0;
    let mut active_pages: u64 = 0;
    let mut inactive_pages: u64 = 0;
    let mut wired_pages: u64 = 0;
    let mut speculative_pages: u64 = 0;
    let mut compressor_pages: u64 = 0; // "Pages occupied by compressor"

    if let Some(vm_out) = run_cmd("vm_stat", &[]) {
        for line in vm_out.lines() {
            if let Some(val) = parse_vm_stat_line(line) {
                if line.contains("Pages free:") {
                    free_pages = val;
                } else if line.contains("Pages active:") {
                    active_pages = val;
                } else if line.contains("Pages inactive:") {
                    inactive_pages = val;
                } else if line.contains("Pages wired down:") {
                    wired_pages = val;
                } else if line.contains("Pages speculative:") {
                    speculative_pages = val;
                } else if line.contains("Pages occupied by compressor:") {
                    compressor_pages = val;
                }
            }
        }
    }

    let free_bytes = (free_pages + speculative_pages) * page_size;
    let app_memory = (active_pages + inactive_pages) * page_size;
    let wired_bytes = wired_pages * page_size;
    let compressed_bytes = compressor_pages * page_size;

    let used = total.saturating_sub(free_bytes);
    let percent = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    // Swap: `sysctl vm.swapusage` → "total = 2048.00M  used = 1536.00M  free = 512.00M"
    let (swap_total, swap_used) = get_swap_info();

    SystemMemoryInfo {
        total,
        used,
        available: free_bytes,
        percent,
        swap_total,
        swap_used,
        app_memory: Some(app_memory),
        wired: Some(wired_bytes),
        compressed: Some(compressed_bytes),
        cached: None,
        active: Some(active_pages * page_size),
        inactive: Some(inactive_pages * page_size),
    }
}

/// Parse a size value with suffix (e.g. "2048.00M") into bytes
fn parse_size_with_suffix(s: &str) -> u64 {
    let s = s.trim();
    // Find where digits/dot end
    let num_end = s
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(s.len());
    let num: f64 = s[..num_end].parse().unwrap_or(0.0);
    let suffix = s[num_end..].trim().to_uppercase();
    match suffix.as_str() {
        "G" | "GB" => (num * 1024.0 * 1024.0 * 1024.0) as u64,
        "M" | "MB" => (num * 1024.0 * 1024.0) as u64,
        "K" | "KB" => (num * 1024.0) as u64,
        _ => num as u64,
    }
}

fn get_swap_info() -> (u64, u64) {
    if let Some(out) = run_cmd("sysctl", &["-n", "vm.swapusage"]) {
        // Format: "total = 2048.00M  used = 1536.00M  free = 512.00M  (encrypted)"
        let total = extract_swap_field(&out, "total");
        let used = extract_swap_field(&out, "used");
        return (total, used);
    }
    (0, 0)
}

fn extract_swap_field(s: &str, field: &str) -> u64 {
    let pattern = format!("{} = ", field);
    if let Some(start) = s.find(&pattern) {
        let rest = &s[start + pattern.len()..];
        // Take until next space or end
        let end = rest.find("  ").unwrap_or(rest.len());
        return parse_size_with_suffix(&rest[..end]);
    }
    0
}

/// Collect process memory using `ps axo pid= rss= comm=`
/// RSS is in KB, we convert to bytes.
fn get_process_memory() -> Vec<AppMemoryGroup> {
    let output = match run_cmd("ps", &["axo", "pid= rss= comm="]) {
        Some(o) => o,
        None => return vec![],
    };

    // Group by process name
    let mut groups: HashMap<String, (u64, Vec<ProcessDetail>)> = HashMap::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let pid: u32 = match parts[0].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let rss_kb: u64 = match parts[1].parse() {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rss_kb == 0 {
            continue;
        }
        let rss_bytes = rss_kb * 1024;
        // Command name may have multiple parts; join all from index 2
        let name = parts[2..].join(" ");
        // Use only the basename for grouping
        let group_name = std::path::Path::new(&name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&name)
            .to_string();

        let entry = groups.entry(group_name.clone()).or_insert((0, vec![]));
        entry.0 += rss_bytes;
        entry.1.push(ProcessDetail {
            pid,
            name: group_name,
            rss: rss_bytes,
        });
    }

    let mut result: Vec<AppMemoryGroup> = groups
        .into_iter()
        .map(|(name, (total_rss, mut processes))| {
            processes.sort_by(|a, b| b.rss.cmp(&a.rss));
            AppMemoryGroup {
                process_count: processes.len() as u32,
                formatted_rss: format_bytes(total_rss),
                name,
                total_rss,
                processes,
            }
        })
        .collect();

    // Sort by total RSS descending
    result.sort_by(|a, b| b.total_rss.cmp(&a.total_rss));
    result
}

// ==================== Command ====================

#[tauri::command]
pub fn get_memory_analysis() -> Result<MemoryAnalysisResult, String> {
    let system = get_system_memory();
    let apps = get_process_memory();
    Ok(MemoryAnalysisResult { system, apps })
}
