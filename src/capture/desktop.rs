//! Shared all-display layout and capture coordination.
use crate::model::TargetFrame;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use crate::model::{CapturedDisplay, RgbaFrame};
use super::{CandidateBuffer, Sampler};

pub(crate) type Runner = Box<dyn FnOnce(Sampler) -> Option<PathBuf> + Send>;

struct Worker {
    frames: Arc<Mutex<CandidateBuffer>>,
    startup_failed: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    urgent: Arc<AtomicBool>,
    offset: Arc<AtomicU64>,
    handle: Option<JoinHandle<Option<PathBuf>>>,
}

fn fail(d: &mut CapturedDisplay, at: u64, message: impl Into<String>) {
    if d.failure.is_none() { d.failed_ms = Some(at); d.failure = Some(message.into()); }
}

/// Private debug-build harness input. Never read by release binaries or Settings.
/// {"start":[displayId], "loss":{"displayId":elapsedMilliseconds}}
fn injected(id: u32, phase: &str, now: u64) -> bool {
    #[cfg(debug_assertions)]
    {
        let Some(path) = std::env::var_os("APPARENT_TEST_DISPLAY_FAILURES") else { return false; };
        let Ok(bytes) = std::fs::read(path) else { return false; };
        let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return false; };
        if phase == "start" {
            return v["start"].as_array().is_some_and(|ids| ids.iter().any(|v| v.as_u64() == Some(u64::from(id))));
        }
        return v["loss"][id.to_string()].as_u64().is_some_and(|at| now >= at);
    }
    #[cfg(not(debug_assertions))]
    { let _ = (id, phase, now); false }
}

pub(crate) fn injected_start(id: u32) -> bool { injected(id, "start", 0) }

fn composite(target: TargetFrame, size: (u32, u32), now: u64,
    displays: &[CapturedDisplay], frames: &[Option<RgbaFrame>]) -> Option<RgbaFrame>
{
    let mut image = [24, 24, 28, 255].repeat(size.0 as usize * size.1 as usize);
    let mut any = false;
    for (d, frame) in displays.iter().zip(frames) {
        if d.failure.is_some() { continue; }
        let Some(frame) = frame else { continue; };
        if now.saturating_sub(frame.t_ms) > 2_000 { continue; }
        let sx = f64::from(size.0) / target.width;
        let sy = f64::from(size.1) / target.height;
        let x = ((d.frame.x - target.x) * sx).round() as i64;
        let y = ((d.frame.y - target.y) * sy).round() as i64;
        let w = (d.frame.width * sx).round().max(1.0) as u32;
        let h = (d.frame.height * sy).round().max(1.0) as u32;
        for ty in 0..h {
            for tx in 0..w {
                let (dx, dy) = (x + i64::from(tx), y + i64::from(ty));
                if dx < 0 || dy < 0 || dx >= i64::from(size.0) || dy >= i64::from(size.1) { continue; }
                let fx = u64::from(tx) * u64::from(frame.width) / u64::from(w);
                let fy = u64::from(ty) * u64::from(frame.height) / u64::from(h);
                let src = ((fy * u64::from(frame.width) + fx) * 4) as usize;
                let dst = ((dy as usize * size.0 as usize) + dx as usize) * 4;
                if let Some(pixel) = frame.rgba.get(src..src + 4) { image[dst..dst + 4].copy_from_slice(pixel); }
            }
        }
        any = true;
    }
    any.then(|| RgbaFrame::new(now, size.0, size.1, image))
}

pub(crate) fn run(sampler: Sampler, state: Arc<Mutex<Vec<CapturedDisplay>>>) -> Option<PathBuf> {
    let runners = super::platform::desktop_runners(&sampler.target.displays, &sampler.stopping, &sampler.frames);
    coordinate(sampler, state, runners, super::platform::connected_displays)
}

fn source_timed_out(buffer: &CandidateBuffer, latest: Option<&RgbaFrame>, launch_ms: u64, now: u64) -> bool {
    latest.map_or(!buffer.awaiting_consent && now.saturating_sub(launch_ms.max(buffer.startup_ready_ms)) > 8_000,
        |f| now.saturating_sub(f.t_ms) > 2_000)
}

fn coordinate(sampler: Sampler, state: Arc<Mutex<Vec<CapturedDisplay>>>,
    runners: Vec<Result<Runner, String>>, inventory: impl Fn() -> Vec<CapturedDisplay>) -> Option<PathBuf> {
    let mut displays = sampler.target.displays.clone();
    let launch_ms = sampler.started_at.elapsed().as_millis() as u64;
    let mut workers = Vec::new();
    for (i, runner) in runners.into_iter().enumerate() {
        let d = &mut displays[i];
        let frames = Arc::new(Mutex::new(CandidateBuffer::latest()));
        let startup_failed = Arc::new(AtomicBool::new(false));
        let stopping = Arc::new(AtomicBool::new(false));
        let urgent = Arc::new(AtomicBool::new(false));
        let offset = Arc::new(AtomicU64::new(0));
        let mut target = sampler.target.clone();
        target.frame = d.frame; target.display_id = d.id; target.displays.clear();
        let path = sampler.video_output_path.as_ref().and_then(|p| p.parent())
            .map(|p| p.join(format!(".display-{}", d.id)).join("recording.mp4"));
        if let Some(parent) = path.as_ref().and_then(|p| p.parent()) {
            if let Err(error) = std::fs::create_dir_all(parent) { fail(d, launch_ms, error.to_string()); }
        }
        let child = Sampler {
            target, video_output_path: path, excluded_window_ids: Arc::clone(&sampler.excluded_window_ids),
            started_at: sampler.started_at, stopping: Arc::clone(&stopping), urgent: Arc::clone(&urgent),
            frames: Arc::clone(&frames), real_frame_seen: Arc::new(AtomicBool::new(false)),
            startup_failed: Arc::clone(&startup_failed),
            video_offset_ms: Arc::clone(&offset),
        };
        let handle = match runner {
            Ok(runner) if d.failure.is_none() => match thread::Builder::new().name(format!("apparent-display-{}", d.id)).spawn(move || runner(child)) {
                Ok(h) => Some(h), Err(e) => { fail(d, launch_ms, e.to_string()); None }
            },
            Err(message) => { fail(d, launch_ms, message); None },
            _ => None,
        };
        workers.push(Worker { frames, startup_failed, stopping, urgent, offset, handle });
    }
    let mut latest = vec![None; displays.len()];
    let size = super::capture_size(&sampler.target, super::CANDIDATE_EDGE);
    let mut last_sample = Instant::now().checked_sub(super::FRAME_SAMPLE_INTERVAL).unwrap_or_else(Instant::now);
    let mut last_inventory = Instant::now();
    let mut unsafe_stream = false;
    while !sampler.stopping.load(Ordering::Acquire) {
        if sampler.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).cancelled { break; }
        if workers.iter().any(|w| w.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).privacy_invalidated) {
            unsafe_stream = true;
            latest.fill(None);
            sampler.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).invalidate_privacy();
            break;
        }
        let now = sampler.started_at.elapsed().as_millis() as u64;
        let inventory = (last_inventory.elapsed() >= Duration::from_millis(500)).then(&inventory);
        if inventory.is_some() { last_inventory = Instant::now(); }
        let urgent = sampler.urgent.swap(false, Ordering::AcqRel);
        for (i, worker) in workers.iter_mut().enumerate() {
            let d = &mut displays[i];
            if d.failure.is_some() { continue; }
            if let Some(frame) = worker.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).frames.last().map(|(f, _)| f.clone()) {
                d.started_ms.get_or_insert(frame.t_ms); latest[i] = Some(frame);
            }
            let gone = inventory.as_ref().is_some_and(|list| !list.iter().any(|other| other.id == d.id && other.frame == d.frame));
            let ended = worker.startup_failed.load(Ordering::Acquire)
                || worker.handle.as_ref().is_none_or(JoinHandle::is_finished);
            let timeout = source_timed_out(&worker.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner), latest[i].as_ref(), launch_ms, now);
            if gone || ended || timeout || injected(d.id, "loss", now) {
                fail(d, latest[i].as_ref().map_or(now, |f| f.t_ms), if gone { "Display disconnected or moved" } else { "Display stream unavailable" });
                latest[i] = None; worker.stopping.store(true, Ordering::Release);
            } else if urgent { worker.urgent.store(true, Ordering::Release); }
        }
        *state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = displays.clone();
        if displays.iter().all(|d| d.failure.is_some()) {
            sampler.startup_failed.store(true, Ordering::Release);
            break;
        }
        if urgent || last_sample.elapsed() >= super::FRAME_SAMPLE_INTERVAL {
            last_sample = Instant::now();
            if let Some(frame) = composite(sampler.target.frame, size, now, &displays, &latest) {
                super::push_candidate(&sampler.frames, &sampler.real_frame_seen, frame, urgent, true);
            }
        }
        thread::park_timeout(Duration::from_millis(20));
    }
    let duration_ms = sampler.started_at.elapsed().as_millis() as u64;
    sampler.stopping.store(true, Ordering::Release);
    for w in &workers { w.stopping.store(true, Ordering::Release); if let Some(h) = &w.handle { h.thread().unpark(); } }
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut media = Vec::new();
    for (i, worker) in workers.iter_mut().enumerate() {
        while worker.handle.as_ref().is_some_and(|h| !h.is_finished()) && Instant::now() < deadline { thread::sleep(Duration::from_millis(20)); }
        if worker.handle.as_ref().is_some_and(JoinHandle::is_finished) {
            match worker.handle.take().map(|h| h.join()) {
                Some(Ok(Some(path))) => {
                    // A recorder can finalize an empty/invalid MP4 after startup
                    // failure. Never feed a proven zero-history source to the
                    // compositor. Keep its original on disk, and be conservative
                    // if any pixels arrived even after the coordinator's last poll.
                    if displays[i].started_ms.is_some() || !worker.frames.lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner).frames.is_empty() {
                        media.push(MovieSource { path, display: displays[i].clone(), offset_ms: worker.offset.load(Ordering::Acquire) });
                    }
                },
                Some(Err(_)) => unsafe_stream = true,
                _ => {},
            }
        } else if worker.handle.is_some() {
            unsafe_stream = true;
            fail(&mut displays[i], duration_ms, "Display finalization timed out; original media retained");
            worker.handle.take();
        }
    }
    unsafe_stream |= workers.iter().any(|w| w.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).privacy_invalidated);
    unsafe_stream |= sampler.video_output_path.as_ref().and_then(|p| p.parent())
        .is_some_and(|dir| crate::recover::movie_privacy_failed(dir, &displays));
    // A missing movie from a source that delivered pixels would erase valid history
    // if main decoded a partial composite in place of the captured candidates.
    let incomplete_movie = displays.iter().any(|d| d.started_ms.is_some()
        && !media.iter().any(|s| s.display.id == d.id));
    *state.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = displays;
    if unsafe_stream {
        sampler.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner).invalidate_privacy();
        return None;
    }
    {
        let mut frames = sampler.frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if frames.cancelled { frames.frames.clear(); return None; }
    }
    let output = sampler.video_output_path?;
    if incomplete_movie {
        super::apparent_log("Combined movie withheld: source history incomplete; keeping captured candidates and private originals");
        return None;
    }
    let (width, height) = super::capture_size(&sampler.target, 5120.0);
    let plan = MoviePlan { width, height, frame: sampler.target.frame, duration_ms, sources: media, output: output.clone() };
    sampler.video_offset_ms.store(0, Ordering::Release);
    if plan.sources.is_empty() { return None; }
    match compose_movie(&plan) {
        Ok(()) => Some(output),
        Err(error) => { super::apparent_log(format!("Combined movie unavailable; original media retained: {error:#}")); None }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MovieSource { path: PathBuf, display: CapturedDisplay, offset_ms: u64 }
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MoviePlan { width: u32, height: u32, frame: TargetFrame, duration_ms: u64, sources: Vec<MovieSource>, output: PathBuf }

fn compose_movie(plan: &MoviePlan) -> anyhow::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let mut cmd = std::process::Command::new("ffmpeg");
        cmd.args(["-nostdin", "-v", "error", "-n", "-filter_complex_threads", "1"]);
        for s in &plan.sources { cmd.arg("-i").arg(&s.path); }
        let seconds = plan.duration_ms as f64 / 1000.0;
        let mut filter = format!("color=c=0x18181c:s={}x{}:r=30:d={seconds}[base0];", plan.width, plan.height);
        for (i, s) in plan.sources.iter().enumerate() {
            let d = &s.display;
            let sx = f64::from(plan.width) / plan.frame.width;
            let sy = f64::from(plan.height) / plan.frame.height;
            let w = (d.frame.width * sx).round().max(2.0) as u32;
            let h = (d.frame.height * sy).round().max(2.0) as u32;
            let x = ((d.frame.x - plan.frame.x) * sx).round() as u32;
            let y = ((d.frame.y - plan.frame.y) * sy).round() as u32;
            let start = s.offset_ms as f64 / 1000.0;
            let end = d.failed_ms.unwrap_or(plan.duration_ms) as f64 / 1000.0;
            filter.push_str(&format!("[{i}:v]setpts=PTS-STARTPTS+{start}/TB,scale={w}:{h}[tile{i}];[base{i}][tile{i}]overlay=x={x}:y={y}:eof_action=pass:repeatlast=0:enable='between(t,{start},{end})'[base{}];", i + 1));
        }
        filter.pop();
        cmd.args(["-filter_complex", &filter, "-map", &format!("[base{}]", plan.sources.len()), "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"])
            .arg(&plan.output).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        let mut child = cmd.spawn()?;
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            if let Some(status) = child.try_wait()? { anyhow::ensure!(status.success(), "desktop compositor exited {status}"); break; }
            if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); anyhow::bail!("desktop compositor exceeded 60 seconds"); }
            thread::sleep(Duration::from_millis(30));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let path = plan.output.with_extension("desktop-plan.json");
        std::fs::write(&path, serde_json::to_vec(plan)?)?;
        let result = crate::helper::compose_desktop(&path);
        let _ = std::fs::remove_file(path);
        result
    }
}

pub(crate) fn bounds(displays: &[TargetFrame]) -> Option<TargetFrame> {
    let first = *displays.first()?;
    let mut left = first.x;
    let mut top = first.y;
    let mut right = first.x + first.width;
    let mut bottom = first.y + first.height;
    for d in displays {
        if ![d.x, d.y, d.width, d.height, d.scale].iter().all(|n| n.is_finite())
            || d.width <= 0.0 || d.height <= 0.0 || d.scale <= 0.0 {
            return None;
        }
        left = left.min(d.x);
        top = top.min(d.y);
        right = right.max(d.x + d.width);
        bottom = bottom.max(d.y + d.height);
    }
    Some(TargetFrame { x: left, y: top, width: right - left, height: bottom - top, scale: 1.0 })
}

#[cfg(test)]
#[path = "desktop_tests.rs"]
mod coordinator_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_bounds_include_negative_origins_and_mixed_scale_outputs() {
        let displays = [
            TargetFrame { x: -1600.0, y: -200.0, width: 1600.0, height: 900.0, scale: 2.0 },
            TargetFrame { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
        ];
        let combined = bounds(&displays).unwrap();
        assert_eq!([combined.x, combined.y, combined.width, combined.height], [-1600.0, -200.0, 3520.0, 1280.0]);
        assert_eq!(combined.scale, 1.0, "the shared canvas uses logical coordinates, not the first output's scale");
        assert!(bounds(&[]).is_none(), "no connected outputs is not a synthetic screen");
    }
}
