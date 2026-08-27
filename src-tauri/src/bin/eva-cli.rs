use clap::{Args, Parser, Subcommand};
use eva_lib::activity_tracker;
use eva_lib::clipboard;
use eva_lib::env_detector;
use eva_lib::local_ports;
use eva_lib::memory_analyzer;
use eva_lib::visual_recall;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;

/// EVA CLI — Agent-oriented Desktop Intelligence & Context CLI
#[derive(Parser, Debug)]
#[command(name = "eva-cli", version = "0.1.2", about = "EVA Desktop Context & Intelligence CLI for AI Agents")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Output compact single-line JSON instead of pretty-printed JSON
    #[arg(long, global = true)]
    compact: bool,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Get an all-in-one snapshot of the current user & desktop context (Active window, latest clip, dev ports, stats)
    Context,

    /// Query desktop activity tracking logs and productivity stats
    Activity(ActivityArgs),

    /// Query or manipulate clipboard history
    Clipboard(ClipboardArgs),

    /// Detect installed developer environment toolchains (Node, Rust, Python, Docker, Git, etc.)
    Env(EnvArgs),

    /// Scan local listening ports and processes
    Ports(PortsArgs),

    /// Inspect system memory and top memory-consuming processes
    Memory(MemoryArgs),

    /// Query Visual Recall (screen snapshots timeline)
    Recall(RecallArgs),

    /// Start the local HTTP REST API server
    Serve(ServeArgs),
}

#[derive(Args, Debug)]
struct ServeArgs {
    /// Port to listen on (default: 14220)
    #[arg(short, long, default_value_t = 14220)]
    port: u16,

    /// Bearer token for authentication (default: eva-local-token)
    #[arg(short, long, default_value = "eva-local-token")]
    token: String,

    /// Disable Bearer token authentication (allow open localhost access)
    #[arg(long, default_value_t = false)]
    no_auth: bool,
}

// ──────────────────────────────────────────────────
// Command Arguments
// ──────────────────────────────────────────────────

#[derive(Args, Debug)]
struct ActivityArgs {
    #[command(subcommand)]
    command: ActivityCommands,
}

#[derive(Subcommand, Debug)]
enum ActivityCommands {
    /// Get the current frontmost application and active window
    Current,
    /// Get today's activity stats (duration per app, category distribution, total time)
    Today {
        /// Date string in YYYY-MM-DD format (defaults to today)
        #[arg(short, long)]
        date: Option<String>,
    },
    /// Query historical activity logs
    Logs {
        /// Date string in YYYY-MM-DD format (defaults to today)
        #[arg(short, long)]
        date: Option<String>,
        /// Max number of records to return (default: 50)
        #[arg(short, long, default_value_t = 50)]
        limit: i64,
        /// Filter by specific application name
        #[arg(short, long)]
        app: Option<String>,
    },
}

#[derive(Args, Debug)]
struct ClipboardArgs {
    #[command(subcommand)]
    command: ClipboardCommands,
}

#[derive(Subcommand, Debug)]
enum ClipboardCommands {
    /// Get the latest clipboard content
    Latest,
    /// List clipboard history items
    List {
        /// Max number of items to return (default: 20)
        #[arg(short, long, default_value_t = 20)]
        limit: i64,
        /// Offset for pagination
        #[arg(short, long, default_value_t = 0)]
        offset: i64,
        /// Filter by date in YYYY-MM-DD format
        #[arg(short, long)]
        date: Option<String>,
    },
    /// Search clipboard history by keyword
    Search {
        /// Search keyword
        query: String,
        /// Max number of items to return (default: 20)
        #[arg(short, long, default_value_t = 20)]
        limit: i64,
        /// Filter by date in YYYY-MM-DD format
        #[arg(short, long)]
        date: Option<String>,
    },
}

#[derive(Args, Debug)]
struct EnvArgs {
    #[command(subcommand)]
    command: EnvCommands,
}

#[derive(Subcommand, Debug)]
enum EnvCommands {
    /// Detect all installed toolchains and runtime versions
    Detect,
}

#[derive(Args, Debug)]
struct PortsArgs {
    #[command(subcommand)]
    command: PortsCommands,
}

#[derive(Subcommand, Debug)]
enum PortsCommands {
    /// List all listening TCP ports and corresponding processes
    List,
    /// Terminate process by PID
    Kill {
        /// PID of the process to kill
        pid: u32,
    },
}

#[derive(Args, Debug)]
struct MemoryArgs {
    #[command(subcommand)]
    command: MemoryCommands,
}

#[derive(Subcommand, Debug)]
enum MemoryCommands {
    /// Get system memory usage and top memory-consuming applications
    List {
        /// Limit top N application groups (default: 10)
        #[arg(short, long, default_value_t = 10)]
        top: usize,
    },
}

#[derive(Args, Debug)]
struct RecallArgs {
    #[command(subcommand)]
    command: RecallCommands,
}

#[derive(Subcommand, Debug)]
enum RecallCommands {
    /// Query screen snapshots timeline
    Query {
        /// Max number of snapshots to return (default: 20)
        #[arg(short, long, default_value_t = 20)]
        limit: i64,
    },
}

// ──────────────────────────────────────────────────
// Context Snapshot Data Types
// ──────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveWindowContext {
    app_name: String,
    window_title: String,
    project_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TodayProductivityContext {
    date: String,
    total_minutes: i64,
    top_apps: Vec<activity_tracker::AppStat>,
    categories: Vec<activity_tracker::CategoryStat>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopContextSnapshot {
    timestamp: i64,
    active_window: Option<ActiveWindowContext>,
    today_productivity: TodayProductivityContext,
    latest_clipboard: Option<clipboard::ClipboardItem>,
    listening_ports: Vec<local_ports::ListeningPort>,
}

// ──────────────────────────────────────────────────
// Path Resolution
// ──────────────────────────────────────────────────

fn get_user_data_dir() -> PathBuf {
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
    // Default fallback to standard path
    dirs::data_dir()
        .map(|d| d.join("com.xiyangxie.eva").join("userData"))
        .unwrap_or_else(|| PathBuf::from("./userData"))
}

fn open_sqlite_db(filename: &str) -> Option<Connection> {
    let db_path = get_user_data_dir().join(filename);
    if !db_path.exists() {
        return None;
    }
    Connection::open(&db_path).ok()
}

// ──────────────────────────────────────────────────
// Output Formatter
// ──────────────────────────────────────────────────

fn output_json<T: Serialize>(value: &T, compact: bool) {
    if compact {
        if let Ok(s) = serde_json::to_string(value) {
            println!("{}", s);
        }
    } else {
        if let Ok(s) = serde_json::to_string_pretty(value) {
            println!("{}", s);
        }
    }
}

// ──────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();
    let compact = cli.compact;

    match cli.command {
        Commands::Context => {
            let active = activity_tracker::get_active_window().map(|(app, title, proj)| {
                ActiveWindowContext {
                    app_name: app,
                    window_title: title,
                    project_name: proj,
                }
            });

            let today_str = activity_tracker::chrono_date_str(activity_tracker::now_ms());
            let (total_dur, top_apps, categories) = if let Some(conn) = open_sqlite_db("activity-tracker.db") {
                let total = activity_tracker::db_get_total_duration(&conn, &today_str);
                let apps = activity_tracker::db_get_app_stats(&conn, &today_str);
                let cats = activity_tracker::db_get_category_stats(&conn, &today_str);
                (total, apps, cats)
            } else {
                (0, vec![], vec![])
            };

            let latest_clip = if let Some(conn) = open_sqlite_db("clipboard-history.db") {
                activity_tracker::now_ms();
                clipboard::db_get_items(&conn, 1, 0, None).into_iter().next()
            } else {
                None
            };

            let ports = local_ports::get_listening_ports().unwrap_or_default();

            let snapshot = DesktopContextSnapshot {
                timestamp: activity_tracker::now_ms(),
                active_window: active,
                today_productivity: TodayProductivityContext {
                    date: today_str,
                    total_minutes: total_dur / 60,
                    top_apps: top_apps.into_iter().take(5).collect(),
                    categories,
                },
                latest_clipboard: latest_clip,
                listening_ports: ports,
            };

            output_json(&snapshot, compact);
        }

        Commands::Activity(act) => match act.command {
            ActivityCommands::Current => {
                let active = activity_tracker::get_active_window().map(|(app, title, proj)| {
                    ActiveWindowContext {
                        app_name: app,
                        window_title: title,
                        project_name: proj,
                    }
                });
                output_json(&active, compact);
            }
            ActivityCommands::Today { date } => {
                let date_str = date.unwrap_or_else(|| activity_tracker::chrono_date_str(activity_tracker::now_ms()));
                if let Some(conn) = open_sqlite_db("activity-tracker.db") {
                    let total_dur = activity_tracker::db_get_total_duration(&conn, &date_str);
                    let apps = activity_tracker::db_get_app_stats(&conn, &date_str);
                    let categories = activity_tracker::db_get_category_stats(&conn, &date_str);
                    let projects = activity_tracker::db_get_project_stats(&conn, &date_str);

                    #[derive(Serialize)]
                    #[serde(rename_all = "camelCase")]
                    struct TodayStatsOutput {
                        date: String,
                        total_seconds: i64,
                        total_minutes: i64,
                        apps: Vec<activity_tracker::AppStat>,
                        categories: Vec<activity_tracker::CategoryStat>,
                        projects: Vec<activity_tracker::ProjectStat>,
                    }

                    let output = TodayStatsOutput {
                        date: date_str,
                        total_seconds: total_dur,
                        total_minutes: total_dur / 60,
                        apps,
                        categories,
                        projects,
                    };
                    output_json(&output, compact);
                } else {
                    eprintln!("Error: Cannot open activity-tracker.db");
                    std::process::exit(1);
                }
            }
            ActivityCommands::Logs { date, limit, app } => {
                let date_str = date.unwrap_or_else(|| activity_tracker::chrono_date_str(activity_tracker::now_ms()));
                if let Some(conn) = open_sqlite_db("activity-tracker.db") {
                    let logs = activity_tracker::db_get_logs(&conn, &date_str, limit, app.as_deref());
                    output_json(&logs, compact);
                } else {
                    eprintln!("Error: Cannot open activity-tracker.db");
                    std::process::exit(1);
                }
            }
        },

        Commands::Clipboard(clip) => match clip.command {
            ClipboardCommands::Latest => {
                let live_text = arboard::Clipboard::new().ok().and_then(|mut cb| cb.get_text().ok());
                let db_item = open_sqlite_db("clipboard-history.db")
                    .and_then(|conn| clipboard::db_get_items(&conn, 1, 0, None).into_iter().next());

                #[derive(Serialize)]
                #[serde(rename_all = "camelCase")]
                struct LatestClipOutput {
                    live_text: Option<String>,
                    latest_history_item: Option<clipboard::ClipboardItem>,
                }

                output_json(&LatestClipOutput {
                    live_text,
                    latest_history_item: db_item,
                }, compact);
            }
            ClipboardCommands::List { limit, offset, date } => {
                if let Some(conn) = open_sqlite_db("clipboard-history.db") {
                    let items = clipboard::db_get_items(&conn, limit, offset, date.as_deref());
                    output_json(&items, compact);
                } else {
                    eprintln!("Error: Cannot open clipboard-history.db");
                    std::process::exit(1);
                }
            }
            ClipboardCommands::Search { query, limit, date } => {
                if let Some(conn) = open_sqlite_db("clipboard-history.db") {
                    let items = clipboard::db_search_items(&conn, &query, limit, date.as_deref());
                    output_json(&items, compact);
                } else {
                    eprintln!("Error: Cannot open clipboard-history.db");
                    std::process::exit(1);
                }
            }
        },

        Commands::Env(env) => match env.command {
            EnvCommands::Detect => {
                let tools = env_detector::detect_all_tools(None);
                output_json(&tools, compact);
            }
        },

        Commands::Ports(ports) => match ports.command {
            PortsCommands::List => {
                let list = local_ports::get_listening_ports().unwrap_or_default();
                output_json(&list, compact);
            }
            PortsCommands::Kill { pid } => {
                let result = local_ports::kill_process(pid);
                output_json(&result, compact);
            }
        },

        Commands::Memory(mem) => match mem.command {
            MemoryCommands::List { top } => {
                match memory_analyzer::get_memory_analysis() {
                    Ok(mut res) => {
                        res.apps.truncate(top);
                        output_json(&res, compact);
                    }
                    Err(e) => {
                        eprintln!("Error: {}", e);
                        std::process::exit(1);
                    }
                }
            }
        },

        Commands::Recall(recall) => match recall.command {
            RecallCommands::Query { limit } => {
                let user_data = get_user_data_dir();
                let now = activity_tracker::now_ms();
                let start = now - 7 * 86400 * 1000; // last 7 days
                let snapshots = visual_recall::db_query_by_time_range(&user_data, start, now, limit);
                output_json(&snapshots, compact);
            }
        },

        Commands::Serve(serve) => {
            println!("Starting EVA Local HTTP REST API Server on http://127.0.0.1:{}", serve.port);
            if serve.no_auth {
                println!("Authentication: Disabled (Open Localhost Access)");
            } else {
                println!("Bearer Token: {}", serve.token);
            }
            println!("Health endpoint: http://127.0.0.1:{}/api/health", serve.port);
            eva_lib::http_server::start_standalone_server(serve.port, serve.token, !serve.no_auth);
            // Block main thread
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
    }
}
