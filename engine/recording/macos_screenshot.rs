use screencapturekit::prelude::{SCContentFilter, SCStreamConfiguration};
use screencapturekit::screenshot_manager::{CGImageExt, SCScreenshotManager};

use crate::capture::engine::runtime::recording::diagnostics::sampling::Rejection;
use crate::shared::model::RgbaFrame;

pub(super) fn capture(
    filter: &SCContentFilter,
    config: &SCStreamConfiguration,
    t_ms: u64,
) -> Result<RgbaFrame, Rejection> {
    #[cfg(debug_assertions)]
    if std::env::var("APPARENT_TEST_DROP_SCK_FRAMES").as_deref() == Ok("1") {
        return Err(Rejection::ScreenshotAcquisition);
    }
    let image = SCScreenshotManager::capture_image(filter, config)
        .map_err(|_| Rejection::ScreenshotAcquisition)?;
    let width = u32::try_from(image.width()).map_err(|_| Rejection::ScreenshotPixels)?;
    let height = u32::try_from(image.height()).map_err(|_| Rejection::ScreenshotPixels)?;
    if width == 0 || height == 0 {
        return Err(Rejection::ScreenshotPixels);
    }
    let rgba = image.rgba_data().map_err(|_| Rejection::ScreenshotPixels)?;
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err(Rejection::ScreenshotPixels);
    }
    Ok(RgbaFrame::new(t_ms, width, height, rgba))
}
