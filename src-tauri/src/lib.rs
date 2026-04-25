pub mod activity_tracker;
pub mod clipboard;
pub mod env_detector;
pub mod local_ports;
pub mod memory_analyzer;
pub mod navigation;
pub mod settings;
pub mod vault;
pub mod visual_recall;

use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
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
            navigation::try_migrate(app.handle());
            settings::try_migrate_user_data(app.handle());

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            clipboard::clipboard_get_image_data,
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
            vault::vault_import_from_super_dashboard,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
}
