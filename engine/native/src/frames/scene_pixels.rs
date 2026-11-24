use super::FrameRef;
use crate::shared::model::RgbaFrame;

const THUMB_WIDTH: usize = 64;
const THUMB_HEIGHT: usize = 36;
pub(super) const THUMB_PIXELS: usize = THUMB_WIDTH * THUMB_HEIGHT;

pub(super) fn luma_thumbnails(frames: &[FrameRef<'_>]) -> Vec<[f32; THUMB_PIXELS]> {
    if frames.len() >= 128 {
        let chunk_size = frames.len().div_ceil(6).max(1);
        std::thread::scope(|scope| {
            let workers: Vec<_> = frames
                .chunks(chunk_size)
                .map(|chunk| {
                    scope.spawn(move || -> Vec<[f32; THUMB_PIXELS]> {
                        chunk.iter().map(|frame| frame.with_rgba(None, luma_thumbnail)).collect()
                    })
                })
                .collect();
            let mut out = Vec::with_capacity(frames.len());
            for worker in workers {
                out.extend(worker.join().unwrap());
            }
            out
        })
    } else {
        let mut scratch = Vec::new();
        frames
            .iter()
            .map(|frame| frame.with_rgba(Some(&mut scratch), luma_thumbnail))
            .collect()
    }
}

pub(super) fn luma_thumbnail(frame: &RgbaFrame) -> [f32; THUMB_PIXELS] {
    let mut thumbnail = [0.0; THUMB_PIXELS];
    if frame.width == 0 || frame.height == 0 {
        return thumbnail;
    }
    let width = frame.width as usize;
    let height = frame.height as usize;
    for y in 0..THUMB_HEIGHT {
        let sy = ((2 * y + 1) * height / (2 * THUMB_HEIGHT)).min(height - 1);
        for x in 0..THUMB_WIDTH {
            let sx = ((2 * x + 1) * width / (2 * THUMB_WIDTH)).min(width - 1);
            let offset = (sy * width + sx) * 4;
            if let Some(pixel) = frame.rgba.get(offset..offset + 3) {
                thumbnail[y * THUMB_WIDTH + x] = (0.2126 * pixel[0] as f32
                    + 0.7152 * pixel[1] as f32
                    + 0.0722 * pixel[2] as f32)
                    / 255.0;
            }
        }
    }
    thumbnail
}

pub(super) fn thumbnail_diff(a: &[f32; THUMB_PIXELS], b: &[f32; THUMB_PIXELS]) -> f32 {
    (a.iter().zip(b).map(|(x, y)| (x - y).abs()).sum::<f32>() / THUMB_PIXELS as f32).clamp(0.0, 1.0)
}

pub(super) fn scene_transition_diff(a: &[f32; THUMB_PIXELS], b: &[f32; THUMB_PIXELS]) -> f32 {
    let global = thumbnail_diff(a, b);
    const COLS: usize = 8;
    const ROWS: usize = 6;
    const BW: usize = THUMB_WIDTH / COLS;
    const BH: usize = THUMB_HEIGHT / ROWS;
    let mut top = [0.0_f32; 4];
    for by in 0..ROWS {
        for bx in 0..COLS {
            let mut sum = 0.0_f32;
            for y in (by * BH)..((by + 1) * BH) {
                let row = y * THUMB_WIDTH;
                for x in (bx * BW)..((bx + 1) * BW) {
                    let idx = row + x;
                    sum += (a[idx] - b[idx]).abs();
                }
            }
            let block_diff = sum / (BW * BH) as f32;
            if block_diff > top[3] {
                top[3] = block_diff;
                top.sort_by(|x, y| y.total_cmp(x));
            }
        }
    }
    global.max((top[3] * 1.4).clamp(0.0, 1.0))
}
