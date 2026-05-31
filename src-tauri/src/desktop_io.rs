use crate::desktop_error::{DesktopError, DesktopErrorCode, DesktopResult};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Response, AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tempfile::NamedTempFile;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FOLDER_EXR_COUNT: usize = 250;
const MAX_FOLDER_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FOLDER_DEPTH: usize = 32;
const RECENT_FILES_LIMIT: usize = 12;
const RECENT_FILES_FILENAME: &str = "recent-files.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFileEntry {
    pub grant_id: String,
    pub path: String,
    pub filename: String,
    pub display_path: Option<String>,
    pub relative_path: Option<String>,
    pub file_size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRecentFile {
    pub path: String,
    pub label: String,
    pub display_path: String,
    pub opened_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveResult {
    pub status: ExportSaveStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportSaveStatus {
    Saved,
    Cancelled,
}

#[derive(Default)]
pub struct DesktopState {
    grants: Mutex<GrantRegistry>,
    initial_open_paths: Mutex<Vec<String>>,
    recents: Mutex<RecentStore>,
}

impl DesktopState {
    pub fn with_initial_open_paths(paths: Vec<String>) -> Self {
        Self {
            grants: Mutex::new(GrantRegistry::default()),
            initial_open_paths: Mutex::new(paths),
            recents: Mutex::new(RecentStore::default()),
        }
    }
}

#[derive(Debug, Clone)]
struct FileEntry {
    path: PathBuf,
    display_path: Option<String>,
    relative_path: Option<String>,
    filename: String,
    file_size_bytes: u64,
}

#[derive(Debug, Clone)]
struct GrantEntry {
    id: String,
    entry: FileEntry,
}

#[derive(Default)]
struct GrantRegistry {
    next_id: u64,
    by_id: HashMap<String, GrantEntry>,
    by_path: HashMap<PathBuf, String>,
}

impl GrantRegistry {
    fn register(&mut self, entry: FileEntry) -> DesktopFileEntry {
        if let Some(grant_id) = self.by_path.get(&entry.path) {
            if let Some(existing) = self.by_id.get(grant_id) {
                return existing.to_desktop_entry();
            }
        }

        self.next_id += 1;
        let grant_id = format!("grant-{}", self.next_id);
        let grant_entry = GrantEntry {
            id: grant_id.clone(),
            entry,
        };
        let desktop_entry = grant_entry.to_desktop_entry();
        self.by_path
            .insert(grant_entry.entry.path.clone(), grant_id.clone());
        self.by_id.insert(grant_id, grant_entry);
        desktop_entry
    }

    fn get(&self, grant_id: &str) -> DesktopResult<GrantEntry> {
        self.by_id.get(grant_id).cloned().ok_or_else(|| {
            DesktopError::permission_denied("The desktop file grant is no longer available.")
        })
    }
}

impl GrantEntry {
    fn to_desktop_entry(&self) -> DesktopFileEntry {
        DesktopFileEntry {
            grant_id: self.id.clone(),
            path: path_to_string(&self.entry.path),
            filename: self.entry.filename.clone(),
            display_path: self.entry.display_path.clone(),
            relative_path: self.entry.relative_path.clone(),
            file_size_bytes: self.entry.file_size_bytes,
        }
    }
}

#[derive(Default)]
struct RecentStore {
    loaded: bool,
    items: Vec<DesktopRecentFile>,
}

pub fn collect_exr_open_paths<I, P>(paths: I) -> Vec<String>
where
    I: IntoIterator<Item = P>,
    P: Into<OsString>,
{
    paths
        .into_iter()
        .filter_map(|path| normalize_input_path_os(path.into()).ok())
        .filter(|path| path.is_file() && is_exr_path(path))
        .filter_map(|path| path.canonicalize().ok())
        .map(path_to_string)
        .collect()
}

pub fn emit_open_paths(app: &AppHandle, paths: Vec<String>, event_name: &str) {
    if paths.is_empty() {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    let state = app.state::<DesktopState>();
    if let Ok(entries) = resolve_paths(paths, &state) {
        if !entries.is_empty() {
            let _ = app.emit(event_name, entries);
        }
    }
}

pub fn take_initial_open_entries(
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let paths = {
        let mut paths = state
            .initial_open_paths
            .lock()
            .map_err(|_| DesktopError::io("Failed to read initial open paths."))?;
        std::mem::take(&mut *paths)
    };
    resolve_paths(paths, state)
}

pub fn open_exr_files_dialog(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open OpenEXR Files")
        .add_filter("OpenEXR", &["exr"])
        .blocking_pick_files();
    let Some(paths) = selected else {
        return Ok(Vec::new());
    };
    resolve_file_paths(paths, state)
}

pub fn open_exr_folder_dialog(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let selected = app
        .dialog()
        .file()
        .set_title("Open Folder")
        .blocking_pick_folder();
    let Some(path) = selected else {
        return Ok(Vec::new());
    };
    let path = file_path_to_path_buf(path)?;
    list_folder(&path, state)
}

pub fn resolve_paths(
    paths: Vec<String>,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for raw_path in paths {
        let path = normalize_input_path(&raw_path)?;
        if path.is_dir() {
            for entry in list_folder_entries(&path)? {
                if seen.insert(entry.path.clone()) {
                    entries.push(entry);
                }
            }
            continue;
        }
        if !path.exists() {
            return Err(DesktopError::not_found("File does not exist."));
        }
        if !path.is_file() {
            return Err(DesktopError::not_file("Path is not a file."));
        }
        if !is_exr_path(&path) {
            return Err(DesktopError::not_exr("File is not an OpenEXR .exr file."));
        }
        let entry = build_file_entry(&path, None)?;
        if seen.insert(entry.path.clone()) {
            entries.push(entry);
        }
    }
    sort_file_entries(&mut entries);
    register_entries(entries, state)
}

pub fn list_folder(
    path: &Path,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    register_entries(list_folder_entries(path)?, state)
}

pub fn read_grant_file(
    grant_id: String,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Response> {
    let grant = {
        let grants = state
            .grants
            .lock()
            .map_err(|_| DesktopError::io("Failed to read desktop file grants."))?;
        grants.get(&grant_id)?
    };
    let entry = build_file_entry(&grant.entry.path, None)?;
    if entry.file_size_bytes > MAX_FILE_BYTES {
        return Err(DesktopError::too_large(format!(
            "EXR file is too large. Limit is {} bytes.",
            MAX_FILE_BYTES
        )));
    }
    let bytes = fs::read(&entry.path)
        .map_err(|error| DesktopError::from_io("Failed to read EXR file", error))?;
    Ok(Response::new(bytes))
}

pub fn save_export_file(
    app: &AppHandle,
    filename: String,
    title: Option<String>,
    extensions: Vec<String>,
    bytes: Vec<u8>,
) -> DesktopResult<ExportSaveResult> {
    let allowed_extensions = normalize_export_extensions(&extensions)?;
    let filter_name = allowed_extensions
        .iter()
        .map(|extension| extension.to_uppercase())
        .collect::<Vec<_>>()
        .join("/");
    let mut dialog = app.dialog().file().set_file_name(filename).add_filter(
        filter_name,
        &allowed_extensions
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>(),
    );
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }

    let Some(path) = dialog.blocking_save_file() else {
        return Ok(ExportSaveResult {
            status: ExportSaveStatus::Cancelled,
        });
    };
    let path = file_path_to_path_buf(path)?;
    validate_export_path(&path, &allowed_extensions)?;
    write_atomic(&path, &bytes)?;
    Ok(ExportSaveResult {
        status: ExportSaveStatus::Saved,
    })
}

pub fn get_recent_files(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    with_recents_read(app, state, |items| Ok(items.to_vec()))
}

pub fn record_recent_file(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
    grant_id: String,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    let grant = {
        let grants = state
            .grants
            .lock()
            .map_err(|_| DesktopError::io("Failed to read desktop file grants."))?;
        grants.get(&grant_id)?
    };
    with_recents_mut(app, state, |items| {
        let item = DesktopRecentFile {
            path: path_to_string(&grant.entry.path),
            label: grant.entry.filename.clone(),
            display_path: grant
                .entry
                .display_path
                .clone()
                .unwrap_or_else(|| path_to_string(&grant.entry.path)),
            opened_at: current_time_millis(),
        };
        items.retain(|existing| existing.path != item.path);
        items.insert(0, item);
        items.truncate(RECENT_FILES_LIMIT);
        Ok(items.to_vec())
    })
}

pub fn open_recent_file(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
    path: String,
) -> DesktopResult<DesktopFileEntry> {
    let recent_path = normalize_input_path(&path)?;
    let allowed = with_recents_read(app, state, |items| {
        Ok(items
            .iter()
            .any(|item| same_path_string(&item.path, &recent_path)))
    })?;
    if !allowed {
        return Err(DesktopError::permission_denied(
            "Recent file is not in the desktop recent list.",
        ));
    }

    match build_file_entry(&recent_path, None) {
        Ok(entry) => {
            let entries = register_entries(vec![entry], state)?;
            entries
                .into_iter()
                .next()
                .ok_or_else(|| DesktopError::not_found("Recent file is unavailable."))
        }
        Err(error)
            if matches!(
                error.code,
                DesktopErrorCode::NotFound | DesktopErrorCode::NotFile
            ) =>
        {
            let _ = remove_recent_file(app, state, path);
            Err(error)
        }
        Err(error) => Err(error),
    }
}

pub fn remove_recent_file(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
    path: String,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    with_recents_mut(app, state, |items| {
        items.retain(|item| item.path != path);
        Ok(items.to_vec())
    })
}

pub fn clear_recent_files(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopRecentFile>> {
    with_recents_mut(app, state, |items| {
        items.clear();
        Ok(Vec::new())
    })
}

fn resolve_file_paths(
    paths: Vec<FilePath>,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let paths = paths
        .into_iter()
        .map(file_path_to_path_buf)
        .collect::<DesktopResult<Vec<_>>>()?
        .into_iter()
        .map(path_to_string)
        .collect();
    resolve_paths(paths, state)
}

fn file_path_to_path_buf(path: FilePath) -> DesktopResult<PathBuf> {
    path.into_path()
        .map_err(|_| DesktopError::invalid_output("Selected path is not a local filesystem path."))
}

fn normalize_input_path(raw_path: &str) -> DesktopResult<PathBuf> {
    if raw_path.trim().is_empty() {
        return Err(DesktopError::not_found("Path is empty."));
    }
    if raw_path.starts_with("file://") {
        let url = tauri::Url::parse(raw_path)
            .map_err(|_| DesktopError::not_found("File URL is invalid."))?;
        return url
            .to_file_path()
            .map_err(|_| DesktopError::not_found("File URL is not a local path."));
    }
    Ok(PathBuf::from(raw_path))
}

fn normalize_input_path_os(raw_path: OsString) -> DesktopResult<PathBuf> {
    let path = PathBuf::from(&raw_path);
    if path.exists() {
        return Ok(path);
    }
    let raw = raw_path.to_string_lossy();
    normalize_input_path(&raw)
}

fn register_entries(
    entries: Vec<FileEntry>,
    state: &tauri::State<'_, DesktopState>,
) -> DesktopResult<Vec<DesktopFileEntry>> {
    let mut grants = state
        .grants
        .lock()
        .map_err(|_| DesktopError::io("Failed to update desktop file grants."))?;
    Ok(entries
        .into_iter()
        .map(|entry| grants.register(entry))
        .collect())
}

fn list_folder_entries(path: &Path) -> DesktopResult<Vec<FileEntry>> {
    let root = path
        .canonicalize()
        .map_err(|error| DesktopError::from_io("Folder does not exist", error))?;
    if !root.is_dir() {
        return Err(DesktopError::not_file("Path is not a folder."));
    }

    let mut entries = Vec::new();
    let mut visited = HashSet::new();
    collect_folder_recursive(&root, &root, 0, &mut visited, &mut entries)?;
    sort_file_entries(&mut entries);
    Ok(entries)
}

fn collect_folder_recursive(
    root: &Path,
    directory: &Path,
    depth: usize,
    visited: &mut HashSet<PathBuf>,
    entries: &mut Vec<FileEntry>,
) -> DesktopResult<()> {
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| DesktopError::from_io("Failed to inspect folder", error))?;
    if !visited.insert(canonical_directory.clone()) {
        return Ok(());
    }
    if depth > MAX_FOLDER_DEPTH {
        return Err(DesktopError::folder_limit(format!(
            "Folder traversal exceeded maximum depth of {}.",
            MAX_FOLDER_DEPTH
        )));
    }

    let read_dir = fs::read_dir(&canonical_directory).map_err(|error| {
        DesktopError::from_io(
            format!("Failed to read folder {}", canonical_directory.display()),
            error,
        )
    })?;
    for item in read_dir {
        let item =
            item.map_err(|error| DesktopError::from_io("Failed to read folder entry", error))?;
        let path = item.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| DesktopError::from_io("Failed to inspect folder entry", error))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            if path.is_dir() {
                continue;
            }
        }
        if path.is_dir() {
            if depth >= MAX_FOLDER_DEPTH {
                return Err(DesktopError::folder_limit(format!(
                    "Folder traversal exceeded maximum depth of {}.",
                    MAX_FOLDER_DEPTH
                )));
            }
            collect_folder_recursive(root, &path, depth + 1, visited, entries)?;
            continue;
        }
        if path.is_file() && is_exr_path(&path) {
            let entry = build_file_entry(&path, Some(root))?;
            enforce_folder_limits(entries, &entry)?;
            entries.push(entry);
        }
    }
    Ok(())
}

fn enforce_folder_limits(entries: &[FileEntry], next: &FileEntry) -> DesktopResult<()> {
    if entries.len() + 1 > MAX_FOLDER_EXR_COUNT {
        return Err(DesktopError::folder_limit(format!(
            "Folder contains more than {} EXR files.",
            MAX_FOLDER_EXR_COUNT
        )));
    }
    let current_total = entries
        .iter()
        .map(|entry| entry.file_size_bytes)
        .sum::<u64>();
    if current_total.saturating_add(next.file_size_bytes) > MAX_FOLDER_TOTAL_BYTES {
        return Err(DesktopError::folder_limit(format!(
            "Folder EXR total exceeds {} bytes.",
            MAX_FOLDER_TOTAL_BYTES
        )));
    }
    Ok(())
}

fn build_file_entry(path: &Path, root: Option<&Path>) -> DesktopResult<FileEntry> {
    let canonical_path = path
        .canonicalize()
        .map_err(|error| DesktopError::from_io("File does not exist", error))?;
    if !canonical_path.is_file() {
        return Err(DesktopError::not_file("Path is not a file."));
    }
    if !is_exr_path(&canonical_path) {
        return Err(DesktopError::not_exr("File is not an OpenEXR .exr file."));
    }

    let metadata = fs::metadata(&canonical_path)
        .map_err(|error| DesktopError::from_io("Failed to read file metadata", error))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(DesktopError::too_large(format!(
            "EXR file is too large. Limit is {} bytes.",
            MAX_FILE_BYTES
        )));
    }
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

    Ok(FileEntry {
        path: canonical_path,
        display_path: Some(path_to_string(path)),
        relative_path,
        filename,
        file_size_bytes: metadata.len(),
    })
}

fn sort_file_entries(entries: &mut [FileEntry]) {
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

fn normalize_export_extensions(extensions: &[String]) -> DesktopResult<Vec<String>> {
    let normalized = extensions
        .iter()
        .map(|extension| extension.trim().trim_start_matches('.').to_lowercase())
        .filter(|extension| !extension.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Err(DesktopError::invalid_output(
            "Export must allow at least one extension.",
        ));
    }
    if normalized
        .iter()
        .any(|extension| extension != "png" && extension != "zip")
    {
        return Err(DesktopError::invalid_output(
            "Export path must use .png or .zip.",
        ));
    }
    Ok(normalized)
}

fn validate_export_path(path: &Path, allowed_extensions: &[String]) -> DesktopResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !allowed_extensions
        .iter()
        .any(|allowed| allowed == &extension)
    {
        return Err(DesktopError::invalid_output(format!(
            "Export path must end with {}.",
            allowed_extensions
                .iter()
                .map(|extension| format!(".{extension}"))
                .collect::<Vec<_>>()
                .join(" or ")
        )));
    }
    let parent = path
        .parent()
        .ok_or_else(|| DesktopError::invalid_output("Export path has no parent directory."))?;
    if !parent.is_dir() {
        return Err(DesktopError::invalid_output(
            "Export parent directory does not exist.",
        ));
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> DesktopResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| DesktopError::invalid_output("Export path has no parent directory."))?;
    let mut temp_file = NamedTempFile::new_in(parent)
        .map_err(|error| DesktopError::from_io("Failed to create temporary export file", error))?;
    temp_file
        .write_all(bytes)
        .map_err(|error| DesktopError::from_io("Failed to write export file", error))?;
    temp_file
        .as_file_mut()
        .flush()
        .map_err(|error| DesktopError::from_io("Failed to flush export file", error))?;
    temp_file
        .as_file_mut()
        .sync_all()
        .map_err(|error| DesktopError::from_io("Failed to sync export file", error))?;
    temp_file
        .persist(path)
        .map_err(|error| DesktopError::from_io("Failed to save export file", error.error))?;
    Ok(())
}

fn with_recents_read<T>(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
    read: impl FnOnce(&[DesktopRecentFile]) -> DesktopResult<T>,
) -> DesktopResult<T> {
    let mut store = state
        .recents
        .lock()
        .map_err(|_| DesktopError::io("Failed to read desktop recent files."))?;
    if !store.loaded {
        store.items = load_recents(app)?;
        store.loaded = true;
    }
    read(&store.items)
}

fn with_recents_mut<T>(
    app: &AppHandle,
    state: &tauri::State<'_, DesktopState>,
    update: impl FnOnce(&mut Vec<DesktopRecentFile>) -> DesktopResult<T>,
) -> DesktopResult<T> {
    let mut store = state
        .recents
        .lock()
        .map_err(|_| DesktopError::io("Failed to update desktop recent files."))?;
    if !store.loaded {
        store.items = load_recents(app)?;
        store.loaded = true;
    }
    let result = update(&mut store.items)?;
    save_recents(app, &store.items)?;
    Ok(result)
}

fn load_recents(app: &AppHandle) -> DesktopResult<Vec<DesktopRecentFile>> {
    let path = recent_files_path(app)?;
    load_recents_from_path(&path)
}

fn load_recents_from_path(path: &Path) -> DesktopResult<Vec<DesktopRecentFile>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(&path)
        .map_err(|error| DesktopError::from_io("Failed to read recent files", error))?;
    let mut items = serde_json::from_slice::<Vec<DesktopRecentFile>>(&bytes).unwrap_or_default();
    items.truncate(RECENT_FILES_LIMIT);
    Ok(items)
}

fn save_recents(app: &AppHandle, items: &[DesktopRecentFile]) -> DesktopResult<()> {
    let path = recent_files_path(app)?;
    save_recents_to_path(&path, items)
}

fn save_recents_to_path(path: &Path, items: &[DesktopRecentFile]) -> DesktopResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| DesktopError::from_io("Failed to create app data folder", error))?;
    }
    let bytes = serde_json::to_vec_pretty(items)
        .map_err(|error| DesktopError::io(format!("Failed to serialize recent files: {error}")))?;
    write_atomic(path, &bytes)
}

fn recent_files_path(app: &AppHandle) -> DesktopResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(RECENT_FILES_FILENAME))
        .map_err(|error| DesktopError::io(format!("Failed to resolve app data folder: {error}")))
}

fn same_path_string(left: &str, right: &Path) -> bool {
    let Ok(left) = normalize_input_path(left) else {
        return false;
    };
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
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

fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    fn write_exr(path: &Path, size: usize) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(&vec![0; size]).unwrap();
    }

    #[test]
    fn accepts_uppercase_exr_extension() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("A.EXR");
        write_exr(&path, 8);

        let entry = build_file_entry(&path, None).unwrap();
        assert_eq!(entry.filename, "A.EXR");
        assert_eq!(entry.file_size_bytes, 8);
    }

    #[test]
    fn rejects_missing_non_file_and_non_exr_paths() {
        let dir = tempdir().unwrap();
        assert_eq!(
            build_file_entry(&dir.path().join("missing.exr"), None)
                .unwrap_err()
                .code,
            DesktopErrorCode::NotFound
        );
        assert_eq!(
            build_file_entry(dir.path(), None).unwrap_err().code,
            DesktopErrorCode::NotFile
        );
        let txt = dir.path().join("image.txt");
        write_exr(&txt, 4);
        assert_eq!(
            build_file_entry(&txt, None).unwrap_err().code,
            DesktopErrorCode::NotExr
        );
    }

    #[test]
    fn folder_listing_skips_symlink_directories() {
        let dir = tempdir().unwrap();
        let real = dir.path().join("real");
        let linked = dir.path().join("linked");
        fs::create_dir(&real).unwrap();
        write_exr(&real.join("a.exr"), 2);
        write_exr(dir.path().join("root.exr").as_path(), 2);

        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &linked).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real, &linked).unwrap();

        let entries = list_folder_entries(dir.path()).unwrap();
        let names = entries
            .iter()
            .map(|entry| entry.relative_path.clone().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["real/a.exr", "root.exr"]);
    }

    #[test]
    fn folder_listing_enforces_count_limit() {
        let dir = tempdir().unwrap();
        for index in 0..=MAX_FOLDER_EXR_COUNT {
            write_exr(&dir.path().join(format!("{index:03}.exr")), 1);
        }
        assert_eq!(
            list_folder_entries(dir.path()).unwrap_err().code,
            DesktopErrorCode::FolderLimit
        );
    }

    #[test]
    fn atomic_write_replaces_output() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("export.png");
        fs::write(&path, b"old").unwrap();
        write_atomic(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn invalid_recent_file_json_loads_as_empty_list() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(RECENT_FILES_FILENAME);
        fs::write(&path, b"{not-json").unwrap();

        assert_eq!(load_recents_from_path(&path).unwrap(), Vec::new());
    }

    #[test]
    fn recent_file_storage_truncates_and_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(RECENT_FILES_FILENAME);
        let items = (0..RECENT_FILES_LIMIT + 2)
            .map(|index| DesktopRecentFile {
                path: format!("/tmp/{index}.exr"),
                label: format!("{index}.exr"),
                display_path: format!("/tmp/{index}.exr"),
                opened_at: index as u64,
            })
            .collect::<Vec<_>>();

        save_recents_to_path(&path, &items).unwrap();
        let loaded = load_recents_from_path(&path).unwrap();

        assert_eq!(loaded.len(), RECENT_FILES_LIMIT);
        assert_eq!(loaded[0].label, "0.exr");
    }

    #[test]
    fn validates_export_extensions() {
        let dir = tempdir().unwrap();
        assert!(validate_export_path(&dir.path().join("image.png"), &["png".to_string()]).is_ok());
        assert_eq!(
            validate_export_path(&dir.path().join("image.exr"), &["png".to_string()])
                .unwrap_err()
                .code,
            DesktopErrorCode::InvalidOutput
        );
    }

    #[test]
    fn missing_paths_can_still_match_recent_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("missing.exr");
        let raw = path_to_string(&path);

        assert!(same_path_string(&raw, &path));
    }
}
