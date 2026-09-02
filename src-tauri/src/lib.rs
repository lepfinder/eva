pub mod activity_tracker;
pub mod ai;
pub mod clipboard;
pub mod env_detector;
pub mod http_server;
pub mod local_ports;
pub mod memory_analyzer;
pub mod navigation;
pub mod settings;
pub mod vault;
pub mod visual_recall;
pub mod service_manager;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};

static LAST_TRAY_CLICK_MS: AtomicU64 = AtomicU64::new(0);

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    if let Some(tray_win) = app.get_webview_window("tray-receipt") {
        let _ = tray_win.hide();
    }
}

#[tauri::command]
fn tray_hide_receipt_window(app: tauri::AppHandle) {
    if let Some(tray_win) = app.get_webview_window("tray-receipt") {
        let _ = tray_win.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "tray-receipt" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }

            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }

            if let WindowEvent::Focused(true) = event {
                let app = window.app_handle();
                let state = app.state::<clipboard::SharedClipboardState>();
                clipboard::emit_clipboard_url_if_present(&app, state.inner());
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Initialise clipboard service
            let clipboard_state = clipboard::init(app.handle());
            app.manage(clipboard_state);

            // Initialise activity tracker (creates DB, starts polling)
            let activity_state = activity_tracker::init(app.handle());
            app.manage(activity_state);

            // Initialise vault
            let vault_state = vault::init(app.handle());
            app.manage(vault_state);

            // Initialise visual recall
            let vr_state = visual_recall::init(app.handle());
            app.manage(vr_state);

            // Initialise local HTTP API server
            let http_state = http_server::init(app.handle());
            app.manage(http_state);

            // Initialise Tray Icon for Time Receipt
            let show_receipt_item = MenuItem::with_id(app, "show_receipt", "🧾 查看时间小票", true, None::<&str>)?;
            let open_main_item = MenuItem::with_id(app, "open_main", "💻 打开 EVA 主界面", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "❌ 退出 EVA", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_receipt_item, &open_main_item, &quit_item])?;

            let tray_icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("main_tray")
                .tooltip("EVA - 时间小票")
                .menu(&tray_menu)
                .show_menu_on_left_click(false);

            if let Some(icon) = tray_icon {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_receipt" => {
                        if let Some(win) = app.get_webview_window("tray-receipt") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "open_main" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        LAST_TRAY_CLICK_MS.store(now_millis(), Ordering::Relaxed);
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("tray-receipt") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let win_width = 360.0;
                                let scale_factor = win.scale_factor().unwrap_or(2.0);
                                let pos = rect.position.to_logical::<f64>(scale_factor);
                                let size = rect.size.to_logical::<f64>(scale_factor);

                                let x = pos.x + (size.width / 2.0) - (win_width / 2.0);
                                let y = pos.y + size.height + 4.0;

                                let _ = win.set_position(tauri::LogicalPosition::new(x, y));
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_main_window,
            tray_hide_receipt_window,
            // Navigation
            navigation::get_navigation_data,
            navigation::save_navigation_data,
            navigation::get_navigation_data_dir,
            navigation::get_nav_icon_data,
            navigation::get_icon_list,
            navigation::delete_icon,
            navigation::delete_icons,
            navigation::add_navigation_item,
            navigation::update_navigation_item,
            navigation::remove_navigation_item,
            navigation::move_navigation_item,
            navigation::add_category,
            navigation::update_category,
            navigation::remove_category,
            navigation::reorder_categories,
            navigation::add_sub_category,
            navigation::update_sub_category,
            navigation::remove_sub_category,
            navigation::reorder_sub_categories,
            navigation::fetch_site_info,
            navigation::download_favicon,
            navigation::open_nav_link_in_browser,
            navigation::import_navigation_data,
            // Settings / Storage
            settings::get_data_dir,
            settings::get_storage_stats,
            settings::open_in_finder,
            // HTTP API Server Settings
            http_server::http_server_get_config,
            http_server::http_server_save_config,
            http_server::http_server_generate_token,
            http_server::http_server_test_connection,
            // AI Proxy
            ai::ai_chat_completion,
            // LocalPorts
            local_ports::get_listening_ports,
            local_ports::kill_process,
            local_ports::open_url_in_browser,
            // EnvDetector
            env_detector::env_detect,
            env_detector::env_save_description,
            // MemoryAnalyzer
            memory_analyzer::get_memory_analysis,
            // Clipboard
            clipboard::clipboard_get_items,
            clipboard::clipboard_search_items,
            clipboard::clipboard_delete_item,
            clipboard::clipboard_clear_all,
            clipboard::clipboard_write_to_clipboard,
            clipboard::clipboard_get_stats,
            clipboard::clipboard_get_daily_stats,
            clipboard::clipboard_get_image_data,
            clipboard::clipboard_write_image_data,
            // ActivityTracker
            activity_tracker::activity_get_today_stats,
            activity_tracker::activity_get_today_logs,
            activity_tracker::activity_get_today_total_duration,
            activity_tracker::activity_get_stats_by_category,
            activity_tracker::activity_get_stats_by_project,
            activity_tracker::activity_get_today_logs_count,
            activity_tracker::activity_get_daily_summary,
            activity_tracker::activity_update_remark,
            activity_tracker::activity_classify_now,
            activity_tracker::activity_get_unclassified_batch,
            activity_tracker::activity_apply_ai_classification,
            activity_tracker::activity_generate_summary,
            activity_tracker::activity_get_heatmap_data,
            activity_tracker::activity_rebuild_daily_stats,
            // Vault
            vault::vault_can_use_biometric,
            vault::vault_unlock,
            vault::vault_has_password,
            vault::vault_unlock_with_password,
            vault::vault_set_password,
            vault::vault_lock,
            vault::vault_save,
            vault::vault_set_content_protection,
            vault::vault_unlock_with_biometric,
            vault::vault_prompt_biometric,
            // VisualRecall
            visual_recall::visual_recall_get_config,
            visual_recall::visual_recall_set_enabled,
            visual_recall::visual_recall_update_config,
            visual_recall::visual_recall_search_snapshots,
            visual_recall::visual_recall_get_storage_stats,
            visual_recall::visual_recall_cleanup,
            visual_recall::visual_recall_get_image_data,
            // Local Services
            service_manager::service_list,
            service_manager::service_status,
            service_manager::service_start,
            service_manager::service_stop,
            service_manager::service_restart,
            service_manager::service_open,
            service_manager::service_open_in_ide,
            service_manager::service_detect_ides,
            service_manager::service_tail_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                // 如果最近 800ms 内点击过托盘图标，说明是托盘激活而非点击 Dock 栏，不自动打开主界面
                let last_click = LAST_TRAY_CLICK_MS.load(Ordering::Relaxed);
                let is_from_tray = now_millis().saturating_sub(last_click) < 800;

                if !is_from_tray {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
