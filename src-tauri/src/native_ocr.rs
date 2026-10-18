//! Real Windows OCR over caller-supplied RGBA pixels. Source proposal only until
//! the direct cached `windows` dependency and Windows build/runtime checks land.
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub words: Vec<OcrWord>,
    pub source: &'static str,
    pub width: u32,
    pub height: u32,
}

/// Coordinates are pixel offsets in exactly the supplied observation image.
/// The owner must bind them to observation/window provenance and expiry before action.
/// OCR is an observation source, not an independent target authorization.
pub fn recognize_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<OcrResult, String> {
    recognize_rgba_guarded(width, height, rgba, &|| Ok(()))
}

pub fn recognize_rgba_guarded(width: u32, height: u32, rgba: &[u8], guard: &dyn Fn() -> Result<(), String>) -> Result<OcrResult, String> {
    guard()?;
    let size = width.checked_mul(height).and_then(|n| n.checked_mul(4))
        .ok_or("OCR image dimensions overflow")?;
    if width == 0 || height == 0 || width > 4096 || height > 4096
        || size > 64 * 1024 * 1024 || rgba.len() != size as usize {
        return Err("OCR requires an exact RGBA image within 4096 pixels and 64 MiB".into());
    }
    let result = platform::recognize(width, height, rgba, guard)?;
    guard()?;
    Ok(result)
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn recognize(_: u32, _: u32, _: &[u8], guard: &dyn Fn() -> Result<(), String>) -> Result<OcrResult, String> {
        guard()?;
        Err("Windows OCR unavailable on this platform".into())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::time::{Duration, Instant};
    use windows::{Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine, Storage::Streams::DataWriter,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED}};

    fn api_error(error: windows::core::Error) -> String {
        format!("Windows OCR API unavailable or failed ({:#x})", error.code().0)
    }
    struct Apartment;
    impl Apartment {
        fn new() -> Result<Self, String> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED).map_err(api_error)?; }
            Ok(Self)
        }
    }
    impl Drop for Apartment { fn drop(&mut self) { unsafe { RoUninitialize(); } } }

    pub fn recognize(width: u32, height: u32, rgba: &[u8], guard: &dyn Fn() -> Result<(), String>) -> Result<OcrResult, String> {
        let start = Instant::now();
        guard()?;
        let _apartment = Apartment::new()?;
        let maximum = OcrEngine::MaxImageDimension().map_err(api_error)?;
        if width > maximum || height > maximum { return Err("Image exceeds installed Windows OCR dimension limit".into()); }
        // A missing user language pack produces an explicit API error, never empty success.
        let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(api_error)?;
        let mut bgra = Vec::with_capacity(rgba.len());
        for pixel in rgba.chunks_exact(4) {
            // Flatten alpha onto white, preserving the actual observed pixel values.
            let alpha = u16::from(pixel[3]);
            for channel in [pixel[2], pixel[1], pixel[0]] {
                bgra.push(((u16::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8);
            }
            bgra.push(255);
        }
        let writer = DataWriter::new().map_err(api_error)?;
        writer.WriteBytes(&bgra).map_err(api_error)?;
        let buffer = writer.DetachBuffer().map_err(api_error)?;
        let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(&buffer,
            BitmapPixelFormat::Bgra8, width as i32, height as i32, BitmapAlphaMode::Ignore)
            .map_err(api_error)?;
        guard()?;
        if start.elapsed() >= Duration::from_secs(5) { return Err("Windows OCR time budget exceeded".into()); }
        let operation = engine.RecognizeAsync(&bitmap).map_err(api_error)?;
        let check = || -> Result<(), String> {
            let validity = guard().and_then(|_| if start.elapsed() >= Duration::from_secs(5) {
                Err("Windows OCR time budget exceeded".into())
            } else { Ok(()) });
            if validity.is_err() { let _ = operation.Cancel(); }
            validity
        };
        loop {
            check()?;
            // AsyncStatus::Started is ABI value zero. Avoid a new direct windows-future dependency.
            if operation.Status().map_err(api_error)?.0 != 0 { break; }
            check()?;
            std::thread::sleep(Duration::from_millis(10));
            check()?;
        }
        check()?;
        let result = operation.GetResults().map_err(api_error)?;
        let text = result.Text().map_err(api_error)?.to_string();
        if text.len() > 65536 { return Err("OCR text exceeds 64 KiB budget".into()); }
        let lines = result.Lines().map_err(api_error)?;
        let line_count = lines.Size().map_err(api_error)?;
        if line_count > 512 { return Err("OCR line budget exceeded".into()); }
        let mut words = Vec::new();
        let mut total_word_bytes = 0usize;
        for index in 0..line_count {
            check()?;
            let line = lines.GetAt(index).map_err(api_error)?;
            let line_words = line.Words().map_err(api_error)?;
            let count = line_words.Size().map_err(api_error)?;
            if words.len() + count as usize > 2048 { return Err("OCR word budget exceeded".into()); }
            for word_index in 0..count {
                check()?;
                let word = line_words.GetAt(word_index).map_err(api_error)?;
                let word_text = word.Text().map_err(api_error)?.to_string();
                total_word_bytes = total_word_bytes.checked_add(word_text.len()).ok_or("OCR text size overflow")?;
                if total_word_bytes > 65536 { return Err("OCR word text budget exceeded".into()); }
                let rect = word.BoundingRect().map_err(api_error)?;
                if ![rect.X, rect.Y, rect.Width, rect.Height].iter().all(|v| v.is_finite())
                    || rect.X < 0.0 || rect.Y < 0.0 || rect.Width <= 0.0 || rect.Height <= 0.0
                    || rect.X + rect.Width > width as f32 || rect.Y + rect.Height > height as f32 {
                    return Err("OCR returned invalid image bounds".into());
                }
                words.push(OcrWord { text: word_text, x: rect.X, y: rect.Y, width: rect.Width, height: rect.Height });
            }
        }
        check()?;
        Ok(OcrResult { text, words, source: "windows-ocr", width, height })
    }
}
