#[cfg(test)]
use super::validate_source_type;
use crate::capture::desktop::linux::{Monitor, monitor_id};
use crate::shared::model::CaptureMode;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub rect: [u32; 4],
    pub source_size: Option<[u32; 2]>,
}

pub(super) fn picked_monitor<'a>(
    monitors: &'a [Monitor],
    mapping_id: Option<&str>,
    hyprland: bool,
) -> Option<&'a Monitor> {
    match monitors {
        [only] if !hyprland || mapping_id.is_none() => Some(only),
        _ if hyprland => {
            let mut matches = monitors
                .iter()
                .filter(|monitor| selected_output_matches(&monitor.name, mapping_id));
            let chosen = matches.next()?;
            matches.next().is_none().then_some(chosen)
        }
        _ => None,
    }
}

pub(super) fn screencast_key(output: Option<&str>, count: usize) -> String {
    match output {
        None => "screencast-window".into(),
        Some(name) if count > 1 => format!("screencast:{name}"),
        Some(_) => "screencast".into(),
    }
}

fn selected_output_matches(name: &str, mapping_id: Option<&str>) -> bool {
    mapping_id == Some(name)
}

pub(super) fn portal_request_supported(mode: CaptureMode, count: usize, hyprland: bool) -> bool {
    !matches!(mode, CaptureMode::Display | CaptureMode::Region) || count <= 1 || hyprland
}

pub(super) fn portal_output_verified(
    mode: CaptureMode,
    count: usize,
    hyprland: bool,
    name: &str,
    mapping_id: Option<&str>,
) -> bool {
    portal_request_supported(mode, count, hyprland)
        && (!matches!(mode, CaptureMode::Display | CaptureMode::Region)
            || count <= 1
            || selected_output_matches(name, mapping_id))
}

pub(super) fn selected_monitor(monitors: &[Monitor], id: u32) -> Option<&Monitor> {
    monitors.iter().find(|m| monitor_id(m) == id)
}

pub(super) fn output_still_selected(selected: &Monitor, now: &[Monitor], count: usize) -> bool {
    now.len() == count
        && selected_monitor(now, monitor_id(selected)).is_some_and(|current| {
            current.name == selected.name
                && current.outputs == selected.outputs
                && current
                    .rect
                    .iter()
                    .zip(selected.rect)
                    .all(|(a, b)| (a - b).abs() <= 1.0)
        })
}

pub(super) fn target_fits_output(mode: CaptureMode, target: [f64; 4], output: [f64; 4]) -> bool {
    const EPSILON: f64 = 1.0;
    match mode {
        CaptureMode::Display => target
            .iter()
            .zip(output)
            .all(|(a, b)| (a - b).abs() <= EPSILON),
        CaptureMode::Region => {
            target[0] >= output[0] - EPSILON
                && target[1] >= output[1] - EPSILON
                && target[0] + target[2] <= output[0] + output[2] + EPSILON
                && target[1] + target[3] <= output[1] + output[3] + EPSILON
        }
        CaptureMode::Window => true,
        CaptureMode::Device => false,
    }
}

fn portal_crop(mode: CaptureMode, rect: [f64; 4], stream: Option<[f64; 4]>) -> Option<[u32; 4]> {
    match (mode, stream) {
        (CaptureMode::Region, Some([sx, sy, sw, sh])) if sw > 0.0 && sh > 0.0 => {
            let left = rect[0].max(sx);
            let top = rect[1].max(sy);
            let right = (rect[0] + rect[2]).min(sx + sw);
            let bottom = (rect[1] + rect[3]).min(sy + sh);
            (right > left && bottom > top).then_some([
                (left - sx) as u32,
                (top - sy) as u32,
                (right - left) as u32,
                (bottom - top) as u32,
            ])
        }
        _ => None,
    }
}

pub(super) fn region_crop(
    rect: [f64; 4],
    output: Option<&Monitor>,
    count: usize,
    hyprland: bool,
    stream: Option<[f64; 4]>,
    portal_monitor: bool,
) -> Option<Crop> {
    let bounds = if hyprland {
        output.map(|m| m.rect)
    } else {
        stream
    };
    if let Some(bounds) = bounds {
        return portal_crop(CaptureMode::Region, rect, Some(bounds)).map(|rect| Crop {
            rect,
            source_size: None,
        });
    }
    let output = output?;

    if count != 1
        || !portal_monitor
        || output.handle <= 0
        || output.name.is_empty()
        || output.outputs != 1
        || !target_fits_output(CaptureMode::Region, rect, output.rect)
        || !output.rect.iter().chain(rect.iter()).all(|v| v.is_finite())
    {
        return None;
    }
    let [width, height] = [output.rect[2], output.rect[3]];
    if [width, height]
        .iter()
        .any(|v| *v < 1.0 || *v > f64::from(i32::MAX) || v.fract() != 0.0)
    {
        return None;
    }
    let crop = portal_crop(CaptureMode::Region, rect, Some(output.rect))?;
    if crop[2] == 0 || crop[3] == 0 {
        return None;
    }
    Some(Crop {
        rect: crop,
        source_size: Some([width as u32, height as u32]),
    })
}

#[cfg(test)]
#[path = "display_tests.rs"]
mod display_tests;
