use serde::Serialize;
use std::collections::HashSet;
use std::process::Command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub protocol: String,
    pub local_address: String,
    pub port: u32,
    pub pid: u32,
    pub process_name: String,
    pub command: Option<String>,
}

#[derive(Serialize)]
pub struct KillResult {
    pub success: bool,
    pub message: String,
}

/// Parse `lsof -n -P -iTCP -sTCP:LISTEN` output into ListeningPort list.
fn parse_lsof_output(stdout: &str) -> Vec<ListeningPort> {
    let mut ports = Vec::new();
    let mut seen: HashSet<(u32, u32)> = HashSet::new();

    for line in stdout.lines().skip(1) {
        // lsof columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        let process_name = parts[0].to_string();
        let pid: u32 = match parts[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // NAME field (index 8) looks like "*:3000", "127.0.0.1:5432", "[::]:8080"
        let name_field = parts[8];

        // Strip IPv6 brackets if present for the address part
        let (addr_part, port_str) = if let Some(colon_pos) = name_field.rfind(':') {
            let addr = &name_field[..colon_pos];
            let port_raw = &name_field[colon_pos + 1..];
            (addr, port_raw)
        } else {
            continue;
        };

        let port: u32 = match port_str.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let local_address = if addr_part == "*" || addr_part == "[::" {
            "0.0.0.0".to_string()
        } else {
            addr_part.trim_start_matches('[').trim_end_matches(']').to_string()
        };

        let key = (pid, port);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);

        ports.push(ListeningPort {
            protocol: "tcp".to_string(),
            local_address,
            port,
            pid,
            process_name: process_name.clone(),
            command: Some(process_name),
        });
    }

    ports.sort_by_key(|p| p.port);
    ports
}

#[tauri::command]
pub fn get_listening_ports() -> Result<Vec<ListeningPort>, String> {
    let output = Command::new("lsof")
        .args(["-n", "-P", "-iTCP", "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_lsof_output(&stdout))
}

#[tauri::command]
pub fn kill_process(pid: u32) -> KillResult {
    // Try SIGTERM first
    let result = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output();

    match result {
        Ok(o) if o.status.success() => KillResult {
            success: true,
            message: format!("Process {} terminated", pid),
        },
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            KillResult {
                success: false,
                message: if stderr.is_empty() {
                    format!("kill returned exit code {}", o.status)
                } else {
                    stderr
                },
            }
        }
        Err(e) => KillResult {
            success: false,
            message: e.to_string(),
        },
    }
}

#[tauri::command]
pub fn open_url_in_browser(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}
