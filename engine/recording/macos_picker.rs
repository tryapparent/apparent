use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use objc2_app_kit::NSRunningApplication;
use screencapturekit::cm::{CMSampleBufferExt, CMSampleBufferSCExt, SCFrameStatus};
use screencapturekit::content_sharing_picker::{
    SCContentSharingPicker, SCContentSharingPickerConfiguration, SCContentSharingPickerMode,
    SCPickerEvent, SCPickerSubscription,
};
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use screencapturekit::recording_output::{
    RecordingCallbacks, SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputFileType,
};
use screencapturekit::stream::content_filter::SCShareableContentStyle;
use screencapturekit::stream::delegate_trait::ErrorHandler;

use super::{CANDIDATE_EDGE, CandidateBuffer, Sampler};
use crate::capture::engine::runtime::recording::diagnostics::sampling::Rejection;
use crate::capture::engine::runtime::{
    apparent_log, capture_size, recording::recorder::push_candidate, screens,
};
use crate::shared::model::{CaptureMode, RgbaFrame, TargetFrame, TargetInfo};

pub(crate) struct SelectedDisplay {
    filter: SCContentFilter,
    _observer: SCPickerSubscription,
}

pub(crate) struct PendingDisplay {
    receiver: flume::Receiver<Result<Option<SCContentFilter>>>,
    observer: SCPickerSubscription,
}

impl PendingDisplay {
    pub(crate) fn present(excluded_windows: &[u32]) -> Result<Self> {
        let app = NSRunningApplication::currentApplication();
        let bundle = app
            .bundleIdentifier()
            .context("Apparent must be launched from an app bundle")?;
        let bundle = bundle.to_string();
        let mut config = SCContentSharingPickerConfiguration::new()?;
        config.set_allowed_picker_modes(&[SCContentSharingPickerMode::SingleDisplay]);
        config.set_allows_changing_selected_content(false);
        config.set_excluded_bundle_ids(&[&bundle])?;
        config.set_excluded_window_ids(excluded_windows);
        SCContentSharingPicker::set_default_configuration(&config)?;

        let (sender, receiver) = flume::bounded(1);
        let observer = SCContentSharingPicker::add_observer(move |event| {
            let result = match event {
                SCPickerEvent::Updated {
                    result,
                    stream: None,
                } => Ok(Some(result.filter())),
                SCPickerEvent::Cancelled { stream: None } => Ok(None),
                SCPickerEvent::Failed(error) => Err(anyhow::anyhow!("{error}")),
                _ => return,
            };
            let _ = sender.try_send(result);
        })?;
        SCContentSharingPicker::present()?;
        Ok(Self { receiver, observer })
    }

    pub(crate) async fn choose<F: Future<Output = ()>>(
        self,
        stop: &AtomicBool,
        mut wait: impl FnMut() -> F,
    ) -> Result<Option<(TargetInfo, SelectedDisplay)>> {
        let deadline = Instant::now() + Duration::from_secs(120);
        let result = loop {
            if stop.load(Ordering::Acquire) || Instant::now() >= deadline {
                return Ok(None);
            }
            match self.receiver.try_recv() {
                Ok(result) => break result?,
                Err(flume::TryRecvError::Empty) => wait().await,
                Err(error) => return Err(error.into()),
            }
        };
        let Some(filter) = result else {
            return Ok(None);
        };
        ensure!(
            filter.style()? == SCShareableContentStyle::Display,
            "The picker did not authorize a display"
        );
        let rect = filter.content_rect();
        let bounds = [
            rect.origin.x,
            rect.origin.y,
            rect.size.width,
            rect.size.height,
        ];
        ensure!(
            bounds.iter().all(|value| value.is_finite()),
            "Invalid picker display bounds"
        );
        let candidates = screens::current();
        let mut matching = candidates.iter().filter(|display| {
            display
                .frame
                .iter()
                .zip(bounds)
                .all(|(actual, expected)| (actual - expected).abs() < 1.0)
                && (display.scale - f64::from(filter.point_pixel_scale())).abs() < 0.01
        });
        let display = matching
            .next()
            .context("The authorized display does not match a connected screen")?;
        ensure!(
            matching.next().is_none(),
            "The authorized display is ambiguous"
        );
        let [x, y, width, height] = display.frame;
        let target = TargetInfo {
            mode: CaptureMode::Display,
            app: None,
            bundle_id: None,
            window_title: None,
            window_id: None,
            display_id: display.id,
            frame: TargetFrame {
                x,
                y,
                width,
                height,
                scale: display.scale,
            },
        };
        Ok(Some((
            target,
            SelectedDisplay {
                filter,
                _observer: self.observer,
            },
        )))
    }
}

pub(crate) fn run(
    sampler: Sampler,
    selected: SelectedDisplay,
    native_stop: Arc<AtomicBool>,
) -> Option<PathBuf> {
    match record(&sampler, &selected, &native_stop) {
        Ok(path) => Some(path),
        Err(error) => {
            apparent_log(format!("Picker capture failed: {error:#}"));
            sampler.startup_failed.store(true, Ordering::Release);
            None
        }
    }
}

fn record(
    sampler: &Sampler,
    selected: &SelectedDisplay,
    native_stop: &Arc<AtomicBool>,
) -> Result<PathBuf> {
    let path = sampler
        .video_output_path
        .as_ref()
        .context("A picker capture requires a movie output")?;
    let (width, height) = capture_size(&sampler.target, 2560.0);
    let config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(true);
    let delegate_stop = Arc::clone(native_stop);
    let mut stream = SCStream::new_with_delegate(
        &selected.filter,
        &config,
        ErrorHandler::new(move |error| {
            apparent_log(format!("Picker stream stopped: {error}"));
            delegate_stop.store(true, Ordering::Release);
        }),
    )?;
    let (completed_tx, completed) = flume::bounded(1);
    let failed_tx = completed_tx.clone();
    let failed = Arc::clone(&sampler.startup_failed);
    let stop = Arc::clone(native_stop);
    let delegate = RecordingCallbacks::new()
        .on_finish(move || {
            let _ = completed_tx.try_send(Ok(()));
        })
        .on_fail(move |error| {
            failed.store(true, Ordering::Release);
            stop.store(true, Ordering::Release);
            let _ = failed_tx.try_send(Err(error));
        });
    let output = SCRecordingOutput::new_with_delegate(
        &SCRecordingOutputConfiguration::new()?
            .with_output_url(path)?
            .with_video_codec(SCRecordingOutputCodec::H264)
            .with_output_file_type(SCRecordingOutputFileType::MP4),
        delegate,
    )
    .context("ScreenCaptureKit could not create a recording output")?;

    let candidate_frames = Arc::clone(&sampler.frames);
    let ready = Arc::clone(&sampler.real_frame_seen);
    let urgent = Arc::clone(&sampler.urgent);
    let stopping = Arc::clone(&sampler.stopping);
    let started = sampler.started_at;
    let last = std::sync::Mutex::new(None::<Instant>);
    let (candidate_width, candidate_height) = capture_size(&sampler.target, CANDIDATE_EDGE);
    stream.add_output_handler(
        move |sample: CMSampleBuffer, kind| {
            if kind != SCStreamOutputType::Screen || stopping.load(Ordering::Acquire) {
                return;
            }
            let rejection = match sample.frame_status() {
                Some(SCFrameStatus::Complete) => None,
                Some(_) => Some(Rejection::PickerFrameIncomplete),
                None => Some(Rejection::PickerStatusMissing),
            };
            if let Some(rejection) = rejection {
                if !ready.load(Ordering::Acquire) {
                    CandidateBuffer::reject_sample(&candidate_frames, rejection);
                }
                return;
            }
            let Ok(mut recent) = last.try_lock() else {
                return;
            };
            let force = urgent.swap(false, Ordering::AcqRel);
            let interval = candidate_frames
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .interval();
            if !force && recent.is_some_and(|frame| frame.elapsed() < interval) {
                return;
            }
            let t_ms = started.elapsed().as_millis() as u64;
            if let Some(frame) = candidate(sample, candidate_width, candidate_height, t_ms) {
                *recent = Some(Instant::now());
                push_candidate(&candidate_frames, &ready, frame, force, true);
            } else if !ready.load(Ordering::Acquire) {
                CandidateBuffer::reject_sample(&candidate_frames, Rejection::PickerPixels);
            }
        },
        SCStreamOutputType::Screen,
    )?;
    stream.add_recording_output(&output)?;
    let before = sampler.started_at.elapsed();
    stream.start_capture()?;
    sampler.video_offset_ms.store(
        ((before + sampler.started_at.elapsed()) / 2).as_millis() as u64,
        Ordering::Release,
    );
    while !sampler.stopping.load(Ordering::Acquire) && !native_stop.load(Ordering::Acquire) {
        std::thread::park_timeout(Duration::from_millis(30));
    }
    if !native_stop.load(Ordering::Acquire) {
        let _ = stream.stop_capture();
    }
    let _ = stream.remove_recording_output(&output);
    completed
        .recv_timeout(Duration::from_secs(5))?
        .map_err(anyhow::Error::msg)?;
    Ok(path.clone())
}

fn candidate(sample: CMSampleBuffer, width: u32, height: u32, t_ms: u64) -> Option<RgbaFrame> {
    let buffer = sample.pixel_buffer()?;
    let guard = buffer.lock(CVPixelBufferLockFlags::READ_ONLY).ok()?;
    let source_width = guard.width();
    let source_height = guard.height();
    let stride = guard.bytes_per_row();
    if source_width == 0 || source_height == 0 || width == 0 || height == 0 {
        return None;
    }
    let pixels = unsafe { guard.as_slice() }?;
    if stride < source_width.checked_mul(4)? || pixels.len() < stride.checked_mul(source_height)? {
        return None;
    }
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height as usize {
        let row = y * source_height / height as usize * stride;
        for x in 0..width as usize {
            let start = row + x * source_width / width as usize * 4;
            let bgra = &pixels[start..start + 4];
            rgba.extend([bgra[2], bgra[1], bgra[0], 255]);
        }
    }
    Some(RgbaFrame::new(t_ms, width, height, rgba))
}
