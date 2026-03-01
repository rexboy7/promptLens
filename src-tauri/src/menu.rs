use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Runtime;

pub fn build_menu<R: Runtime>(app: &tauri::App<R>) -> Result<Menu<R>, tauri::Error> {
    let app_name = app.package_info().name.clone();
    let about = MenuItem::with_id(app, "about", "About...", true, Option::<&str>::None)?;
    let shortcuts = MenuItem::with_id(app, "shortcuts", "Shortcuts", true, Option::<&str>::None)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, Option::<&str>::None)?;
    let app_submenu = Submenu::with_items(
        app,
        app_name,
        true,
        &[
            &about,
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &exit,
        ],
    )?;

    let open_folder =
        MenuItem::with_id(app, "open_folder", "Open Folder...", true, Option::<&str>::None)?;
    let rescan = MenuItem::with_id(app, "rescan", "Rescan", true, Option::<&str>::None)?;
    let recent_empty = MenuItem::with_id(
        app,
        "recent_none",
        "No Recent Folders",
        false,
        Option::<&str>::None,
    )?;
    let recent_submenu = Submenu::with_items(
        app,
        "Recent Folders",
        true,
        &[&recent_empty],
    )?;
    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[&open_folder, &rescan, &recent_submenu],
    )?;

    let random_image = MenuItem::with_id(
        app,
        "random_image",
        "Random Image",
        true,
        Option::<&str>::None,
    )?;
    let random_any =
        MenuItem::with_id(app, "random_any", "Random Any", true, Option::<&str>::None)?;
    let slideshow =
        MenuItem::with_id(app, "slideshow", "Slideshow", true, Option::<&str>::None)?;
    let slideshow_any = MenuItem::with_id(
        app,
        "slideshow_any",
        "Slideshow Any",
        true,
        Option::<&str>::None,
    )?;
    let fullscreen = MenuItem::with_id(
        app,
        "fullscreen",
        "Full screen",
        true,
        Option::<&str>::None,
    )?;
    let browse_submenu = Submenu::with_items(
        app,
        "Browse",
        true,
        &[
            &random_image,
            &random_any,
            &slideshow,
            &slideshow_any,
            &PredefinedMenuItem::separator(app)?,
            &fullscreen,
        ],
    )?;

    let delete_image = MenuItem::with_id(
        app,
        "delete_image",
        "Delete Current Image",
        true,
        Option::<&str>::None,
    )?;
    let delete_group = MenuItem::with_id(
        app,
        "delete_group",
        "Delete Current Group",
        true,
        Option::<&str>::None,
    )?;
    let mark_group_read = MenuItem::with_id(
        app,
        "mark_group_read",
        "Mark Group as Read",
        true,
        Option::<&str>::None,
    )?;
    let mark_group_unread = MenuItem::with_id(
        app,
        "mark_group_unread",
        "Mark Group as Unread",
        true,
        Option::<&str>::None,
    )?;
    let score_up = MenuItem::with_id(
        app,
        "score_up",
        "Score Up",
        true,
        Option::<&str>::None,
    )?;
    let score_down = MenuItem::with_id(
        app,
        "score_down",
        "Score Down",
        true,
        Option::<&str>::None,
    )?;
    let start_ranking =
        MenuItem::with_id(app, "start_ranking", "Start Ranking", true, Option::<&str>::None)?;
    let start_sequential_ranking = MenuItem::with_id(
        app,
        "start_sequential_ranking",
        "Start Sequential Ranking",
        true,
        Option::<&str>::None,
    )?;
    let edit_submenu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &mark_group_read,
            &mark_group_unread,
            &score_up,
            &score_down,
            &PredefinedMenuItem::separator(app)?,
            &delete_image,
            &delete_group,
            &PredefinedMenuItem::separator(app)?,
            &start_ranking,
            &start_sequential_ranking,
        ],
    )?;

    Menu::with_items(app, &[&app_submenu, &file_submenu, &browse_submenu, &edit_submenu])
}
