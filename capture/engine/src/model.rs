//! Shared capture geometry and owned frame pixels.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    pub mode: CaptureMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_id: Option<u32>,
    pub display_id: u32,
    pub frame: TargetFrame,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMode {
    Display,
    Window,
    Region,
    /// A phone's own screen; normalized coordinates are phone-screen coordinates.
    Device,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// Raw RGBA8 frame buffer in memory used for candidate selection and compositing.
#[derive(Clone, Debug)]
pub struct RgbaFrame {
    pub t_ms: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub badge_bottom_left: bool,
}

impl RgbaFrame {
    pub fn new(t_ms: u64, width: u32, height: u32, rgba: Vec<u8>) -> Self {
        debug_assert_eq!(rgba.len(), (width as usize) * (height as usize) * 4);
        Self {
            t_ms,
            width,
            height,
            rgba,
            badge_bottom_left: false,
        }
    }
}
