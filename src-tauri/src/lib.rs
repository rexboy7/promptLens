mod commands;
mod db;
mod menu;
mod prompts;
mod types;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::indexer::scan_directory,
            commands::queries::list_groups,
            commands::queries::list_images,
            commands::delete::delete_image,
            commands::delete::delete_group,
            commands::ratings::get_ratings,
            commands::ratings::submit_comparison,
            commands::ratings::set_group_rating,
            commands::ratings::get_rating_percentiles,
            commands::fix_batches::fix_batches
        ])
        .setup(|app| {
            let menu = menu::build_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id();
            if id.as_ref() == "exit" {
                app.exit(0);
                return;
            }
            let window = app.get_webview_window("main");
            if let Some(window) = window {
                let _ = window.emit("menu-action", id.as_ref());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
