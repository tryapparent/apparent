use crate::{audio_tracks, output::Result};
use gstreamer::{self as gst, prelude::*};
use std::{fs::File, io::Write, os::fd::AsRawFd};

struct Track {
    pipeline: gst::Pipeline,
    sink: gstreamer_app::AppSink,
    samples: Vec<f32>,
    start: u64,
    ended: bool,
}
fn uncompressed_view(buffer: &mut gst::Buffer, headers: &[u64]) -> Result<()> {
    let start = buffer.offset();
    let end = start
        .checked_add(buffer.size() as u64)
        .ok_or("decode_failed")?;
    if start == u64::MAX {
        return Err("decode_failed");
    }
    if !headers.iter().any(|at| *at < end && at + 2 > start) {
        return Ok(());
    }
    let mut private = buffer.copy_deep().map_err(|_| "decode_failed")?;
    {
        let mut bytes = private
            .make_mut()
            .map_writable()
            .map_err(|_| "decode_failed")?;
        for &at in headers {
            for (index, expected) in [0xff, 0xfe].into_iter().enumerate() {
                let position = at + index as u64;
                if position >= start && position < end {
                    let byte = &mut bytes[(position - start) as usize];
                    if *byte != expected && *byte != 0 {
                        return Err("decode_failed");
                    }
                    *byte = 0;
                }
            }
        }
    }
    *buffer = private;
    Ok(())
}
impl Drop for Track {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}
impl Track {
    fn open(source: &File, selected: audio_tracks::Track) -> Result<Self> {
        let pipeline = gst::parse::launch(&format!(
            "filesrc name=source blocksize=65536 location=\"/proc/self/fd/{}\" ! qtdemux name=demux decodebin name=decoder ! identity single-segment=true ! audioconvert ! audioresample ! audio/x-raw,format=F32LE,channels=1,rate=16000,layout=interleaved ! audiorate skip-to-first=false ! appsink name=sink sync=false max-buffers=1",
            source.as_raw_fd()
        )).map_err(|_| "unavailable")?.downcast::<gst::Pipeline>().map_err(|_| "decode_failed")?;
        let sink = pipeline
            .by_name("sink")
            .ok_or("decode_failed")?
            .downcast::<gstreamer_app::AppSink>()
            .map_err(|_| "decode_failed")?;
        let decoder = pipeline
            .by_name("decoder")
            .ok_or("decode_failed")?
            .static_pad("sink")
            .ok_or("decode_failed")?;
        let track_id = selected.id;
        let formats = selected.formats;
        if !selected.uncompressed_headers.is_empty() {
            let headers = selected.uncompressed_headers;
            pipeline
                .by_name("source")
                .ok_or("decode_failed")?
                .static_pad("src")
                .ok_or("decode_failed")?
                .add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                    if let Some(buffer) = info.buffer_mut() {
                        if uncompressed_view(buffer, &headers).is_err() {
                            info.flow_res = Err(gst::FlowError::Error);
                            return gst::PadProbeReturn::Handled;
                        }
                    }
                    gst::PadProbeReturn::Ok
                });
        }
        pipeline
            .by_name("demux")
            .ok_or("decode_failed")?
            .connect_pad_added(move |_, pad| {
                let id = pad
                    .stream_id()
                    .and_then(|id| id.rsplit('/').next()?.parse::<u32>().ok());
                if id == Some(track_id) && !decoder.is_linked() {
                    pad.add_probe(gst::PadProbeType::EVENT_DOWNSTREAM, move |_, info| {
                        if let Some(gst::PadProbeData::Event(event)) = info.data.as_mut() {
                            if let gst::EventView::Caps(caps_event) = event.view() {
                                let caps = caps_event.caps();
                                if let Some(structure) = caps.structure(0) {
                                    if structure.name() == "audio/x-raw" {
                                        if let Ok(actual) = structure.get::<&str>("format") {
                                            if let Some(expected) = formats
                                                .expected(actual)
                                                .filter(|expected| *expected != actual)
                                            {
                                                let mut caps = caps.to_owned();
                                                caps.make_mut()
                                                    .structure_mut(0)
                                                    .unwrap()
                                                    .set("format", expected);
                                                let mut corrected = gst::event::Caps::new(&caps);
                                                corrected.make_mut().set_seqnum(event.seqnum());
                                                corrected.make_mut().set_running_time_offset(
                                                    event.running_time_offset(),
                                                );
                                                *event = corrected;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        gst::PadProbeReturn::Ok
                    });
                    let _ = pad.link(&decoder);
                }
            });
        let track = Self {
            pipeline,
            sink,
            samples: Vec::new(),
            start: 0,
            ended: false,
        };
        track
            .pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "decode_failed")?;
        Ok(track)
    }
    fn value(&mut self, at: u64) -> Result<Option<f32>> {
        if self.ended {
            return Ok(None);
        }
        while self.samples.is_empty() || at >= self.start + self.samples.len() as u64 {
            let Some(sample) = self.sink.try_pull_sample(gst::ClockTime::from_seconds(10)) else {
                let failed = self
                    .pipeline
                    .bus()
                    .is_none_or(|bus| bus.pop_filtered(&[gst::MessageType::Error]).is_some());
                if failed || !self.sink.is_eos() {
                    return Err("decode_failed");
                }
                self.ended = true;
                self.samples.clear();
                return Ok(None);
            };
            let caps = sample
                .caps()
                .and_then(|caps| caps.structure(0))
                .ok_or("decode_failed")?;
            if caps.get::<i32>("rate") != Ok(16000)
                || caps.get::<i32>("channels") != Ok(1)
                || caps.get::<&str>("format") != Ok("F32LE")
            {
                return Err("decode_failed");
            }
            let buffer = sample.buffer().ok_or("decode_failed")?;
            let pts = buffer.pts().ok_or("decode_failed")?.nseconds();
            self.start = u64::try_from((u128::from(pts) * 16000 + 500_000_000) / 1_000_000_000)
                .map_err(|_| "resource_limit")?;
            let bytes = buffer.map_readable().map_err(|_| "decode_failed")?;
            if bytes.len() % 4 != 0 || bytes.len() > 2 * 1_048_576 {
                return Err("resource_limit");
            }
            self.samples = bytes
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            if self.samples.iter().any(|sample| !sample.is_finite()) {
                return Err("decode_failed");
            }
        }
        Ok(Some(if at < self.start {
            0.0
        } else {
            self.samples[(at - self.start) as usize]
        }))
    }
}

pub fn decode(source: &File, output: &mut File, limit: u64, indices: &[u32]) -> Result<()> {
    let ids = audio_tracks::selected(source, indices)?;
    unsafe {
        std::env::set_var("GST_REGISTRY_FORK", "no");
    }
    gst::init().map_err(|_| "unavailable")?;
    let file_limit = libc::rlimit {
        rlim_cur: (limit * 2) as _,
        rlim_max: (limit * 2) as _,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_FSIZE, &file_limit) } != 0 {
        return Err("unavailable");
    }
    let mut tracks = ids
        .into_iter()
        .map(|selected| Track::open(source, selected))
        .collect::<Result<Vec<_>>>()?;
    let mut written = 0;
    let mut chunk = Vec::with_capacity(8192 * 2);
    loop {
        chunk.clear();
        for offset in 0..8192 {
            let at = written + offset;
            let mut alive = false;
            let mut sum = 0_f64;
            for track in &mut tracks {
                if let Some(value) = track.value(at)? {
                    alive = true;
                    sum += f64::from(value);
                }
            }
            if !alive {
                break;
            }
            if at >= limit {
                return Err("resource_limit");
            }
            chunk.extend_from_slice(
                &((sum * 32768.0)
                    .round()
                    .clamp(f64::from(i16::MIN), f64::from(i16::MAX)) as i16)
                    .to_le_bytes(),
            );
        }
        output.write_all(&chunk).map_err(|_| "write_failed")?;
        written += chunk.len() as u64 / 2;
        if chunk.len() < 8192 * 2 {
            return Ok(());
        }
    }
}
