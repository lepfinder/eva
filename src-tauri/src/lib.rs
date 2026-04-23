pub mod clipboard;
pub mod env_detector;
pub mod local_ports;
pub mod memory_analyzer;
pub mod navigation;
pub mod settings;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            // Initialise clipboard service (creates DB, seeds last state, starts polling)
            let clipboard_state = clipboard::init(app.handle());
            app.manage(clipboard_state);

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
