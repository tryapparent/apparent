//! Movies on Linux, through GStreamer (on every GNOME and KDE desktop): recording the screen
//! (`ximagesrc` on X11; on Wayland `pipewiresrc` fed by the ScreenCast portal or GNOME's own
//! screencast API, `super::portal`) into an H.264 MP4 while handing small candidate frames to
//! keyframe selection, and extracting movie audio for transcription.
//!
//! The encoder is the first one installed of `x264enc` (gst-plugins-ugly), `openh264enc`
//! (gst-plugins-bad) and VA-API's. A missing encoder refuses to start a screen capture;
//! a movie that fails after capture starts still retains the candidate frames.

use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail, ensure};
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;

use crate::capture::engine::runtime::{CANDIDATE_EDGE, CANDIDATE_EDGE_NO_VIDEO, Sampler, apparent_log};
use crate::shared::model::{CaptureMode, RgbaFrame};

const FPS: u32 = 30;

fn init() -> Result<()> {
    static READY: OnceLock<bool> = OnceLock::new();
    let ready = *READY.get_or_init(|| match gst::init() {
        Ok(()) => true,
        Err(error) => {
            apparent_log(format!("GStreamer failed to start: {error}"));
            false
        }
    });
    ensure!(ready, "GStreamer is not available");
    Ok(())
}

/// The pixels to retain from a verified PipeWire source.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub rect: [u32; 4],
    /// A guarded fallback must receive these exact pixels before cropping.
    pub source_size: Option<[u32; 2]>,
}

/// Where a recording's pixels come from.
pub enum Source {
    #[cfg(test)]
    Test,
    /// A rect of the X screen (global pixels), `ximagesrc`.
    X11 { rect: [f64; 4] },
    /// One X11 window, `ximagesrc xid=`: it follows the window and leaves out what covers it.
    X11Window { xid: u32 },
    /// A PipeWire stream from the ScreenCast portal or Mutter (`pipewiresrc`). `crop` is the
    /// part of the stream to keep (stream pixels), for an area of a display.
    PipeWire {
        session: super::portal::Stream,
        crop: Option<Crop>,
    },
}

/// The first H.264 encoder installed, with the settings that suit screen recordings.
fn encoder() -> Option<&'static str> {
    [
        "x264enc tune=zerolatency speed-preset=veryfast key-int-max=60 bitrate=6000",
        "openh264enc complexity=low bitrate=6000000 gop-size=60",
        "vah264enc",
        "vaapih264enc",
    ]
    .into_iter()
    .find(|launch| {
        let name = launch.split_whitespace().next().unwrap_or_default();
        gst::ElementFactory::find(name).is_some()
    })
}

/// Whether a movie can be recorded: GStreamer runs and has an H.264 encoder.
pub fn can_record_video() -> bool {
    init().is_ok() && encoder().is_some()
}

fn encoder_repair_for(distro: &str) -> &'static str {
    match distro {
        "arch" | "archarm" | "omarchy" | "manjaro" | "endeavouros" => {
            "sudo pacman -S gst-plugins-ugly"
        }
        "ubuntu" | "debian" | "linuxmint" | "pop" => "sudo apt install gstreamer1.0-plugins-ugly",
        "fedora" => "sudo dnf install gstreamer1-plugins-ugly",
        _ => "Install your distribution's GStreamer H.264 encoder (often gst-plugins-ugly)",
    }
}

fn host_distro() -> String {
    let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    os_release
        .lines()
        .find_map(|line| line.strip_prefix("ID="))
        .unwrap_or_default()
        .trim_matches('"')
        .to_owned()
}

/// Check before starting a screen capture, including the CLI path. Never install packages here.
pub fn encoder_warning() -> Option<String> {
    static CHECK: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    let result = CHECK.get_or_init(|| {
        init().map_err(|error| error.to_string())?;
        let selected = encoder().ok_or("No H.264 encoder plugin is installed")?;
        let directory = preflight_directory().map_err(|error| error.to_string())?;
        let movie = directory.join("encoder-check.mp4");
        let result = encode_synthetic(&movie, selected, true).map_err(|error| error.to_string());
        let _ = std::fs::remove_file(&movie);
        let _ = std::fs::remove_dir(directory);
        result
    });
    result.as_ref().err().map(|reason| {
        encoder_diagnostic(
            reason,
            std::env::var_os("APPIMAGE").is_some(),
            &host_distro(),
        )
    })
}

/// Exclusively create a private directory before GStreamer's filesink opens its output.
fn preflight_directory() -> Result<PathBuf> {
    for attempt in 0..16 {
        let directory = std::env::temp_dir().join(format!(
            "apparent-encoder-check-{}-{}-{attempt}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ));
        match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    bail!("Could not create a private H.264 encoder-check directory")
}

fn encoder_diagnostic(reason: &str, packaged: bool, distro: &str) -> String {
    if packaged {
        format!(
            "H.264 encoder failed in this Apparent AppImage ({reason}). Install a fresh Apparent AppImage; host GStreamer packages cannot repair its bundled runtime. No recording was started."
        )
    } else {
        format!(
            "H.264 encoder failed ({reason}). Install: {}. Restart Apparent, then retry. No recording was started.",
            encoder_repair_for(distro)
        )
    }
}

/// Exercise capture's encoder in the packaged process. Composition must verify
/// the resulting movie through the published decoder used by real consumers.
pub fn encode_check_movie(movie: &Path) -> Result<()> {
    init()?;
    let selected = encoder().ok_or_else(|| anyhow!("No H.264 encoder plugin is installed"))?;
    encode_synthetic(movie, selected, false)
}

fn encode_synthetic(movie: &Path, selected: &str, diagnose: bool) -> Result<()> {
    let launch = format!(
        "videotestsrc num-buffers=12 ! video/x-raw,width=160,height=90,framerate=10/1 ! videoconvert ! video/x-raw,format=I420 ! {selected} ! h264parse ! mp4mux ! filesink name=encoder_output"
    );
    let pipeline = gst::parse::launch(&launch)?
        .downcast::<gst::Pipeline>()
        .map_err(|_| anyhow!("Not a pipeline"))?;
    pipeline
        .by_name("encoder_output")
        .context("Encoder pipeline has no output sink")?
        .set_property("location", movie.to_string_lossy().as_ref());
    let result = (|| {
        pipeline.set_state(gst::State::Playing)?;
        let bus = pipeline.bus().context("Encoder pipeline has no bus")?;
        match bus.timed_pop_filtered(
            gst::ClockTime::from_seconds(10),
            &[gst::MessageType::Eos, gst::MessageType::Error],
        ) {
            Some(message) => match message.view() {
                gst::MessageView::Eos(..) => Ok(()),
                gst::MessageView::Error(error) => {
                    if diagnose {
                        let detail = error.debug().unwrap_or_default();
                        let debug = safe_encoder_debug(&detail, movie);
                        let domain = error.error().domain().as_str();
                        let code = error.error().code();
                        let source = error
                            .src()
                            .map(|source| safe_encoder_field(&source.name()))
                            .unwrap_or_else(|| "unknown".to_owned());
                        crate::capture::engine::runtime::apparent_log(format!(
                            "H.264 encoder preflight failed stage=synthetic_encode domain={domain} code={code} source={source} debug={debug} output=encoder-check.mp4"
                        ));
                    }
                    bail!("H.264 encoding failed: {error}");
                }
                _ => unreachable!(),
            },
            None => bail!("H.264 encoding timed out"),
        }
    })();
    let _ = pipeline.set_state(gst::State::Null);
    result?;
    ensure!(
        std::fs::metadata(movie)?.len() > 1024,
        "H.264 movie is empty"
    );
    Ok(())
}

fn safe_encoder_field(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(160)
        .collect()
}

fn safe_encoder_debug(value: &str, movie: &Path) -> String {
    let mut safe = value.to_owned();
    if let Some(parent) = movie.parent() {
        safe = safe.replace(&parent.to_string_lossy().to_string(), "<private-temp>");
    }
    if let Some(home) = std::env::var_os("HOME") {
        safe = safe.replace(&home.to_string_lossy().to_string(), "<home>");
    }
    safe_encoder_field(&safe)
}

/// Check this process's registry, not the host's gst-inspect executable.
pub fn h264_decoder_available() -> bool {
    if init().is_err() { return false; }
    let caps = gst::Caps::builder("video/x-h264").build();
    gst::ElementFactory::factories_with_type(
        gst::ElementFactoryType::DECODER | gst::ElementFactoryType::MEDIA_VIDEO,
        gst::Rank::MARGINAL,
    ).iter().any(|factory| factory.can_sink_any_caps(&caps) && factory.create().build().is_ok())
}

fn decoder_repair_for(distro: &str) -> &'static str {
    match distro {
        "arch" | "archarm" | "omarchy" | "manjaro" | "endeavouros" => "sudo pacman -S gst-libav",
        "ubuntu" | "debian" | "linuxmint" | "pop" => "sudo apt install gstreamer1.0-libav",
        "fedora" => "sudo dnf install gstreamer1-plugin-libav",
        _ => "Install your distribution's GStreamer H.264 decoder (often gst-libav)",
    }
}

pub fn decoder_warning() -> Option<String> {
    if h264_decoder_available() { return None; }
    Some(format!(
        "H.264 decoder missing. Install: {}. Restart Apparent. MP4 recording may work, but full-quality keyframes use smaller candidate frames until fixed.",
        decoder_repair_for(&host_distro())
    ))
}

fn source_launch(source: &Source) -> String {
    match source {
        #[cfg(test)]
        Source::Test => "videotestsrc is-live=true pattern=smpte".to_owned(),
        Source::X11 { rect } => {
            let [x, y, w, h] = rect.map(|v| v.round() as i64);
            format!(
                "ximagesrc use-damage=false show-pointer=true startx={x} starty={y} endx={} endy={}",
                (x + w - 1).max(x),
                (y + h - 1).max(y)
            )
        }
        Source::X11Window { xid } => {
            format!("ximagesrc use-damage=false show-pointer=true xid={xid}")
        }
        Source::PipeWire { session, crop } => {
            let mut launch = format!(
                "pipewiresrc fd={} path={} do-timestamp=true keepalive-time=500 always-copy=true",
                session.fd(),
                session.node
            );
            if let Some(crop) = crop {
                // `videocrop` trims from each edge; the stream's size is only known once it
                // runs, so `crop_edges` fills them in when the caps arrive.
                launch.push_str(&crop_launch(crop));
            }
            launch
        }
    }
}

fn crop_launch(crop: &Crop) -> String {
    let mut launch = String::new();
    if let Some([width, height]) = crop.source_size {
        // No scaler precedes this filter. Portal size is compositor metadata,
        // not proof of video pixels: incompatible source caps must fail closed.
        launch.push_str(&format!(
            " ! video/x-raw,width={width},height={height},pixel-aspect-ratio=1/1"
        ));
    }
    launch.push_str(" ! videoconvert ! videocrop name=crop");
    launch
}

/// A running recording: GStreamer pushes frames through; Apparent samples the newest one.
struct Recorder {
    pipeline: gst::Pipeline,
    candidates: gst_app::AppSink,
    out: (u32, u32),
    candidate: (u32, u32),
    video: bool,
    first_frame_ms: Arc<AtomicU64>,
    last: Option<Vec<u8>>,
}

impl Recorder {
    fn new(
        source: &Source,
        out: (u32, u32),
        candidate: (u32, u32),
        movie: Option<&Path>,
        started_at: Instant,
    ) -> Result<Self> {
        init()?;
        let encoder = movie.and(encoder());
        let (w, h) = out;
        let (cw, ch) = candidate;
        let mut launch = format!(
            "{} ! queue max-size-buffers=4 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width={w},height={h},pixel-aspect-ratio=1/1 ! tee name=t \
             t. ! queue max-size-buffers=2 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,format=RGBA,width={cw},height={ch},pixel-aspect-ratio=1/1 ! appsink name=candidates max-buffers=1 drop=true sync=false emit-signals=false",
            source_launch(source)
        );
        if let (Some(encoder), Some(movie)) = (encoder, movie) {
            launch.push_str(&format!(
                " t. ! queue max-size-time=3000000000 max-size-buffers=0 max-size-bytes=0 ! videorate ! video/x-raw,framerate={FPS}/1 ! videoconvert ! video/x-raw,format=I420 ! {encoder} name=encoder ! h264parse ! mp4mux faststart=true ! filesink name=movie_sink location=\"{}\"",
                movie.display().to_string().replace('"', "\\\"")
            ));
        }
        let pipeline = gst::parse::launch(&launch)
            .with_context(|| format!("Could not build the recording pipeline: {launch}"))?
            .downcast::<gst::Pipeline>()
            .map_err(|_| anyhow!("Not a pipeline"))?;
        // The candidate sink can hold back pipeline EOS after the movie sink has finished.
        // Forward child EOS so finish() can distinguish a completed MP4 from an unfinished one.
        pipeline.set_property("message-forward", true);
        if let (Source::PipeWire { crop: Some(crop), .. }, Some(element)) =
            (source, pipeline.by_name("crop"))
        {
            crop_edges(&element, crop.rect);
        }
        let candidates = pipeline
            .by_name("candidates")
            .context("No candidate sink")?
            .downcast::<gst_app::AppSink>()
            .map_err(|_| anyhow!("Not an appsink"))?;
        let first_frame_ms = Arc::new(AtomicU64::new(u64::MAX));
        let video = encoder.is_some();
        if let Some(sink) = pipeline
            .by_name("encoder")
            .and_then(|e| e.static_pad("sink"))
        {
            // The movie starts at its first frame: note when that was on the capture clock, and
            // shift every frame so the movie's clock starts at zero.
            let first = Arc::clone(&first_frame_ms);
            let base: Arc<Mutex<Option<gst::ClockTime>>> = Arc::new(Mutex::new(None));
            sink.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() {
                    let mut base = base.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    let pts = buffer.pts();
                    if base.is_none() {
                        *base = pts;
                        first.store(started_at.elapsed().as_millis() as u64, Ordering::Release);
                    }
                    if let (Some(pts), Some(zero)) = (pts, *base) {
                        let buffer = buffer.make_mut();
                        buffer.set_pts(pts.saturating_sub(zero));
                        buffer.set_dts(gst::ClockTime::NONE);
                    }
                }
                gst::PadProbeReturn::Ok
            });
        }
        pipeline
            .set_state(gst::State::Playing)
            .context("The recording pipeline wouldn't start")?;
        Ok(Self {
            pipeline,
            candidates,
            out,
            candidate,
            video,
            first_frame_ms,
            last: None,
        })
    }

    /// An error the pipeline posted since the last look.
    fn error(&self) -> Option<String> {
        let bus = self.pipeline.bus()?;
        while let Some(message) = bus.pop() {
            if let gst::MessageView::Error(error) = message.view() {
                return Some(format!(
                    "{} ({})",
                    error.error(),
                    error.debug().unwrap_or_default()
                ));
            }
        }
        None
    }

    /// The newest frame, or the last one again: compositors send frames only when the screen
    /// changes.
    fn candidate(&mut self, t_ms: u64, masks: &[[f64; 4]]) -> Option<RgbaFrame> {
        let (w, h) = self.candidate;
        if let Some(sample) = self.candidates.try_pull_sample(gst::ClockTime::ZERO)
            && let Some(mut rgba) = rgba_of(&sample, w, h)
        {
            for &rect in masks {
                mask(&mut rgba, w, h, rect);
            }
            self.last = Some(rgba);
        }
        let rgba = self.last.clone()?;
        Some(RgbaFrame::new(t_ms, w, h, rgba))
    }

    /// Sends end-of-stream and waits (a few seconds at most) for the movie to be finished.
    fn finish(self) -> bool {
        if !self.pipeline.send_event(gst::event::Eos::new()) {
            apparent_log("Movie failed to finish: end of stream was rejected");
            let _ = self.pipeline.set_state(gst::State::Null);
            return false;
        }
        let deadline = Instant::now() + Duration::from_secs(8);
        let movie_sink = self.pipeline.by_name("movie_sink");
        let (message, movie_finished) = self.pipeline.bus().map_or((None, false), |bus| {
            loop {
                if Instant::now() >= deadline {
                    break (None, false);
                }
                // The candidate sink holds end-of-stream back until its last frame is taken.
                while self
                    .candidates
                    .try_pull_sample(gst::ClockTime::ZERO)
                    .is_some()
                {}
                let message = bus.timed_pop_filtered(
                    gst::ClockTime::from_mseconds(20),
                    &[
                        gst::MessageType::Eos,
                        gst::MessageType::Error,
                        gst::MessageType::Element,
                    ],
                );
                if let Some(message) = &message {
                    if message.type_() == gst::MessageType::Element
                        && let Some(forwarded) = message.structure()
                        && forwarded.name() == "GstBinForwarded"
                        && let Ok(child) = forwarded.get::<gst::Message>("message")
                        && child.type_() == gst::MessageType::Eos
                        && movie_sink
                            .as_ref()
                            .is_some_and(|sink| child.src() == Some(sink.upcast_ref()))
                    {
                        break (None, true);
                    }
                    if message.type_() == gst::MessageType::Element {
                        continue;
                    }
                    break (Some(message.clone()), false);
                }
            }
        });
        let finished = match message.as_ref().map(|m| m.view()) {
            Some(gst::MessageView::Eos(_)) => true,
            Some(gst::MessageView::Error(error)) => {
                apparent_log(format!("Movie failed to finish: {}", error.error()));
                false
            }
            _ if movie_finished => true,
            _ => {
                apparent_log("Movie failed to finish: no end of stream within 8 s");
                false
            }
        };
        let _ = self.pipeline.set_state(gst::State::Null);
        finished && self.video
    }
}

/// `videocrop`'s edges for keeping `[x, y, w, h]` of the stream, set once its size is known.
fn crop_edges(element: &gst::Element, crop: [u32; 4]) {
    let Some(pad) = element.static_pad("sink") else {
        return;
    };
    let element = element.downgrade();
    pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM, move |_, info| {
        if let Some(gst::PadProbeData::Event(event)) = info.data.as_ref()
            && let gst::EventView::Caps(caps) = event.view()
            && let Some(s) = caps.caps().structure(0)
            && let (Ok(width), Ok(height)) = (s.get::<i32>("width"), s.get::<i32>("height"))
            && let Some(element) = element.upgrade()
        {
            let [x, y, w, h] = crop.map(|v| v as i32);
            element.set_property("left", x.clamp(0, width));
            element.set_property("top", y.clamp(0, height));
            element.set_property("right", (width - x - w).clamp(0, width));
            element.set_property("bottom", (height - y - h).clamp(0, height));
        }
        gst::PadProbeReturn::Ok
    });
}

/// A sample's RGBA pixels, rows packed (`width * 4` bytes each).
fn rgba_of(sample: &gst::Sample, width: u32, height: u32) -> Option<Vec<u8>> {
    let buffer = sample.buffer()?;
    let map = buffer.map_readable().ok()?;
    let info = sample
        .caps()
        .and_then(|caps| gstreamer_video::VideoInfo::from_caps(caps).ok());
    let stride = info
        .as_ref()
        .and_then(|i| i.stride().first().copied())
        .map_or(width as usize * 4, |s| s.max(0) as usize);
    let row = width as usize * 4;
    if stride == row {
        return map.get(..row * height as usize).map(<[u8]>::to_vec);
    }
    let mut out = Vec::with_capacity(row * height as usize);
    for y in 0..height as usize {
        out.extend_from_slice(map.get(y * stride..y * stride + row)?);
    }
    Some(out)
}

/// Paints `rect` (frame pixels) over with the row just below it (or above, at the bottom).
fn mask(rgba: &mut [u8], width: u32, height: u32, rect: [f64; 4]) {
    let (w, h) = (width as usize, height as usize);
    let x0 = (rect[0].floor().max(0.0) as usize).min(w);
    let y0 = (rect[1].floor().max(0.0) as usize).min(h);
    let x1 = ((rect[0] + rect[2]).ceil().max(0.0) as usize).min(w);
    let y1 = ((rect[1] + rect[3]).ceil().max(0.0) as usize).min(h);
    if x0 >= x1 || y0 >= y1 {
        return;
    }
    let source = if y1 < h {
        y1
    } else if y0 > 0 {
        y0 - 1
    } else {
        return;
    };
    let row: Vec<u8> = rgba[(source * w + x0) * 4..(source * w + x1) * 4].to_vec();
    for y in y0..y1 {
        rgba[(y * w + x0) * 4..(y * w + x1) * 4].copy_from_slice(&row);
    }
}

/// Apparent's floating windows (the pill) over `frame` (global pixels), in the candidates' pixels:
/// X11 and GNOME record every window, so the candidates leave them out to keep the pill's clock
/// from counting as activity. The ink overlay and picker cover a whole monitor and are skipped.
fn own_window_masks(ids: &[u32], frame: [f64; 4], candidate: (u32, u32)) -> Vec<[f64; 4]> {
    let [fx, fy, fw, fh] = frame;
    let (sx, sy) = (f64::from(candidate.0) / fw, f64::from(candidate.1) / fh);
    ids.iter()
        .filter_map(|&id| super::super::window_info(id as isize))
        .filter(|w| w.on_screen() && w.rect[2] * w.rect[3] < fw * fh * 0.5)
        .map(|w| {
            let [x, y, ww, wh] = w.rect;
            [(x - fx) * sx, (y - fy) * sy, ww * sx, wh * sy]
        })
        .collect()
}

/// The recording thread: see `crate::capture::engine::runtime::Sampler`.
pub fn run_sampler(sampler: Sampler) -> Option<PathBuf> {
    let Sampler {
        target,
        video_output_path,
        started_at,
        stopping,
        urgent,
        frames,
        real_frame_seen,
        startup_failed,
        video_offset_ms,
        excluded_window_ids,
    } = sampler;
    let long_edge = if target.mode == CaptureMode::Display {
        2560.0
    } else {
        1280.0
    };
    let out = crate::capture::engine::runtime::capture_size(&target, long_edge);
    let movie = video_output_path.as_deref().filter(|_| can_record_video());
    let edge = if movie.is_some() {
        CANDIDATE_EDGE
    } else {
        CANDIDATE_EDGE_NO_VIDEO
    };
    let candidate = crate::capture::engine::runtime::capture_size(&target, edge);
    let recorder = super::portal::source_for(&target, &stopping).and_then(|source| {
        Recorder::new(&source, out, candidate, movie, started_at)
            .map_err(|error| anyhow!("{error:#}"))
            // The source (a portal session) lives as long as the recording.
            .map(|recorder| (recorder, source))
    });
    let mut recorder = match recorder {
        Ok(recorder) => {
            apparent_log(format!(
                "Recording {}x{} ({:?}){}",
                out.0,
                out.1,
                target.mode,
                if recorder.0.video { "" } else { ", no movie" }
            ));
            Some(recorder)
        }
        Err(error) => {
            apparent_log(format!("Screen capture failed to start: {error:#}"));
            startup_failed.store(true, Ordering::Release);
            None
        }
    };
    crate::capture::desktop::start_metric("sck_ready_ms", started_at);
    let mut last_sample = Instant::now()
        .checked_sub(crate::capture::engine::runtime::FRAME_SAMPLE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut offset_set = false;
    let records_others = !matches!(
        recorder.as_ref().map(|(_, source)| source),
        Some(Source::X11Window { .. })
    );
    let f = target.frame;
    let mut masks = (Instant::now(), Vec::new());
    let mut masks_read = false;
    while !stopping.load(Ordering::Acquire) {
        if records_others && (!masks_read || masks.0.elapsed() >= Duration::from_millis(500)) {
            let ids = excluded_window_ids
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            masks = (
                Instant::now(),
                own_window_masks(&ids, [f.x, f.y, f.width, f.height], candidate),
            );
            masks_read = true;
        }
        if let Some((r, _)) = recorder.as_ref() {
            if let Some(error) = r.error() {
                apparent_log(format!("Recording failed: {error}"));
                // Publish before native teardown, which need not end the sampler thread.
                startup_failed.store(true, Ordering::Release);
                if let Some((r, _)) = recorder.take() {
                    let _ = r.pipeline.set_state(gst::State::Null);
                }
            } else if !offset_set {
                let first = r.first_frame_ms.load(Ordering::Acquire);
                if first != u64::MAX {
                    video_offset_ms.store(first, Ordering::Release);
                    offset_set = true;
                }
            }
        }
        let is_urgent = urgent.swap(false, Ordering::AcqRel);
        let interval = frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .interval();
        if is_urgent || last_sample.elapsed() >= interval {
            last_sample = Instant::now();
            let t_ms = started_at.elapsed().as_millis() as u64;
            let frame = match recorder.as_mut() {
                // No frame from the compositor yet: look again on the next turn.
                Some((r, _)) => r.candidate(t_ms, &masks.1),
                None => None,
            };
            match frame {
                Some(frame) => crate::capture::engine::runtime::push_candidate(
                    &frames, &real_frame_seen, frame, is_urgent, true,
                ),
                None if is_urgent => urgent.store(true, Ordering::Release),
                None => {}
            }
        }
        std::thread::park_timeout(Duration::from_millis(8));
    }
    let (recorder, _source) = recorder?;
    let _ = recorder.out;
    if recorder.finish() {
        video_output_path
    } else {
        if let Some(path) = &video_output_path {
            let _ = std::fs::remove_file(path);
        }
        None
    }
}

/// The movie's first audio track, 16 kHz mono, with silence before its first sample so audio
/// time is movie time.
fn audio_samples(movie: &Path) -> Result<(u64, Vec<f32>)> {
    init()?;
    let launch = format!(
        "filesrc location=\"{}\" ! decodebin ! audioconvert ! audioresample ! audio/x-raw,format=F32LE,rate=16000,channels=1,layout=interleaved ! appsink name=sink sync=false",
        movie.display().to_string().replace('"', "\\\"")
    );
    let pipeline = gst::parse::launch(&launch)?
        .downcast::<gst::Pipeline>()
        .map_err(|_| anyhow!("Not a pipeline"))?;
    let sink = pipeline
        .by_name("sink")
        .context("No sink")?
        .downcast::<gst_app::AppSink>()
        .map_err(|_| anyhow!("Not an appsink"))?;
    pipeline.set_state(gst::State::Playing)?;
    let mut samples: Vec<f32> = Vec::new();
    let mut first_ms = None;
    while let Some(sample) = sink.try_pull_sample(gst::ClockTime::from_seconds(10)) {
        let Some(buffer) = sample.buffer() else {
            continue;
        };
        if first_ms.is_none() {
            let start = buffer.pts().map_or(0, gst::ClockTime::mseconds);
            first_ms = Some(start);
            samples.resize((start * 16) as usize, 0.0);
        }
        let map = buffer.map_readable()?;
        samples.extend(
            map.chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        );
    }
    let _ = pipeline.set_state(gst::State::Null);
    Ok((first_ms.unwrap_or(0), samples))
}

/// Mixes a movie's audio to 16 kHz mono WAV, aligned to the movie's start.
pub fn export_audio(movie: &Path, wav: &Path) -> Result<()> {
    let (_, samples) = audio_samples(movie)?;
    ensure!(!samples.is_empty(), "{} has no audio", movie.display());
    std::fs::write(wav, crate::capture::engine::runtime::audio::audio::encode_wav_16k(&samples)?)
        .with_context(|| format!("Could not write {}", wav.display()))
}

pub fn shrink(_movie: &Path, _out: &Path, _max_edge: u32) -> Result<crate::capture::engine::bundle::retention::Shrunk> {
    bail!("Only cabled-iPhone recordings (macOS) are re-encoded")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_repair_names_the_host_package_without_installing_it() {
        assert_eq!(decoder_repair_for("arch"), "sudo pacman -S gst-libav");
        assert_eq!(decoder_repair_for("omarchy"), "sudo pacman -S gst-libav");
        assert_eq!(decoder_repair_for("ubuntu"), "sudo apt install gstreamer1.0-libav");
        assert_eq!(decoder_repair_for("fedora"), "sudo dnf install gstreamer1-plugin-libav");
        assert!(decoder_repair_for("other").contains("distribution"));
    }

    #[test]
    fn encoder_repair_names_the_host_package_without_installing_it() {
        assert_eq!(
            encoder_repair_for("arch"),
            "sudo pacman -S gst-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("omarchy"),
            "sudo pacman -S gst-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("ubuntu"),
            "sudo apt install gstreamer1.0-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("fedora"),
            "sudo dnf install gstreamer1-plugins-ugly"
        );
        assert!(encoder_repair_for("other").contains("distribution"));
        assert!(
            encoder_diagnostic("not found", false, "omarchy")
                .contains("sudo pacman -S gst-plugins-ugly")
        );
        let packaged = encoder_diagnostic("not found", true, "omarchy");
        assert!(packaged.contains("fresh Apparent AppImage"));
        assert!(!packaged.contains("sudo pacman"));
    }

    #[test]
    fn encoder_preflight_uses_a_private_directory() {
        use std::os::unix::fs::PermissionsExt;
        let directory = preflight_directory().unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(!directory.join("encoder-check.mp4").exists());
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn synthetic_encoder_preflight_classifies_a_missing_output_parent() {
        if init().is_err() {
            return;
        }
        let Some(selected) = encoder() else {
            return;
        };
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let movie = std::env::temp_dir().join(format!(
            "apparent-dev-encoder-diagnostics-{}-{nonce}/missing/encoder-check.mp4",
            std::process::id()
        ));
        let result = encode_synthetic(&movie, selected, true);
        assert!(result.is_err(), "filesink must refuse an output whose parent is missing");
        assert!(!movie.exists());
    }

    #[test]
    fn encoder_debug_redacts_private_output_and_home_paths() {
        let movie = std::env::temp_dir().join("private/output.mp4");
        let detail = format!(
            "Could not write {} under {}",
            movie.display(),
            std::env::var("HOME").unwrap_or_default()
        );
        let safe = safe_encoder_debug(&detail, &movie);
        assert!(!safe.contains("private/output.mp4"));
        if let Ok(home) = std::env::var("HOME") {
            assert!(!safe.contains(&home));
        }
        assert!(safe.contains("<private-temp>"));
        assert!(safe.chars().count() <= 160);
    }

    #[test]
    fn masks_take_the_row_below() {
        // 3x3, each row its own grey; the pill over the top two rows' middle.
        let mut rgba: Vec<u8> = (0..3).flat_map(|y| [y as u8 * 100; 12]).collect();
        mask(&mut rgba, 3, 3, [1.0, 0.0, 1.0, 2.0]);
        assert_eq!(rgba[4], 200);
        assert_eq!(rgba[16], 200);
        assert_eq!(rgba[0], 0);
        // At the bottom it takes the row above.
        mask(&mut rgba, 3, 3, [0.0, 2.0, 1.0, 1.0]);
        assert_eq!(rgba[24], 100);
    }

    #[test]
    fn x11_sources_record_the_rect_they_are_given() {
        let launch = source_launch(&Source::X11 {
            rect: [100.0, 50.0, 800.0, 600.0],
        });
        assert!(launch.contains("startx=100 starty=50 endx=899 endy=649"), "{launch}");
    }

    struct CropFixture {
        pipeline: gst::Pipeline,
        source: gst_app::AppSrc,
        sink: gst_app::AppSink,
    }

    impl Drop for CropFixture {
        fn drop(&mut self) { let _ = self.pipeline.set_state(gst::State::Null); }
    }

    impl CropFixture {
        fn new() -> Self {
            init().unwrap();
            let crop = Crop { rect: [410, 240, 420, 260], source_size: Some([1280, 800]) };
            let pipeline = gst::parse::launch(&format!(
                "appsrc name=input format=time {} ! appsink name=output sync=false", crop_launch(&crop)
            )).unwrap().downcast::<gst::Pipeline>().unwrap();
            let source = pipeline.by_name("input").unwrap().downcast::<gst_app::AppSrc>().unwrap();
            let sink = pipeline.by_name("output").unwrap().downcast::<gst_app::AppSink>().unwrap();
            crop_edges(&pipeline.by_name("crop").unwrap(), crop.rect);
            pipeline.set_state(gst::State::Playing).unwrap();
            Self { pipeline, source, sink }
        }

        fn pixel(x: u32, y: u32) -> [u8; 4] {
            [(x % 251) as u8, (y % 253) as u8, (x / 251) as u8, 255]
        }

        fn push(&self, width: u32, height: u32, par: gst::Fraction) {
            self.source.set_caps(Some(&gst::Caps::builder("video/x-raw")
                .field("format", "RGBA").field("width", width as i32).field("height", height as i32)
                .field("framerate", gst::Fraction::new(30, 1)).field("pixel-aspect-ratio", par).build()));
            let mut bytes = Vec::with_capacity((width * height * 4) as usize);
            for y in 0..height { for x in 0..width { bytes.extend_from_slice(&Self::pixel(x, y)); } }
            let mut buffer = gst::Buffer::from_mut_slice(bytes);
            buffer.get_mut().unwrap().set_pts(gst::ClockTime::ZERO);
            // Negotiation may already have refused the caps; either result must
            // still leave no output sample and an actual pipeline error below.
            let _ = self.source.push_buffer(buffer);
        }

        fn reject(&self) {
            assert!(self.sink.try_pull_sample(gst::ClockTime::from_mseconds(300)).is_none(),
                "an incompatible stream escaped the pre-crop guard");
            assert!(self.pipeline.bus().unwrap().timed_pop_filtered(
                gst::ClockTime::from_seconds(2), &[gst::MessageType::Error]
            ).is_some(), "missing negotiation failure");
        }
    }

    #[test]
    fn guarded_portal_crop_preserves_actual_pixel_origin_and_extent() {
        let fixture = CropFixture::new();
        fixture.push(1280, 800, gst::Fraction::new(1, 1));
        let sample = fixture.sink.try_pull_sample(gst::ClockTime::from_seconds(2)).unwrap();
        let info = gstreamer_video::VideoInfo::from_caps(sample.caps().unwrap()).unwrap();
        assert_eq!((info.width(), info.height()), (420, 260));
        let pixels = rgba_of(&sample, 420, 260).unwrap();
        assert_eq!(&pixels[..4], &CropFixture::pixel(410, 240));
        assert_eq!(&pixels[pixels.len() - 4..], &CropFixture::pixel(829, 499));
    }

    #[test]
    fn guarded_portal_crop_rejects_scaled_rotated_and_nonsquare_streams() {
        for (width, height, par) in [(2560, 1600, gst::Fraction::new(1, 1)),
            (800, 1280, gst::Fraction::new(1, 1)), (1280, 800, gst::Fraction::new(2, 1))]
        {
            let fixture = CropFixture::new();
            fixture.push(width, height, par);
            fixture.reject();
        }
    }

    #[test]
    fn guarded_portal_crop_rejects_changed_dimensions_without_an_uncropped_frame() {
        let fixture = CropFixture::new();
        fixture.push(1280, 800, gst::Fraction::new(1, 1));
        assert!(fixture.sink.try_pull_sample(gst::ClockTime::from_seconds(2)).is_some());
        fixture.push(2560, 1600, gst::Fraction::new(1, 1));
        fixture.reject();
    }

    #[test]
    fn finished_movie_survives_a_stuck_candidate_branch() {
        if init().is_err()
            || encoder().is_none()
            || gst::ElementFactory::find("videotestsrc").is_none()
        {
            eprintln!("Skipping synthetic GStreamer test: test source or encoder unavailable");
            return;
        }
        let movie =
            std::env::temp_dir().join(format!("apparent-eos-test-{}.mp4", std::process::id()));
        let _ = std::fs::remove_file(&movie);
        let mut recorder = Recorder::new(
            &Source::Test,
            (640, 360),
            (320, 180),
            Some(&movie),
            Instant::now(),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while recorder.candidate(0, &[]).is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            recorder.last.is_some(),
            "the synthetic pipeline never produced a frame"
        );
        let sink = recorder.candidates.static_pad("sink").unwrap();
        let _blocked = sink.add_probe(
            gst::PadProbeType::BLOCK | gst::PadProbeType::BUFFER,
            |_, _| gst::PadProbeReturn::Ok,
        );
        std::thread::sleep(Duration::from_millis(200));
        let started = Instant::now();
        assert!(
            recorder.finish(),
            "the movie branch finished but the candidate branch held pipeline EOS"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(std::fs::metadata(&movie).unwrap().len() > 1024);
        std::fs::remove_file(movie).unwrap();
    }

    #[test]
    fn unfinished_movie_is_not_kept_when_encoder_stalls() {
        if init().is_err()
            || encoder().is_none()
            || gst::ElementFactory::find("videotestsrc").is_none()
        {
            eprintln!("Skipping synthetic GStreamer test: test source or encoder unavailable");
            return;
        }
        let movie = std::env::temp_dir().join(format!(
            "apparent-encoder-eos-test-{}.mp4",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&movie);
        let mut recorder = Recorder::new(
            &Source::Test,
            (640, 360),
            (320, 180),
            Some(&movie),
            Instant::now(),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while recorder.candidate(0, &[]).is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            recorder.last.is_some(),
            "the synthetic pipeline never produced a frame"
        );
        let sink = recorder
            .pipeline
            .by_name("encoder")
            .unwrap()
            .static_pad("sink")
            .unwrap();
        let _blocked = sink.add_probe(
            gst::PadProbeType::BLOCK | gst::PadProbeType::BUFFER,
            |_, _| gst::PadProbeReturn::Ok,
        );
        std::thread::sleep(Duration::from_millis(200));
        assert!(
            !recorder.finish(),
            "an encoder stall cannot finish the movie"
        );
        let _ = std::fs::remove_file(movie);
    }
}
