mod thumbnail;

#[cfg(windows)]
mod windows_shell;

pub use thumbnail::{decode_exr_thumbnail, ThumbnailImage};
