//! GStreamer execution only; no capture session, config, models or application types.
use crate::frame_convert::{CONVERSION_RETRY, FrameConverter};
use crate::frame_output::{Frame, MAX_EDGE, MAX_FRAME_PIXELS, Output, Result};
use crate::frame_seek::SeekWitness;
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
struct TimedSample {
    at: u64,
    sample: gst::Sample,
}

struct Reader {
    convert: Option<FrameConverter>,
    pipeline: gst::Pipeline,
    sink: gstreamer_app::AppSink,
    duration: u64,
    first: Pixels,
    previous: Option<TimedSample>,
    next: Option<TimedSample>,
    can_seek_forward: bool,
    witness: SeekWitness,
}

impl Drop for Reader {
    fn drop(&mut self) {
        drop(self.convert.take());
        self.previous = None;
        self.next = None;
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

impl Reader {
    fn open(movie: &Path, defer_conversion: bool) -> Result<Self> {
        gst::init().map_err(|_| "unavailable")?;
        let location = movie
            .to_str()
            .ok_or("invalid_request")?
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let transform = if defer_conversion {
            "video/x-raw"
        } else {
            "videoconvert ! videoflip video-direction=auto ! video/x-raw,format=RGBA"
        };
        let pipeline = gst::parse::launch(&format!(
            "filesrc location=\"{location}\" ! decodebin ! {transform} ! appsink name=sink sync=false max-buffers=1"
        )).map_err(|_| "decode_failed")?.downcast::<gst::Pipeline>().map_err(|_| "decode_failed")?;
        let sink = pipeline
            .by_name("sink")
            .ok_or("decode_failed")?
            .downcast::<gstreamer_app::AppSink>()
            .map_err(|_| "decode_failed")?;
        let witness = SeekWitness::attach(&pipeline);
        let convert = defer_conversion
            .then(|| FrameConverter::open(&sink))
            .transpose()?;
        let opened = (|| {
            pipeline
                .set_state(gst::State::Paused)
                .map_err(|_| "decode_failed")?;
            if !defer_conversion {
                pipeline
                    .state(gst::ClockTime::from_seconds(10))
                    .0
                    .map_err(|_| "decode_failed")?;
            }
            let timeout = gst::ClockTime::from_seconds(if defer_conversion { 2 } else { 10 });
            let sample = sink.try_pull_preroll(timeout).ok_or("decode_failed")?;
            let duration = pipeline
                .query_duration::<gst::ClockTime>()
                .map_or(0, gst::ClockTime::mseconds);
            if duration == 0 {
                return Err("decode_failed");
            }
            Ok((duration, Self::sample(sample)?.pixels(convert.as_ref())?))
        })();
        match opened {
            Ok((duration, first)) => Ok(Self {
                convert,
                pipeline,
                sink,
                duration,
                first,
                previous: None,
                next: None,
                can_seek_forward: witness.ready(),
                witness,
            }),
            Err(error) => {
                drop(convert);
                let _ = pipeline.set_state(gst::State::Null);
                Err(error)
            }
        }
    }

    fn sample(sample: gst::Sample) -> Result<TimedSample> {
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
        Ok(TimedSample { at, sample })
    }

    fn at(&mut self, requested: u64) -> Result<Pixels> {
        let target = requested.min(self.duration.saturating_sub(1));
        if target <= self.first.at {
            return Ok(self.first.clone());
        }
        let backwards = self.previous.as_ref().is_some_and(|p| p.at > target);
        if backwards {
            self.seek(gst::SeekFlags::FLUSH, 0)?;
        }
        self.pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "decode_failed")?;
        let position = self
            .previous
            .as_ref()
            .map_or(self.first.at, |frame| frame.at);
        if self.can_seek_forward
            && !backwards
            && target.saturating_sub(position) >= 4_000
            && (target == self.duration - 1 || self.duration.saturating_sub(target) > 100)
            && self.next.as_ref().is_none_or(|frame| frame.at <= target)
        {
            let seek = self.try_seek_near(target);
            self.witness.reset();
            if seek.is_ok() {
                return self
                    .previous
                    .as_ref()
                    .ok_or("decode_failed")?
                    .pixels(self.convert.as_ref());
            }
            self.can_seek_forward = false;
            self.seek(gst::SeekFlags::FLUSH, 0)?;
        }
        self.read_through(target, Instant::now() + Duration::from_secs(20))?;
        match &self.previous {
            Some(previous) => previous.pixels(self.convert.as_ref()),
            None => Ok(self.first.clone()),
        }
    }

    fn seek(&mut self, flags: gst::SeekFlags, at: u64) -> Result<()> {
        self.previous = None;
        self.next = None;
        self.pipeline
            .seek_simple(flags, gst::ClockTime::from_mseconds(at))
            .map_err(|_| "decode_failed")
    }

    fn try_seek_near(&mut self, target: u64) -> Result<()> {
        self.previous = None;
        self.next = None;
        let event = gst::event::Seek::new(
            1.0,
            gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT | gst::SeekFlags::SNAP_BEFORE,
            gst::SeekType::Set,
            gst::ClockTime::from_mseconds(target.saturating_sub(1_000)),
            gst::SeekType::None,
            gst::ClockTime::NONE,
        );
        self.witness.arm(event.seqnum());
        if !self.pipeline.send_event(event) {
            return Err("decode_failed");
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        let first = self.pull(deadline)?.ok_or("decode_failed")?;
        if !self.witness.confirmed() || first.at < self.first.at || first.at >= target {
            return Err("decode_failed");
        }
        self.previous = Some(first);
        self.read_through(target, deadline)?;
        if self.witness.confirmed()
            && (self.next.is_some() || (target == self.duration - 1 && self.sink.is_eos()))
        {
            Ok(())
        } else {
            Err("decode_failed")
        }
    }

    fn pull(&self, deadline: Instant) -> Result<Option<TimedSample>> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("decode_failed");
        }
        match self
            .sink
            .try_pull_sample(gst::ClockTime::from_nseconds(remaining.as_nanos() as u64))
        {
            Some(sample) => Self::sample(sample).map(Some),
            None if self.sink.is_eos() => Ok(None),
            None => Err("decode_failed"),
        }
    }

    fn read_through(&mut self, target: u64, deadline: Instant) -> Result<()> {
        loop {
            let frame = if let Some(frame) = self.next.take() {
                frame
            } else {
                let Some(frame) = self.pull(deadline)? else {
                    break;
                };
                frame
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
        Ok(())
    }
}

impl TimedSample {
    fn pixels(&self, convert: Option<&FrameConverter>) -> Result<Pixels> {
        let converted = convert
            .map(|convert| convert.sample(&self.sample))
            .transpose()?;
        let error = if convert.is_some() {
            CONVERSION_RETRY
        } else {
            "decode_failed"
        };
        let sample = converted.as_ref().unwrap_or(&self.sample);
        let info = gstreamer_video::VideoInfo::from_caps(sample.caps().ok_or(error)?)
            .map_err(|_| error)?;
        let (width, height) = (info.width(), info.height());
        let stride = usize::try_from(info.stride()[0]).map_err(|_| error)?;
        let buffer = sample.buffer().ok_or(error)?;
        let mapped = buffer.map_readable().map_err(|_| error)?;
        let row = width as usize * 4;
        if stride < row {
            return Err(error);
        }
        let mut rgba = Vec::with_capacity(row * height as usize);
        for y in 0..height as usize {
            rgba.extend_from_slice(mapped.get(y * stride..y * stride + row).ok_or(error)?);
        }
        Ok(Pixels {
            at: self.at,
            width,
            height,
            rgba,
        })
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
    let mut reader = match Reader::open(movie, true) {
        Err("decode_failed" | CONVERSION_RETRY) => Reader::open(movie, false)?,
        result => result?,
    };
    let mut frames = Vec::with_capacity(times.len());
    for (index, &requested) in times.iter().enumerate() {
        let pixels = match reader.at(requested) {
            Err(CONVERSION_RETRY) => {
                drop(reader);
                reader = Reader::open(movie, false)?;
                reader.at(requested)?
            }
            result => result?,
        };
        let frame = shrink(pixels, edge);
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
