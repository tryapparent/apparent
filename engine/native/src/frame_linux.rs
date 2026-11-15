//! GStreamer execution only; no capture session, config, models or application types.
use crate::frame_output::{Frame, MAX_EDGE, MAX_FRAME_PIXELS, Output, Result};
use gst::prelude::*;
use gstreamer as gst;
use std::path::Path;
use std::time::{Duration, Instant};

#[derive(Clone)]
struct Pixels {
    at: u64,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}
struct Reader {
    pipeline: gst::Pipeline,
    sink: gstreamer_app::AppSink,
    duration: u64,
    first: Pixels,
    previous: Option<Pixels>,
    next: Option<Pixels>,
}

impl Drop for Reader {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

impl Reader {
    fn open(movie: &Path) -> Result<Self> {
        gst::init().map_err(|_| "unavailable")?;
        let location = movie
            .to_str()
            .ok_or("invalid_request")?
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let pipeline = gst::parse::launch(&format!(
            "filesrc location=\"{location}\" ! decodebin ! videoconvert ! videoflip video-direction=auto ! video/x-raw,format=RGBA ! appsink name=sink sync=false max-buffers=1"
        )).map_err(|_| "decode_failed")?.downcast::<gst::Pipeline>().map_err(|_| "decode_failed")?;
        let sink = pipeline
            .by_name("sink")
            .ok_or("decode_failed")?
            .downcast::<gstreamer_app::AppSink>()
            .map_err(|_| "decode_failed")?;
        let opened = (|| {
            pipeline
                .set_state(gst::State::Paused)
                .map_err(|_| "decode_failed")?;
            pipeline
                .state(gst::ClockTime::from_seconds(10))
                .0
                .map_err(|_| "decode_failed")?;
            let duration = pipeline
                .query_duration::<gst::ClockTime>()
                .map_or(0, gst::ClockTime::mseconds);
            if duration == 0 {
                return Err("decode_failed");
            }
            let sample = sink
                .try_pull_preroll(gst::ClockTime::from_seconds(10))
                .ok_or("decode_failed")?;
            Ok((duration, Self::pixels(&sample)?))
        })();
        match opened {
            Ok((duration, first)) => Ok(Self {
                pipeline,
                sink,
                duration,
                first,
                previous: None,
                next: None,
            }),
            Err(error) => {
                let _ = pipeline.set_state(gst::State::Null);
                Err(error)
            }
        }
    }

    fn pixels(sample: &gst::Sample) -> Result<Pixels> {
        let info = gstreamer_video::VideoInfo::from_caps(sample.caps().ok_or("decode_failed")?)
            .map_err(|_| "decode_failed")?;
        let (width, height) = (info.width(), info.height());
        if width == 0
            || height == 0
            || width > MAX_EDGE
            || height > MAX_EDGE
            || u64::from(width) * u64::from(height) > MAX_FRAME_PIXELS
        {
            return Err("resource_limit");
        }
        let buffer = sample.buffer().ok_or("decode_failed")?;
        let pts = buffer.pts().ok_or("decode_failed")?;
        // Demuxed buffer PTS is media time. Stream time applies edit-list
        // offsets, including leading gaps and codec-reordering offsets.
        let at = sample
            .segment()
            .and_then(|s| s.downcast_ref::<gst::ClockTime>())
            .and_then(|s| s.to_stream_time(pts))
            .ok_or("decode_failed")?
            .mseconds();
        let mapped = buffer.map_readable().map_err(|_| "decode_failed")?;
        let row = width as usize * 4;
        let stride = usize::try_from(info.stride()[0]).map_err(|_| "decode_failed")?;
        if stride < row {
            return Err("decode_failed");
        }
        let mut rgba = Vec::with_capacity(row * height as usize);
        for y in 0..height as usize {
            rgba.extend_from_slice(
                mapped
                    .get(y * stride..y * stride + row)
                    .ok_or("decode_failed")?,
            );
        }
        Ok(Pixels {
            at,
            width,
            height,
            rgba,
        })
    }

    fn at(&mut self, requested: u64) -> Result<Pixels> {
        let target = requested.min(self.duration.saturating_sub(1));
        if target <= self.first.at {
            return Ok(self.first.clone());
        }
        if self.previous.as_ref().is_some_and(|p| p.at > target) {
            self.previous = None;
            self.next = None;
            self.pipeline
                .seek_simple(gst::SeekFlags::FLUSH, gst::ClockTime::ZERO)
                .map_err(|_| "decode_failed")?;
        }
        self.pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "decode_failed")?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let frame = if let Some(frame) = self.next.take() {
                frame
            } else {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err("decode_failed");
                }
                let Some(sample) = self
                    .sink
                    .try_pull_sample(gst::ClockTime::from_nseconds(remaining.as_nanos() as u64))
                else {
                    if !self.sink.is_eos() {
                        return Err("decode_failed");
                    }
                    break;
                };
                Self::pixels(&sample)?
            };
            if frame.at > target {
                self.next = Some(frame);
                break;
            }
            if self
                .previous
                .as_ref()
                .is_some_and(|previous| frame.at < previous.at)
            {
                return Err("decode_failed");
            }
            self.previous = Some(frame);
        }
        Ok(self.previous.as_ref().unwrap_or(&self.first).clone())
    }
}

fn shrink(frame: Pixels, edge: u32) -> Pixels {
    if edge == 0 || frame.width.max(frame.height) <= edge {
        return frame;
    }
    let scale = f64::from(edge) / f64::from(frame.width.max(frame.height));
    let width = (f64::from(frame.width) * scale).round().max(1.0) as u32;
    let height = (f64::from(frame.height) * scale).round().max(1.0) as u32;
    let mut rgba = vec![0_u8; width as usize * height as usize * 4];
    for y in 0..height as usize {
        let y0 = y * frame.height as usize / height as usize;
        let y1 = ((y + 1) * frame.height as usize / height as usize).max(y0 + 1);
        for x in 0..width as usize {
            let x0 = x * frame.width as usize / width as usize;
            let x1 = ((x + 1) * frame.width as usize / width as usize).max(x0 + 1);
            let mut sum = [0_u64; 4];
            for sy in y0..y1 {
                for px in frame.rgba
                    [(sy * frame.width as usize + x0) * 4..(sy * frame.width as usize + x1) * 4]
                    .chunks_exact(4)
                {
                    for channel in 0..3 {
                        sum[channel] += u64::from(px[channel]) * u64::from(px[3]);
                    }
                    sum[3] += u64::from(px[3]);
                }
            }
            let count = ((y1 - y0) * (x1 - x0)) as u64;
            for channel in 0..3 {
                rgba[(y * width as usize + x) * 4 + channel] = if sum[3] == 0 {
                    0
                } else {
                    (sum[channel] / sum[3]) as u8
                };
            }
            rgba[(y * width as usize + x) * 4 + 3] = (sum[3] / count) as u8;
        }
    }
    Pixels {
        at: frame.at,
        width,
        height,
        rgba,
    }
}

pub fn decode(movie: &Path, times: &[u64], edge: u32, mut output: Output) -> Result<Vec<Frame>> {
    let mut reader = Reader::open(movie)?;
    let mut frames = Vec::with_capacity(times.len());
    for (index, &requested) in times.iter().enumerate() {
        let frame = shrink(reader.at(requested)?, edge);
        frames.push(output.write(
            index,
            requested,
            frame.at as i64,
            frame.width,
            frame.height,
            &frame.rgba,
        )?);
    }
    Ok(frames)
}
