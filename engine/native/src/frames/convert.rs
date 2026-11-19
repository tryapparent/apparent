use crate::frame_output::Result;
use gst::prelude::*;
use gstreamer as gst;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

pub const CONVERSION_RETRY: &str = "deferred_conversion_failed";

pub struct FrameConverter {
    pipeline: gst::Pipeline,
    source: gstreamer_app::AppSrc,
    sink: gstreamer_app::AppSink,
    transformed: Arc<AtomicBool>,
}

impl Drop for FrameConverter {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

impl FrameConverter {
    pub fn open(decoded: &gstreamer_app::AppSink) -> Result<Self> {
        let pipeline = gst::parse::launch("appsrc name=source format=time is-live=true ! videoconvert ! videoflip video-direction=auto ! video/x-raw,format=RGBA ! appsink name=sink sync=false max-buffers=1")
            .map_err(|_| "decode_failed")?
            .downcast::<gst::Pipeline>().map_err(|_| "decode_failed")?;
        let source = pipeline
            .by_name("source")
            .ok_or("decode_failed")?
            .downcast::<gstreamer_app::AppSrc>()
            .map_err(|_| "decode_failed")?;
        let sink = pipeline
            .by_name("sink")
            .ok_or("decode_failed")?
            .downcast::<gstreamer_app::AppSink>()
            .map_err(|_| "decode_failed")?;
        let transformed = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&transformed);
        decoded
            .static_pad("sink")
            .ok_or("decode_failed")?
            .add_probe(gst::PadProbeType::EVENT_DOWNSTREAM, move |_, info| {
                if info.event().is_some_and(|event| match event.view() {
                    gst::EventView::Tag(event) => event
                        .tag()
                        .get::<gst::tags::ImageOrientation>()
                        .is_some_and(|orientation| orientation.get() != "rotate-0"),
                    _ => false,
                }) {
                    flag.store(true, Ordering::Release);
                }
                gst::PadProbeReturn::Ok
            })
            .ok_or("decode_failed")?;
        let convert = Self {
            pipeline,
            source,
            sink,
            transformed,
        };
        convert
            .pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "decode_failed")?;
        Ok(convert)
    }

    pub fn sample(&self, sample: &gst::Sample) -> Result<gst::Sample> {
        use gstreamer_video::{VideoFormat, VideoInfo, VideoMeta};

        let info = VideoInfo::from_caps(sample.caps().ok_or(CONVERSION_RETRY)?)
            .map_err(|_| CONVERSION_RETRY)?;
        if self.transformed.load(Ordering::Acquire)
            || info.format() != VideoFormat::I420
            || info.is_interlaced()
        {
            return Err(CONVERSION_RETRY);
        }
        let source_time = sample.buffer().and_then(|buffer| buffer.pts());
        self.source
            .push_sample(sample)
            .map_err(|_| CONVERSION_RETRY)?;
        let rgba = self
            .sink
            .try_pull_sample(gst::ClockTime::from_seconds(2))
            .ok_or(CONVERSION_RETRY)?;
        let format = VideoInfo::from_caps(rgba.caps().ok_or(CONVERSION_RETRY)?)
            .map_err(|_| CONVERSION_RETRY)?;
        let buffer = rgba.buffer().ok_or(CONVERSION_RETRY)?;
        if format.format() != VideoFormat::Rgba
            || format.width() != info.width()
            || format.height() != info.height()
            || buffer.pts() != source_time
            || buffer.meta::<VideoMeta>().is_some_and(|meta| {
                meta.format() != VideoFormat::Rgba
                    || meta.width() != format.width()
                    || meta.height() != format.height()
                    || meta.stride() != format.stride()
                    || meta.offset() != [0]
            })
        {
            return Err(CONVERSION_RETRY);
        }
        Ok(rgba)
    }
}
