mod db;
mod delete;
mod indexer;
mod menu;
mod prompts;
mod queries;
mod ratings;
mod types;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            indexer::scan_directory,
            queries::list_groups,
            queries::list_images,
            delete::delete_image,
            delete::delete_group,
            ratings::get_ratings,
            ratings::submit_comparison,
            ratings::set_group_rating,
            ratings::get_rating_percentiles
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
