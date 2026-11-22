use std::sync::Arc;

use crate::capture::engine::render::{
    MAX_SHEET_TILES, encode_png, render_contact_sheet_for_duration,
};
use crate::shared::model::{Keyframe, RgbaFrame};

pub(crate) const PAPER_WIDTH: f32 = 1600.0;
pub(crate) const PAPER_HEIGHT: f32 = 1100.0;

pub(crate) fn contact_sheet(
    duration: u64,
    mut frames: Vec<(Keyframe, RgbaFrame)>,
    keep_final: bool,
) -> anyhow::Result<Vec<u8>> {
    if keep_final && frames.len() > MAX_SHEET_TILES {
        let final_paper = frames.pop().unwrap();
        frames.truncate(MAX_SHEET_TILES - 1);
        frames.push(final_paper);
    }
    encode_png(&render_contact_sheet_for_duration(duration, &frames))
}

pub(crate) fn render_paper(strokes: &[Arc<Vec<[f32; 2]>>], t_ms: u64, color: [u8; 3]) -> RgbaFrame {
    let (mut x0, mut y0, mut x1, mut y1) = (PAPER_WIDTH, PAPER_HEIGHT, 0.0f32, 0.0f32);
    for point in strokes.iter().flat_map(|stroke| stroke.iter()) {
        x0 = x0.min(point[0]);
        y0 = y0.min(point[1]);
        x1 = x1.max(point[0]);
        y1 = y1.max(point[1]);
    }
    let width = (x1 - x0 + 100.0).max(400.0).min(PAPER_WIDTH);
    let height = (y1 - y0 + 100.0).max(300.0).min(PAPER_HEIGHT);
    let left = ((x0 + x1 - width) / 2.0).clamp(0.0, PAPER_WIDTH - width);
    let top = ((y0 + y1 - height) / 2.0).clamp(0.0, PAPER_HEIGHT - height);
    let (w, h) = (width.ceil() as u32, height.ceil() as u32);
    let mut image = RgbaFrame::new(t_ms, w, h, vec![255; w as usize * h as usize * 4]);
    let dot = |image: &mut RgbaFrame, x: f32, y: f32| {
        let (x, y) = (x.round() as i32, y.round() as i32);
        for dy in -2..=2 {
            for dx in -2..=2 {
                if dx * dx + dy * dy > 5 {
                    continue;
                }
                let (px, py) = (x + dx, y + dy);
                if px >= 0 && py >= 0 && px < image.width as i32 && py < image.height as i32 {
                    let at = (py as usize * image.width as usize + px as usize) * 4;
                    image.rgba[at..at + 3].copy_from_slice(&color);
                }
            }
        }
    };
    for stroke in strokes {
        for point in stroke.iter() {
            dot(&mut image, point[0] - left, point[1] - top);
        }
        for pair in stroke.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let steps = ((b[0] - a[0]).hypot(b[1] - a[1]) * 2.0).ceil() as usize;
            for i in 0..=steps.max(1) {
                let f = i as f32 / steps.max(1) as f32;
                dot(
                    &mut image,
                    a[0] + (b[0] - a[0]) * f - left,
                    a[1] + (b[1] - a[1]) * f - top,
                );
            }
        }
    }
    image
}
