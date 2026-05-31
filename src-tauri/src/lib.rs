use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

const DESKTOP_OPEN_PATHS_EVENT: &str = "desktop-open-paths";

#[derive(Default)]
struct InitialOpenPaths(Mutex<Vec<String>>);

#[derive(Serialize, Clone)]
struct DesktopFileEntry {
    path: String,
    filename: String,
    display_path: Option<String>,
    relative_path: Option<String>,
    file_size_bytes: u64,
}

#[derive(Serialize)]
struct DesktopFileBytes {
    path: String,
    filename: String,
    display_path: Option<String>,
    relative_path: Option<String>,
    file_size_bytes: u64,
    bytes: Vec<u8>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(InitialOpenPaths(Mutex::new(collect_exr_open_paths(
            std::env::args_os().skip(1),
        ))))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            let paths = collect_exr_open_paths(args);
            if !paths.is_empty() {
                let _ = app.emit(DESKTOP_OPEN_PATHS_EVENT, paths);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            read_exr_file,
            list_exr_folder,
            resolve_exr_paths,
            write_export_file,
            take_initial_open_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn read_exr_file(path: String) -> Result<DesktopFileBytes, String> {
    let entry = build_file_entry(Path::new(&path), None)?;
    let bytes =
        fs::read(&entry.path).map_err(|error| format!("Failed to read EXR file: {error}"))?;
    Ok(DesktopFileBytes {
        path: entry.path,
        filename: entry.filename,
        display_path: entry.display_path,
        relative_path: entry.relative_path,
        file_size_bytes: entry.file_size_bytes,
        bytes,
    })
}

#[tauri::command]
fn list_exr_folder(path: String) -> Result<Vec<DesktopFileEntry>, String> {
    list_exr_folder_entries(Path::new(&path))
}

#[tauri::command]
fn resolve_exr_paths(paths: Vec<String>) -> Result<Vec<DesktopFileEntry>, String> {
    let mut entries = Vec::new();
    for path in paths {
        let path = PathBuf::from(path);
        if path.is_dir() {
            entries.extend(list_exr_folder_entries(&path)?);
        } else if path.is_file() && is_exr_path(&path) {
            entries.push(build_file_entry(&path, None)?);
        } else if !path.exists() {
            return Err("File does not exist.".to_string());
        }
    }
    sort_entries(&mut entries);
    Ok(entries)
}

#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let output_path = PathBuf::from(path);
    let extension = output_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("png") && !extension.eq_ignore_ascii_case("zip") {
        return Err("Export path must end with .png or .zip.".to_string());
    }

    let parent = output_path
        .parent()
        .ok_or_else(|| "Export path has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("Export parent directory does not exist.".to_string());
    }

    fs::write(&output_path, bytes).map_err(|error| format!("Failed to write export file: {error}"))
}

#[tauri::command]
fn take_initial_open_paths(
    state: tauri::State<'_, InitialOpenPaths>,
) -> Result<Vec<String>, String> {
    let mut paths = state
        .0
        .lock()
        .map_err(|_| "Failed to read initial open paths.".to_string())?;
    Ok(std::mem::take(&mut *paths))
}

fn collect_exr_open_paths<I, P>(paths: I) -> Vec<String>
where
    I: IntoIterator<Item = P>,
    P: Into<PathBuf>,
{
    paths
        .into_iter()
        .map(Into::into)
        .filter(|path| path.is_file() && is_exr_path(path))
        .filter_map(|path| path.canonicalize().ok())
        .map(path_to_string)
        .collect()
}

fn list_exr_folder_entries(path: &Path) -> Result<Vec<DesktopFileEntry>, String> {
    let root = path
        .canonicalize()
        .map_err(|_| "Folder does not exist.".to_string())?;
    if !root.is_dir() {
        return Err("Path is not a folder.".to_string());
    }

    let mut entries = Vec::new();
    collect_exr_entries_recursive(&root, &root, &mut entries)?;
    sort_entries(&mut entries);
    Ok(entries)
}

fn collect_exr_entries_recursive(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<DesktopFileEntry>,
) -> Result<(), String> {
    let read_dir = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read folder {}: {error}", directory.display()))?;
    for item in read_dir {
        let item = item.map_err(|error| format!("Failed to read folder entry: {error}"))?;
        let path = item.path();
        if path.is_dir() {
            collect_exr_entries_recursive(root, &path, entries)?;
            continue;
        }
        if path.is_file() && is_exr_path(&path) {
            entries.push(build_file_entry(&path, Some(root))?);
        }
    }
    Ok(())
}

fn build_file_entry(path: &Path, root: Option<&Path>) -> Result<DesktopFileEntry, String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|_| "File does not exist.".to_string())?;
    if !canonical_path.is_file() {
        return Err("Path is not a file.".to_string());
    }
    if !is_exr_path(&canonical_path) {
        return Err("File is not an OpenEXR .exr file.".to_string());
    }

    let metadata = fs::metadata(&canonical_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    let filename = canonical_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("image.exr")
        .to_string();
    let relative_path = root.and_then(|root_path| {
        canonical_path
            .strip_prefix(root_path)
            .ok()
            .map(path_to_relative_string)
    });

    Ok(DesktopFileEntry {
        path: path_to_string(canonical_path),
        filename,
        display_path: Some(path_to_string(path)),
        relative_path,
        file_size_bytes: metadata.len(),
    })
}

fn sort_entries(entries: &mut [DesktopFileEntry]) {
    entries.sort_by(|left, right| {
        let left_key = left
            .relative_path
            .as_deref()
            .or(left.display_path.as_deref())
            .unwrap_or(&left.filename)
            .to_lowercase();
        let right_key = right
            .relative_path
            .as_deref()
            .or(right.display_path.as_deref())
            .unwrap_or(&right.filename)
            .to_lowercase();
        left_key.cmp(&right_key)
    });
}

fn is_exr_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exr"))
}

fn path_to_relative_string(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}
