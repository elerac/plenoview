mod desktop_error;
mod desktop_io;
mod desktop_window_state;

use desktop_error::DesktopResult;
use desktop_io::{DesktopFileEntry, DesktopRecentFile, DesktopState, ExportSaveResult};
use desktop_window_state::DesktopWindowStateTracker;
use tauri::{ipc::Response, AppHandle, Manager};

const DESKTOP_OPEN_PATHS_EVENT: &str = "desktop-open-paths";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(DesktopState::with_initial_open_paths(
            desktop_io::collect_exr_open_paths(std::env::args_os().skip(1)),
        ))
        .manage(DesktopWindowStateTracker::default())
        .setup(|app| {
            desktop_window_state::restore_main_window(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if desktop_window_state::is_main_window(window.label()) {
                let tracker = window.app_handle().state::<DesktopWindowStateTracker>();
                tracker.record_window_event(window, event);
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            desktop_io::emit_open_paths(
                app,
                desktop_io::collect_exr_open_paths(args),
                DESKTOP_OPEN_PATHS_EVENT,
            );
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            open_exr_files_dialog,
            open_exr_folder_dialog,
            resolve_exr_paths,
            read_exr_file,
            save_export_file,
            get_recent_files,
            record_recent_file,
            open_recent_file,
            remove_recent_file,
            clear_recent_files,
            take_initial_open_entries
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => {
            desktop_window_state::save_main_window_state(app_handle);
        }
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            desktop_io::emit_open_paths(app_handle, paths, DESKTOP_OPEN_PATHS_EVENT);
        }
        _ => {}
    });
}

#[tauri::command]
async fn open_exr_files_dialog(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    desktop_io::open_exr_files_dialog(&app, &state)
}

#[tauri::command]
async fn open_exr_folder_dialog(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    desktop_io::open_exr_folder_dialog(&app, &state)
}

#[tauri::command]
fn resolve_exr_paths(
    paths: Vec<String>,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    desktop_io::resolve_paths(paths, &state)
}

#[tauri::command]
fn read_exr_file(
    grant_id: String,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Response> {
    desktop_io::read_grant_file(grant_id, &state)
}

#[tauri::command]
async fn save_export_file(
    app: AppHandle,
    filename: String,
    title: Option<String>,
    extensions: Vec<String>,
    bytes: Vec<u8>,
) -> DesktopResult<ExportSaveResult> {
    desktop_io::save_export_file(&app, filename, title, extensions, bytes)
}

#[tauri::command]
fn get_recent_files(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    desktop_io::get_recent_files(&app, &state)
}

#[tauri::command]
fn record_recent_file(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    grant_id: String,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    desktop_io::record_recent_file(&app, &state, grant_id)
}

#[tauri::command]
fn open_recent_file(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    path: String,
) -> DesktopResult<DesktopFileEntry> {
    desktop_io::open_recent_file(&app, &state, path)
}

#[tauri::command]
fn remove_recent_file(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    path: String,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    desktop_io::remove_recent_file(&app, &state, path)
}

#[tauri::command]
fn clear_recent_files(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    desktop_io::clear_recent_files(&app, &state)
}

#[tauri::command]
fn take_initial_open_entries(
    state: tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    desktop_io::take_initial_open_entries(&state)
}
