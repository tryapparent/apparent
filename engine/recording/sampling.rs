#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) enum Route {
    Screenshot,
    SystemPicker,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) enum Rejection {
    PrivacyPrompt,
    FilterUnavailable,
    ScreenshotAcquisition,
    ScreenshotPixels,
    PickerStatusMissing,
    PickerFrameIncomplete,
    PickerPixels,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub(crate) struct Sampling {
    pub route: Route,
    pub last_rejection: Option<Rejection>,
}
