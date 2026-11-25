//! Live cabled iPhone capture mirrored through `apparent-helper`. Keyframes are decoded
//! from the phone's own video, never from a screenshot of the mirror window.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;

use crate::capture::desktop::helper::{self, PhoneDevice};
use crate::capture::engine::runtime::{LiveOverlayEvent, SharedCaptureTelemetry, apparent_log};
use crate::shared::model::{
    ApparentBundle, CaptureMode, ContextChange, DeviceInfo, InteractionEvent, RgbaFrame,
    ScreenSpan, Stroke, TargetFrame, TargetInfo,
};

pub const PHONE_FRAME_EDGE: u32 = 1600;

#[derive(Default)]
struct MirrorState {
    device: Option<PhoneDevice>,
    rect: Option<[f32; 4]>,
    recording_epoch_ms: Option<u64>,
    recording_instant: Option<Instant>,
    markers_epoch_ms: Vec<u64>,
    finished: Option<(PathBuf, u64)>,
    ended: bool,
    error: Option<String>,
}

/// A running mirror: the helper's floating window shows the phone, records its native video
/// with the Mac's microphone into the bundle, and reports where the picture is on screen so
/// pointer and pen input normalize into phone-screen coordinates.
pub struct PhoneSession {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    reader: Option<JoinHandle<()>>,
    state: Arc<Mutex<MirrorState>>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    started_at: Instant,
    session_epoch_ms: u64,
    /// Held while the mirror records (not while it only previews).
    busy: Option<crate::capture::engine::bundle::retention::Recording>,
}

pub struct PhoneRecording {
    pub movie: PathBuf,
    pub device: PhoneDevice,
    /// How long after Apparent's session clock started the movie's first frame arrived.
    pub offset_ms: u64,
    /// M presses in the mirror, on the movie's clock.
    pub flags: Vec<u64>,
}

#[derive(Deserialize)]
#[serde(tag = "event", rename_all = "lowercase")]
enum MirrorEvent {
    Device(PhoneDevice),
    Rect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Recording {
        #[serde(rename = "startedAt")]
        started_at: u64,
    },
    Marker {
        at: u64,
    },
    Finished {
        path: PathBuf,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    },
    Cancelled,
    Warning {
        message: String,
    },
    Error {
        message: String,
    },
}

impl PhoneSession {
    /// Opens the live iPhone mirror window in preview mode without recording to disk yet.
    pub fn start_preview(
        device_id: Option<&str>,
        hidden: bool,
        telemetry: Option<Arc<SharedCaptureTelemetry>>,
    ) -> Result<Self> {
        Self::spawn_mirror(None, hidden, device_id, telemetry)
    }

    /// `telemetry` (when capturing through the app) receives the mirror's on-screen rect as the
    /// capture target, and hears when the helper ends the capture on its own.
    pub fn start(
        movie: &Path,
        device_id: Option<&str>,
        telemetry: Option<Arc<SharedCaptureTelemetry>>,
    ) -> Result<Self> {
        Self::spawn_mirror(Some(movie), false, device_id, telemetry)
    }

    fn spawn_mirror(
        movie: Option<&Path>,
        hidden: bool,
        device_id: Option<&str>,
        telemetry: Option<Arc<SharedCaptureTelemetry>>,
    ) -> Result<Self> {
        let session_epoch_ms = crate::shared::clock::now_epoch_ms();
        let recording =
            movie.map(|_| crate::capture::engine::bundle::retention::Recording::start());
        let mut command = Command::new(helper::path()?);
        command.arg("mirror");
        if let Some(movie) = movie {
            command.arg("--out").arg(movie);
        } else {
            command.arg("--preview");
            if hidden {
                command.arg("--hidden");
            }
        }
        if let Some(id) = device_id
            && !id.is_empty()
        {
            command.arg("--device").arg(id);
        }
        // Narration comes from the Mac's microphone: the chosen one, if any.
        if let Some(choice) = crate::capture::engine::runtime::audio::mic::choice() {
            command.args([
                "--microphone",
                &choice.id,
                "--microphone-name",
                &choice.name,
            ]);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Could not start the iPhone mirror")?;
        if let Some(telemetry) = &telemetry {
            telemetry.set_capture_source_pid(child.id());
        }
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().context("No mirror output")?;
        if let Some(stderr) = child.stderr.take() {
            let _ = std::thread::Builder::new()
                .name("apparent-phone-stderr".into())
                .spawn(move || {
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            apparent_log(trimmed.to_owned());
                        }
                    }
                });
        }
        let state = Arc::new(Mutex::new(MirrorState::default()));
        let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader_state = Arc::clone(&state);
        let reader_cancelled = Arc::clone(&cancelled);
        let reader = std::thread::Builder::new()
            .name("apparent-phone".into())
            .spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(event) = serde_json::from_str::<MirrorEvent>(&line) else {
                        continue;
                    };
                    let mut state = reader_state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    match event {
                        MirrorEvent::Device(device) => {
                            state.device = Some(device);
                        }
                        MirrorEvent::Rect {
                            x,
                            y,
                            width,
                            height,
                        } => {
                            let rect = [x as f32, y as f32, width as f32, height as f32];
                            state.rect = Some(rect);
                            if let Some(telemetry) = &telemetry {
                                *telemetry
                                    .target_frame
                                    .lock()
                                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                                    TargetFrame {
                                        x,
                                        y,
                                        width,
                                        height,
                                        scale: 2.0,
                                    };
                                if telemetry
                                    .selecting
                                    .load(std::sync::atomic::Ordering::Acquire)
                                {
                                    telemetry.set_picker_rect(Some((rect, 3)));
                                }
                            }
                        }
                        MirrorEvent::Recording { started_at } => {
                            state.recording_epoch_ms = Some(started_at);
                            state.recording_instant = Some(Instant::now());
                            if let Some(telemetry) = &telemetry {
                                telemetry
                                    .active
                                    .store(true, std::sync::atomic::Ordering::Release);
                            }
                        }
                        MirrorEvent::Marker { at } => state.markers_epoch_ms.push(at),
                        MirrorEvent::Finished { path, duration_ms } => {
                            state.finished = Some((path, duration_ms));
                            state.ended = true;
                        }
                        MirrorEvent::Cancelled => {
                            state.ended = true;
                        }
                        MirrorEvent::Warning { message } => {
                            apparent_log(format!("iPhone mirror: {message}"));
                        }
                        MirrorEvent::Error { message } => {
                            apparent_log(format!("iPhone mirror: {message}"));
                            state.error = Some(message);
                            state.ended = true;
                        }
                    }
                }
                reader_state
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .ended = true;
                // The helper ended; if Apparent didn't ask (phone unplugged, no phone, denied),
                // let the app finish or cancel the capture.
                if !reader_cancelled.load(std::sync::atomic::Ordering::Acquire)
                    && let Some(telemetry) = &telemetry
                {
                    let _ = telemetry.ui_sender.try_send(LiveOverlayEvent::PhoneEnded);
                }
            })
            .context("Could not watch the iPhone mirror")?;
        Ok(Self {
            child: Some(child),
            stdin,
            reader: Some(reader),
            state,
            cancelled,
            started_at: Instant::now(),
            session_epoch_ms,
            busy: recording,
        })
    }

    /// Transitions an open preview session into active movie recording.
    pub fn begin_recording(&mut self, movie: &Path) {
        self.started_at = Instant::now();
        self.session_epoch_ms = crate::shared::clock::now_epoch_ms();
        self.busy
            .get_or_insert_with(crate::capture::engine::bundle::retention::Recording::start);
        {
            let mut state = self.lock();
            state.recording_epoch_ms = None;
            state.recording_instant = None;
            state.markers_epoch_ms.clear();
        }
        self.send(&format!("start {}", movie.display()));
    }

    pub fn show_preview(&mut self) {
        self.send("show");
    }

    pub fn hide_preview(&mut self) {
        self.send("hide");
    }

    pub fn device(&self) -> Option<PhoneDevice> {
        self.lock().device.clone()
    }

    pub fn rect(&self) -> Option<[f32; 4]> {
        self.lock().rect
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.lock()
            .recording_instant
            .map_or(0, |t| t.elapsed().as_millis() as u64)
    }

    /// Whether the movie has started (or the capture already ended).
    pub fn has_recording(&self) -> bool {
        let state = self.lock();
        state.recording_epoch_ms.is_some() || state.finished.is_some()
    }

    /// Whether the helper process has finished, cancelled, or exited with an error.
    pub fn has_ended(&self) -> bool {
        let state = self.lock();
        state.ended || state.finished.is_some() || state.error.is_some()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MirrorState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn send(&mut self, command: &str) {
        if let Some(stdin) = self.stdin.as_mut() {
            let _ = writeln!(stdin, "{command}");
            let _ = stdin.flush();
        }
    }

    fn wait(&mut self, timeout: Duration) {
        self.stdin.take();
        if let Some(ref mut child) = self.child {
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }

    fn cancel_async(&mut self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
        self.send("cancel");
        self.stdin.take();
        let child = self.child.take();
        let reader = self.reader.take();
        if child.is_some() || reader.is_some() {
            std::thread::spawn(move || {
                if let Some(mut child) = child {
                    let deadline = Instant::now() + Duration::from_secs(2);
                    while Instant::now() < deadline {
                        if matches!(child.try_wait(), Ok(Some(_))) {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                }
                if let Some(reader) = reader {
                    let _ = reader.join();
                }
            });
        }
    }

    /// Stops recording and waits for the helper to finalize the movie.
    pub fn stop(mut self) -> Result<PhoneRecording> {
        self.send("stop");
        self.wait(Duration::from_secs(15));
        let state = std::mem::take(&mut *self.lock());
        let Some((movie, _)) = state.finished else {
            bail!(
                "{}",
                state
                    .error
                    .unwrap_or_else(|| "The iPhone recording did not finish".into())
            );
        };
        let device = state.device.context("No iPhone was attached")?;
        let started = state.recording_epoch_ms.unwrap_or(self.session_epoch_ms);
        Ok(PhoneRecording {
            movie,
            device,
            offset_ms: started.saturating_sub(self.session_epoch_ms),
            flags: state
                .markers_epoch_ms
                .iter()
                .map(|at| at.saturating_sub(started))
                .collect(),
        })
    }

    pub fn cancel(mut self) {
        self.cancel_async();
    }
}

impl Drop for PhoneSession {
    fn drop(&mut self) {
        self.cancel_async();
    }
}

pub struct MovieCapture {
    pub movie: PathBuf,
    pub target: TargetInfo,
    pub device: Option<DeviceInfo>,
    pub events: Vec<InteractionEvent>,
    pub strokes: Vec<Stroke>,
    pub flags: Vec<u64>,
    pub note: Option<String>,
    pub context: BTreeMap<String, String>,
    pub context_changes: Vec<ContextChange>,
    pub screens: Vec<ScreenSpan>,
}

/// The mirror supplies the phone name; app and bundle ID are optional metadata.
pub fn phone_target(
    name: &str,
    app: Option<&str>,
    bundle_id: Option<&str>,
    width: u32,
    height: u32,
) -> TargetInfo {
    let bundle_id = bundle_id.filter(|id| !id.is_empty()).or(app);
    TargetInfo {
        mode: CaptureMode::Device,
        app: Some(app.or(bundle_id).unwrap_or(name).to_owned()),
        bundle_id: bundle_id.map(str::to_owned),
        window_title: None,
        window_id: None,
        display_id: 0,
        frame: TargetFrame {
            x: 0.0,
            y: 0.0,
            width: f64::from(width),
            height: f64::from(height),
            scale: 1.0,
        },
    }
}

pub fn build_movie_bundle(
    bundle_dir: &Path,
    capture: MovieCapture,
) -> Result<(PathBuf, ApparentBundle, String)> {
    build_movie_bundle_with_audio(bundle_dir, capture, helper::export_audio)
}

fn build_movie_bundle_with_audio(
    bundle_dir: &Path,
    mut capture: MovieCapture,
    export_audio: impl FnOnce(&Path, &Path) -> Result<()>,
) -> Result<(PathBuf, ApparentBundle, String)> {
    use crate::capture::engine::{bundle::bundle_processing, keyframes, sketch};
    use crate::composition::{assembly, media_probe, movie_frames};
    use crate::shared::model::{KeyframeReason, Mark, Shape, TranscriptData};

    let started_at = Instant::now();
    let preparation = media_probe::phone_preparation(&capture.movie)?;
    let probe = preparation.probe;
    let wav = bundle_dir.join("audio.wav");
    let mut mark_times: Vec<u64> = sketch::marks_of(&capture.strokes)
        .into_iter()
        .map(|m| m.t1)
        .chain(capture.flags.iter().copied())
        .collect();
    mark_times.sort_unstable();
    mark_times.dedup();
    let ((mut transcript, audio_ms, transcribe_ms, audio_err), joined) = std::thread::scope(|scope| {
        let base_target = capture.target.clone();
        let strokes_ref = &capture.strokes;
        let events_ref = &capture.events;
        let flags_ref = &capture.flags;
        let movie_ref = &capture.movie;
        let frames = scope.spawn(move || -> Result<_> {
            let mut target = base_target;
            if probe.width > 0 && probe.height > 0 {
                target.frame.width = f64::from(probe.width);
                target.frame.height = f64::from(probe.height);
            }
            let t0 = Instant::now();
            let assembly_plan = assembly::plan(probe.duration_ms)?;
            let limits = assembly_plan.limits(probe.duration_ms)?;
            let budget = limits.maximum;
            if mark_times.len() >= budget {
                let direct =
                    movie_frames::record(movie_ref, &mark_times, 0, PHONE_FRAME_EDGE);
                let decode_ms = t0.elapsed().as_millis() as u64;
                if let Ok(raw_frames) = direct
                    && !raw_frames.is_empty()
                {
                    let mut preview_marks = sketch::marks_of(strokes_ref);
                    for (i, &t) in flags_ref.iter().enumerate() {
                        preview_marks.push(Mark {
                            id: format!("f{}", i + 1),
                            strokes: Vec::new(),
                            t0: t,
                            t1: t,
                            box_norm: [0.0, 0.0, 1.0, 1.0],
                            shape: Shape::Flag,
                            from: None,
                            to: None,
                            pin: None,
                            on: None,
                            description: "flagged this moment".into(),
                            frame: None,
                        });
                    }
                    let preview = keyframes::select_keyframes_with_limits(
                        &raw_frames,
                        strokes_ref,
                        &mut preview_marks,
                        events_ref,
                        &keyframes::SpeechInput::empty(&TranscriptData::default()),
                        limits,
                        None,
                    )?.frames;
                    if preview.len() == budget
                        && preview.iter().all(|(k, _)| k.reason == KeyframeReason::Mark)
                    {
                        let prep =
                            bundle_processing::prepare_visuals(
                                preview,
                                raw_frames.first(),
                                None,
                                &target,
                                probe.duration_ms,
                                strokes_ref,
                                &preview_marks,
                                events_ref,
                                &crate::shared::windows::ActivityLog::default(),
                                None,
                            );
                        return Ok((probe, raw_frames, decode_ms, true, prep, assembly_plan));
                    }
                }
            }
            let res = movie_frames::record_phone_candidates(movie_ref, probe.duration_ms)?;
            Ok((probe, res, t0.elapsed().as_millis() as u64, false, None, assembly_plan))
        });
        let audio_started = Instant::now();
        let exported = (|| {
            if matches!(preparation.audio, media_probe::PhoneAudio::SkipAbsent) {
                return Ok(None);
            }
            // Both native writers overwrite this held private file. Validate the
            // WAV before publishing it; failures drop only the owned temporary.
            // Inheriting a group-writable umask must not invalidate the bundle.
            let mut staged = tempfile::Builder::new()
                .prefix(".audio-export-")
                .suffix(".wav")
                .tempfile_in(bundle_dir)?;
            export_audio(&capture.movie, staged.path())?;
            let mut bytes = Vec::new();
            staged.as_file_mut().read_to_end(&mut bytes)?;
            let audio =
                crate::capture::engine::runtime::audio::audio::recorded_audio_from_wav(bytes)?;
            staged
                .persist(&wav)
                .context("Could not publish extracted audio")?;
            Ok::<_, anyhow::Error>(Some(audio))
        })();
        let audio_ms = audio_started.elapsed().as_millis() as u64;
        let (audio, audio_err) = match exported {
            Ok(a) => (a, None),
            Err(e) => (None, Some(e)),
        };
        let t0 = Instant::now();
        let transcript =
            crate::capture::engine::runtime::audio::transcription::transcribe::transcribe(
                audio.as_ref().map(|_| wav.as_path()),
                audio.as_ref(),
            );
        let transcribe_ms = t0.elapsed().as_millis() as u64;
        (
            (transcript, audio_ms, transcribe_ms, audio_err),
            frames.join(),
        )
    });
    let (probe, frames, candidates_ms, already_full, prepared, assembly_plan) =
        joined.map_err(|_| anyhow::anyhow!("Frame decoding panicked"))??;
    if let Some(error) = audio_err {
        apparent_log(format!("Movie audio extraction failed: {error:#}"));
        if capture.device.is_none() {
            transcript.missing = Some(crate::shared::model::MissingTranscript {
                reason: "The movie audio could not be decoded for transcription.".into(),
                retry: false,
            });
        }
    }
    if probe.width > 0 && probe.height > 0 {
        if let Some(device) = &mut capture.device {
            device.width = probe.width;
            device.height = probe.height;
        }
        capture.target.frame.width = f64::from(probe.width);
        capture.target.frame.height = f64::from(probe.height);
    }
    ensure!(!frames.is_empty(), "No frames could be decoded");
    let movie = capture.movie.clone();
    let extras = bundle_processing::SourceExtras {
        source: Some(if capture.device.is_some() { "iphone" } else { crate::shared::model::IMPORTED_MOVIE_SOURCE }.into()),
        device: capture.device,
        context: capture.context,
        context_changes: capture.context_changes,
        screens: capture.screens,
        flags: capture.flags,
        full_frames: (!already_full).then(
            || -> bundle_processing::FullFrames {
                Box::new(move |times: &[u64]| -> Result<Vec<RgbaFrame>> {
                    movie_frames::record(&movie, times, 0, PHONE_FRAME_EDGE)
                })
            },
        ),
        prepared,
        assembly_plan: Some(assembly_plan),
        timings: bundle_processing::StageTimings {
            started_at: Some(started_at),
            audio_ms: Some(audio_ms),
            candidates_ms: Some(candidates_ms),
            transcribe_ms: Some(transcribe_ms),
            ..Default::default()
        },
        ..Default::default()
    };
    bundle_processing::build_bundle_from_parts(
        bundle_dir,
        capture.target,
        probe.duration_ms,
        frames,
        capture.strokes,
        capture.events,
        transcript,
        Some(capture.movie),
        capture.note,
        extras,
    )
}

/// Finishes a live capture: re-bases Apparent's pointer and pen input onto the movie's clock.
pub fn finalize_live_capture(
    bundle_dir: &Path,
    recording: PhoneRecording,
    mut events: Vec<InteractionEvent>,
    mut strokes: Vec<Stroke>,
    note: Option<String>,
) -> Result<(PathBuf, ApparentBundle, String)> {
    events.retain_mut(|event| event.rebase(recording.offset_ms));
    strokes.retain_mut(|stroke| stroke.rebase(recording.offset_ms));
    let device = &recording.device;
    let target = phone_target(&device.name, None, None, device.width, device.height);
    let info = DeviceInfo {
        name: device.name.clone(),
        capture: "mirror".into(),
        id: Some(device.id.clone()),
        model: Some(device.model.clone()),
        width: device.width,
        height: device.height,
        ..Default::default()
    };
    let built = build_movie_bundle(
        bundle_dir,
        MovieCapture {
            movie: recording.movie,
            target,
            device: Some(info),
            events,
            strokes,
            flags: recording.flags,
            note,
            context: BTreeMap::new(),
            context_changes: Vec::new(),
            screens: Vec::new(),
        },
    )?;
    Ok(built)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_movie_uses_published_metadata_and_preserves_its_source() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::Builder::new().permissions(std::fs::Permissions::from_mode(0o700)).tempdir().unwrap();
        let source = root.path().join("source.mp4");
        let movie = root.path().join("recording.mp4");
        let made = Command::new("ffmpeg").args(["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i",
            "color=c=red:s=64x48:r=10:d=1,drawbox=x=32:y=0:w=32:h=48:color=blue:t=fill", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p"])
            .arg(&source).output().unwrap();
        assert!(made.status.success(), "{}", String::from_utf8_lossy(&made.stderr));
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o600)).unwrap();
        let rotated = Command::new("ffmpeg").args(["-v", "error", "-nostdin", "-y", "-display_rotation:v:0", "90", "-i"])
            .arg(source).args(["-map", "0", "-c", "copy"]).arg(&movie).output().unwrap();
        assert!(rotated.status.success(), "{}", String::from_utf8_lossy(&rotated.stderr));
        std::fs::set_permissions(&movie, std::fs::Permissions::from_mode(0o600)).unwrap();
        let original = std::fs::read(&movie).unwrap();
        let reference = Command::new("ffmpeg").args(["-v", "error", "-nostdin", "-i"]).arg(&movie)
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"]).output().unwrap();
        assert!(reference.status.success()); assert_eq!(reference.stdout.len(), 48 * 64 * 4);
        let (_, bundle, text) = build_movie_bundle_with_audio(root.path(), MovieCapture {
            movie: movie.clone(), target: phone_target("Synthetic file", None, None, 1, 1),
            device: Some(serde_json::from_value(serde_json::json!({"name":"Synthetic file", "capture":"mirror", "width":1, "height":1})).unwrap()),
            events: Vec::new(), strokes: Vec::new(), flags: Vec::new(), note: None,
            context: BTreeMap::new(), context_changes: Vec::new(), screens: Vec::new(),
        }, |_, _| panic!("Record must not invoke native audio extraction for a trackless movie")).unwrap();
        assert_eq!((bundle.target.frame.width, bundle.target.frame.height, bundle.duration_ms), (48.0, 64.0, 1000));
        assert!(!bundle.keyframes.is_empty()); assert!(!text.is_empty());
        assert_eq!(std::fs::read(movie).unwrap(), original);
        for frame in &bundle.keyframes {
            let png = std::fs::read(root.path().join(&frame.file)).unwrap();
            let decoded = crate::capture::engine::render::decode_png(std::io::Cursor::new(png)).unwrap();
            assert_eq!((decoded.width, decoded.height), (48, 64));
            for y in [16, 48] {
                let index = (y * 48 + 24) * 4;
                assert_eq!(decoded.rgba[index] > decoded.rgba[index + 2],
                    reference.stdout[index] > reference.stdout[index + 2], "display rotation must preserve image orientation");
            }
        }
    }

    #[test]
    fn mirror_target_has_device_identity_without_app_bundle_id() {
        let target = phone_target("iPhone", None, None, 1320, 2868);
        assert_eq!(target.mode, CaptureMode::Device);
        assert_eq!(target.app.as_deref(), Some("iPhone"));
        assert_eq!(target.bundle_id, None);
        assert_eq!(target.frame.width, 1320.0);
    }
}
