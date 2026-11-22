#[cfg(target_os = "macos")]
pub(crate) mod ax;
#[cfg(not(target_os = "macos"))]
pub(crate) mod ax_other;
#[cfg(target_os = "linux")]
#[path = "../../../engine/accessibility/linux.rs"]
pub(crate) mod ax;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) use ax_other as ax;

use crate::shared::model::{Stroke, TargetFrame};

pub(crate) fn mark_started(time: u64) {
    #[cfg(target_os = "linux")]
    ax::Prober::shared().mark_started(time);
    #[cfg(not(target_os = "linux"))]
    let _ = time;
}

pub(crate) fn probe_stroke(stroke: &Stroke, frame: TargetFrame) {
    #[cfg(target_os = "linux")]
    ax::Prober::shared().stroke(stroke, frame);
    #[cfg(not(target_os = "linux"))]
    if let Some((x, y)) = ax::stroke_probe_point(stroke, frame) {
        ax::Prober::shared().probe(ax::Target::Stroke(stroke.t0), x, y);
    }
}
