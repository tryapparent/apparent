use anyhow::{Context, Result};
use gstreamer as gst;
use gstreamer::prelude::*;

pub(crate) struct CandidateBranch {
    out: (u32, u32),
    candidate: (u32, u32),
    use_switch: bool,
}

#[cfg(test)]
mod tests;

impl CandidateBranch {
    pub(crate) fn new(out: (u32, u32), candidate: (u32, u32)) -> Self {
        let use_switch = out != candidate
            && gst::version() >= (1, 24, 0, 0)
            && gst::ElementFactory::find("switchbin").is_some();
        Self {
            out,
            candidate,
            use_switch,
        }
    }

    pub(crate) fn launch(&self, source: &str) -> String {
        let (w, h) = self.out;
        let (cw, ch) = self.candidate;
        let transform = if self.use_switch {
            concat!(
                r#"switchbin num-paths=2 path0::caps="video/x-raw,format=BGRx" "#,
                r#"path0::element="videoscale ! videoconvert" "#,
                r#"path1::element="videoconvert ! videoscale""#,
            )
        } else {
            "videoconvert ! videoscale"
        };
        format!(
            "{source} ! queue max-size-buffers=4 leaky=downstream ! videoconvert ! videoscale ! video/x-raw,width={w},height={h},pixel-aspect-ratio=1/1 ! tee name=t \
             t. ! queue name=candidate_queue max-size-buffers=2 leaky=downstream ! {transform} ! video/x-raw,format=RGBA,width={cw},height={ch},pixel-aspect-ratio=1/1 ! appsink name=candidates max-buffers=1 drop=true sync=false emit-signals=false"
        )
    }

    pub(crate) fn isolate_reconfigure(&self, pipeline: &gst::Pipeline) -> Result<()> {
        if self.use_switch {
            let input = pipeline
                .by_name("candidate_queue")
                .and_then(|queue| queue.static_pad("sink"))
                .context("Recording pipeline has no candidate queue input")?;
            input.add_probe(gst::PadProbeType::EVENT_UPSTREAM, |_, info| {
                if info
                    .event()
                    .is_some_and(|event| event.type_() == gst::EventType::Reconfigure)
                {
                    drop(info.take_event());
                    gst::PadProbeReturn::Handled
                } else {
                    gst::PadProbeReturn::Ok
                }
            });
        }
        Ok(())
    }
}
