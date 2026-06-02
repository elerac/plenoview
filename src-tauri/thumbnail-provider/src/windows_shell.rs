use std::ffi::c_void;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use windows::Win32::Foundation::{
    BOOL, CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_POINTER,
    HANDLE, S_FALSE, S_OK,
};
use windows::Win32::Graphics::Gdi::{
    CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
};
use windows::Win32::System::Com::{IClassFactory, IClassFactory_Impl, IStream};
use windows::Win32::UI::Shell::PropertiesSystem::{
    IInitializeWithStream, IInitializeWithStream_Impl,
};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, WTSAT_ARGB};
use windows_core::{implement, ComObject, Error, IUnknown, Interface, Result, GUID, HRESULT};

use crate::thumbnail::decode_exr_thumbnail;

const CLSID_EXR_THUMBNAIL_PROVIDER: GUID = GUID::from_u128(0x4d64b0f7_4e7e_49e2_8f8c_1db4b1ef6c15);
const MAX_EXR_STREAM_BYTES: usize = 2 * 1024 * 1024 * 1024;

static OBJECT_COUNT: AtomicU32 = AtomicU32::new(0);
static LOCK_COUNT: AtomicU32 = AtomicU32::new(0);

#[implement(IThumbnailProvider, IInitializeWithStream)]
struct ExrThumbnailProvider {
    bytes: Mutex<Option<Vec<u8>>>,
}

impl ExrThumbnailProvider {
    fn new() -> Self {
        OBJECT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            bytes: Mutex::new(None),
        }
    }
}

impl Drop for ExrThumbnailProvider {
    fn drop(&mut self) {
        OBJECT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

#[allow(non_snake_case)]
impl IInitializeWithStream_Impl for ExrThumbnailProvider_Impl {
    fn Initialize(&self, pstream: Option<&IStream>, _grfmode: u32) -> Result<()> {
        let stream = pstream.ok_or_else(|| Error::from(E_POINTER))?;
        let bytes = read_stream(stream)?;
        let mut stored = self.bytes.lock().map_err(|_| Error::from(E_FAIL))?;
        *stored = Some(bytes);
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IThumbnailProvider_Impl for ExrThumbnailProvider_Impl {
    fn GetThumbnail(
        &self,
        cx: u32,
        phbmp: *mut HBITMAP,
        pdwalpha: *mut windows::Win32::UI::Shell::WTS_ALPHATYPE,
    ) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() || cx == 0 {
            return Err(E_INVALIDARG.into());
        }

        let bytes = self
            .bytes
            .lock()
            .map_err(|_| Error::from(E_FAIL))?
            .clone()
            .ok_or_else(|| Error::from(E_FAIL))?;
        let thumbnail = decode_exr_thumbnail(&bytes, cx).map_err(|_| Error::from(E_FAIL))?;
        let bitmap = create_bitmap(thumbnail.width, thumbnail.height, &thumbnail.bgra)?;

        unsafe {
            *phbmp = bitmap;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct ClassFactory;

impl ClassFactory {
    fn new() -> Self {
        OBJECT_COUNT.fetch_add(1, Ordering::SeqCst);
        Self
    }
}

impl Drop for ClassFactory {
    fn drop(&mut self) {
        OBJECT_COUNT.fetch_sub(1, Ordering::SeqCst);
    }
}

#[allow(non_snake_case)]
impl IClassFactory_Impl for ClassFactory_Impl {
    fn CreateInstance(
        &self,
        punkouter: Option<&IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> Result<()> {
        if punkouter.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        if riid.is_null() || ppvobject.is_null() {
            return Err(E_POINTER.into());
        }

        unsafe {
            *ppvobject = null_mut();
        }

        let provider: IUnknown = ComObject::new(ExrThumbnailProvider::new()).into_interface();
        unsafe {
            provider.query(riid, ppvobject).ok()?;
        }
        Ok(())
    }

    fn LockServer(&self, flock: BOOL) -> Result<()> {
        if flock.0 != 0 {
            LOCK_COUNT.fetch_add(1, Ordering::SeqCst);
        } else {
            let _ = LOCK_COUNT.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                count.checked_sub(1)
            });
        }
        Ok(())
    }
}

#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();

    if *rclsid != CLSID_EXR_THUMBNAIL_PROVIDER {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    let factory: IClassFactory = ComObject::new(ClassFactory::new()).into_interface();
    factory.query(riid, ppv)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if OBJECT_COUNT.load(Ordering::SeqCst) == 0 && LOCK_COUNT.load(Ordering::SeqCst) == 0 {
        S_OK
    } else {
        S_FALSE
    }
}

fn read_stream(stream: &IStream) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let mut read = 0_u32;
        unsafe {
            stream
                .Read(
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    Some(&mut read),
                )
                .ok()?;
        }

        if read == 0 {
            break;
        }

        bytes.extend_from_slice(&buffer[..read as usize]);
        if bytes.len() > MAX_EXR_STREAM_BYTES {
            return Err(E_FAIL.into());
        }
    }

    Ok(bytes)
}

fn create_bitmap(width: u32, height: u32, bgra: &[u8]) -> Result<HBITMAP> {
    let expected_len = width as usize * height as usize * 4;
    if bgra.len() != expected_len || width > i32::MAX as u32 || height > i32::MAX as u32 {
        return Err(E_INVALIDARG.into());
    }

    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: expected_len as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = null_mut();
    let bitmap = unsafe {
        CreateDIBSection(
            HDC::default(),
            &mut bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            HANDLE::default(),
            0,
        )?
    };

    if bits.is_null() {
        return Err(E_FAIL.into());
    }

    unsafe {
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits.cast::<u8>(), expected_len);
    }

    Ok(bitmap)
}
