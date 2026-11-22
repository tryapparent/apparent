//! `apparent zoom`: a dense contact sheet around one moment of a bundle, for looking closely at an
//! animation or glitch the narration points at.

use std::path::{Path, PathBuf};

use crate::shared::model::parse_clock_ms;
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::{process::Command, time::Duration};

use crate::shared::model::{ApparentBundle, InteractionEvent, Keyframe, KeyframeReason};

pub struct ZoomSheet {
    pub path: PathBuf,
    /// `(index, time ms)` of each cell, in order.
    pub cells: Vec<(usize, u64)>,
    pub from_ms: u64,
    pub to_ms: u64,
    /// The narration overlapping the window.
    pub said: String,
}

/// What to zoom into: a moment (`--at`) or one mark (`--mark`).
pub enum Focus<'a> {
    At(&'a str),
    Mark(crate::capture::agent::context::MarkEntry<'a>),
}

/// How much of a gesture still under way a cell shows: the finger now and its recent path.
const TRAIL_MS: u64 = 350;

/// The interactions as they stood at `t`. A drag still under way is cut to its last
/// `TRAIL_MS`, so the cell shows where the finger is rather than the whole gesture to come
/// (its samples are evenly spaced in time, so a point's index gives its time).
fn events_at(events: &[InteractionEvent], t: u64) -> Vec<InteractionEvent> {
    events
        .iter()
        .map(|event| match event {
            InteractionEvent::Drag {
                t: t0,
                t1,
                path,
                label,
                button,
                ..
            } if *t0 <= t && t < *t1 && path.len() >= 2 => {
                let n = path.len() as u64;
                let at = |i: usize| t0 + (t1 - t0) * i as u64 / (n - 1);
                let done: Vec<usize> = (0..path.len()).filter(|&i| at(i) <= t).collect();
                let last = *done.last().unwrap_or(&0);
                let mut kept: Vec<[f32; 2]> = done
                    .into_iter()
                    .filter(|&i| at(i) + TRAIL_MS >= t)
                    .map(|i| path[i])
                    .collect();
                if kept.is_empty() {
                    kept.push(path[last]);
                }
                let [x0, y0] = kept[0];
                let [x1, y1] = kept[kept.len() - 1];
                InteractionEvent::Drag {
                    t: t.saturating_sub(TRAIL_MS).max(*t0),
                    t1: t,
                    x0,
                    y0,
                    x1,
                    y1,
                    label: label.clone(),
                    button: button.clone(),
                    path: kept,
                }
            }
            other => other.clone(),
        })
        .collect()
}

pub fn clock(ms: u64) -> String {
    format!("{}:{:02}.{:03}", ms / 60_000, ms / 1_000 % 60, ms % 1_000)
}

fn said_between(bundle: &ApparentBundle, from: u64, to: u64) -> String {
    let words: Vec<&str> = bundle
        .transcript
        .words
        .iter()
        .filter(|w| w.t1 >= from && w.t0 <= to)
        .map(|w| w.text.as_str())
        .collect();
    if !words.is_empty() {
        return words.join(" ");
    }
    bundle
        .transcript
        .segments
        .iter()
        .filter(|s| s.t1 >= from && s.t0 <= to)
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The auto-crop of the `k`th keyframe (0-based).
fn crop_of(
    bundle: &ApparentBundle,
    k: usize,
) -> Option<crate::capture::engine::autocrop::autocrop::Rect> {
    let crop = bundle.autocrop.as_ref()?.crops.get(k)?;
    (crop.kind != crate::capture::engine::autocrop::autocrop::CropKind::Full)
        .then(|| crop.rect(&bundle.target.frame))
}

/// `cropped`: in an auto-cropped bundle, crop each cell like the nearest keyframe (for a mark,
/// like the mark's keyframe, whose crop holds its ink).
pub fn zoom(
    dir: &Path,
    bundle: &ApparentBundle,
    focus: Focus,
    span_ms: u64,
    count: usize,
    cropped: bool,
) -> Result<ZoomSheet> {
    let pending = dir.join(crate::shared::handoff::MEDIA_PENDING);
    // A bundle copied from another Mac gets its video a few seconds after the rest; wait for it.
    let waited = std::time::Instant::now();
    while pending.exists() && waited.elapsed() < std::time::Duration::from_secs(120) {
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    let video = bundle
        .video
        .as_ref()
        .map(|v| dir.join(v))
        .filter(|p| p.is_file())
        .with_context(|| {
            if pending.exists() {
                "The bundle's video is still copying from the other Mac; try again in a minute"
                    .to_owned()
            } else {
                crate::capture::engine::bundle::retention::missing_media_reason(dir)
                    .unwrap_or_else(|| "The bundle has no video to zoom into".to_owned())
            }
        })?;
    let plan = plan(bundle, &focus, span_ms, count, cropped)?;
    let (from_ms, to_ms, times) = (plan.from, plan.to, plan.times);
    let mark = match &focus {
        Focus::Mark(entry) => Some(entry),
        Focus::At(_) => None,
    };
    let mark_crop = mark
        .and_then(|e| e.keyframe)
        .and_then(|index| bundle.keyframes.iter().position(|k| k.index == index))
        .map(|k| crop_of(bundle, k));
    let crops: Vec<Option<crate::capture::engine::autocrop::autocrop::Rect>> = plan
        .nearest
        .iter()
        .map(|&index| {
            mark_crop
                .unwrap_or_else(|| index.checked_sub(1).and_then(|k| crop_of(bundle, k)))
                .filter(|_| cropped)
        })
        .collect();
    let mut frames = if crops.iter().any(Option::is_some) {
        // Decoded at full size a few at a time and cropped straight away, so a sheet of 2560 px
        // screens doesn't sit in memory.
        let mut out = Vec::with_capacity(times.len());
        for (chunk, rects) in times.chunks(6).zip(crops.chunks(6)) {
            let decoded =
                crate::composition::movie_frames::record(&video, chunk, bundle.video_offset_ms, 0)?;
            for (frame, rect) in decoded.into_iter().zip(rects) {
                let frame = match rect {
                    Some(r) => crate::capture::engine::autocrop::autocrop::crop_frame(&frame, *r),
                    None => frame,
                };
                out.push(crate::capture::engine::autocrop::autocrop_lab::downscale(
                    &frame, 1280,
                ));
            }
        }
        out
    } else {
        crate::composition::movie_frames::record(&video, &times, bundle.video_offset_ms, 900)?
    };
    ensure!(!frames.is_empty(), "No frames could be decoded");
    let mut cells = Vec::with_capacity(frames.len());
    for (i, frame) in frames.iter_mut().enumerate() {
        let t = frame.t_ms;
        let events = events_at(&bundle.events, t);
        let rect = crops
            .get(i)
            .copied()
            .flatten()
            .unwrap_or(crate::capture::engine::autocrop::autocrop::FULL);
        // Labels are sized for the sheet's cell, not the decoded frame.
        let cell_width = if frame.height > frame.width {
            300.0
        } else {
            480.0
        };
        let label_scale = frame.width as f32 / cell_width;
        let keyframe = Keyframe {
            index: i + 1,
            t,
            display_time: None,
            reason: KeyframeReason::Speech,
            file: String::new(),
            event: String::new(),
            said: None,
            // Semantic replay shows the whole mark; composited sources retain
            // the recorded progression and fade instead.
            mark_id: mark.filter(|e| t >= e.mark.t0).map(|e| e.mark.id.clone()),
            cursor: None,
        };
        let view = crate::capture::engine::autocrop::autocrop::crop_view(
            rect,
            &keyframe,
            &bundle.strokes,
            &bundle.marks,
            &events,
        );
        crate::capture::engine::render::annotate_keyframe_in_place(
            frame,
            &view.keyframe,
            &view.strokes,
            &view.marks,
            &view.events,
            crate::shared::model::VideoInk::replay_video(bundle.video_ink),
        );
        crate::capture::engine::render::draw_time_label(frame, &clock(t), label_scale);
        cells.push((i + 1, t));
    }
    let sheet = crate::capture::engine::render::render_zoom_sheet(&frames);
    let out_dir = dir.join("zoom");
    std::fs::create_dir_all(&out_dir)?;
    let path = out_dir.join(format!("zoom-{from_ms}-{to_ms}.png"));
    crate::capture::engine::render::save_png(&sheet, &path)?;
    Ok(ZoomSheet {
        path,
        cells,
        from_ms,
        to_ms,
        said: said_between(bundle, from_ms, to_ms),
    })
}

struct Plan {
    pub from: u64,
    pub to: u64,
    pub times: Vec<u64>,
    pub nearest: Vec<usize>,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "lowercase", deny_unknown_fields)]
enum Reply {
    Missing,
    Past {
        at: String,
    },
    Plan {
        from: String,
        to: String,
        times: Vec<String>,
        nearest: Vec<usize>,
    },
}

fn plan(
    bundle: &ApparentBundle,
    focus: &Focus<'_>,
    span: u64,
    count: usize,
    cropped: bool,
) -> Result<Plan> {
    let (moment, phrase, mark) = match focus {
        Focus::At(at) => match parse_clock_ms(at) {
            Some(ms) => (Some(ms.to_string()), None, None),
            None => (None, Some(*at), None),
        },
        Focus::Mark(entry) => (
            None,
            None,
            Some([entry.mark.t0.to_string(), entry.mark.t1.to_string()]),
        ),
    };
    let mut words = Vec::new();
    let mut segments = Vec::new();
    if phrase.is_some() {
        words.extend(
            bundle
                .transcript
                .words
                .iter()
                .map(|w| (&w.text, w.t0.to_string())),
        );
        segments.extend(
            bundle
                .transcript
                .segments
                .iter()
                .map(|s| (&s.text, s.t0.to_string())),
        );
    }
    let keyframes: Vec<_> = bundle
        .keyframes
        .iter()
        .filter(|_| cropped && bundle.autocrop.is_some())
        .map(|k| k.t.to_string())
        .collect();
    let request = crate::composition::worker::private_json(&serde_json::json!({
        "moment": moment, "phrase": phrase, "mark": mark, "duration": bundle.duration_ms.to_string(),
        "span": span.to_string(), "count": count.to_string(), "words": words, "segments": segments, "keyframes": keyframes,
    }))?;
    let (node, worker) =
        crate::composition::worker::policy_assets("Agent zoom", "agent-media", "zoom-worker.mjs")?;
    let bytes = crate::composition::worker::run_with_input(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker),
        request,
        Duration::from_secs(30),
        8192,
    )?;
    match serde_json::from_slice(&bytes).context("Invalid Agent zoom response")? {
        Reply::Missing => bail!(
            "“{}” is neither a time nor a phrase in the narration",
            phrase.context("Unexpected phrase response")?
        ),
        Reply::Past { at } => bail!(
            "{} is past the end ({})",
            clock(at.parse()?),
            clock(bundle.duration_ms)
        ),
        Reply::Plan {
            from,
            to,
            times,
            nearest,
        } => {
            let (from, to) = (from.parse()?, to.parse()?);
            let times: Vec<u64> = times.iter().map(|t| t.parse()).collect::<Result<_, _>>()?;
            ensure!(
                from <= to
                    && to <= bundle.duration_ms
                    && (1..=48).contains(&times.len())
                    && times.first() == Some(&from)
                    && times.iter().all(|t| (from..=to).contains(t))
                    && times.windows(2).all(|w| w[0] <= w[1])
                    && times.len() == nearest.len()
                    && nearest.iter().all(|i| *i <= keyframes.len()),
                "Invalid Agent zoom plan"
            );
            Ok(Plan {
                from,
                to,
                times,
                nearest,
            })
        }
    }
}
