use gst::prelude::*;
use gstreamer as gst;
use std::sync::{Arc, Mutex};

#[derive(Default)]
enum Proof {
    #[default]
    Idle,
    AwaitingSegment(gst::Seqnum),
    AwaitingAccessUnit,
    Confirmed,
    Rejected,
}

#[derive(Default)]
struct State {
    video_count: usize,
    proof: Proof,
}

#[derive(Clone, Default)]
pub struct SeekWitness(Arc<Mutex<State>>);

impl SeekWitness {
    pub fn attach(pipeline: &gst::Pipeline) -> Self {
        let witness = Self::default();
        let watch = witness.clone();
        pipeline.connect_deep_element_added(move |_, _, element| {
            if !element.factory().is_some_and(|f| f.name() == "qtdemux") {
                return;
            }
            let watch = watch.clone();
            element.connect_pad_added(move |_, pad| {
                if !pad.name().starts_with("video_") {
                    return;
                }
                if let Ok(mut state) = watch.0.lock() {
                    state.video_count += 1;
                }
                let watch = watch.clone();
                pad.add_probe(
                    gst::PadProbeType::BUFFER
                        | gst::PadProbeType::BUFFER_LIST
                        | gst::PadProbeType::EVENT_DOWNSTREAM,
                    move |pad, info| {
                        watch.observe(pad, info);
                        gst::PadProbeReturn::Ok
                    },
                );
            });
        });
        witness
    }

    pub fn ready(&self) -> bool {
        self.0.lock().is_ok_and(|state| state.video_count == 1)
    }

    pub fn arm(&self, seqnum: gst::Seqnum) {
        if let Ok(mut state) = self.0.lock() {
            state.proof = Proof::AwaitingSegment(seqnum);
        }
    }

    pub fn confirmed(&self) -> bool {
        self.0
            .lock()
            .is_ok_and(|state| state.video_count == 1 && matches!(state.proof, Proof::Confirmed))
    }

    pub fn reset(&self) {
        if let Ok(mut state) = self.0.lock() {
            state.proof = Proof::Idle;
        }
    }

    fn observe(&self, pad: &gst::Pad, info: &gst::PadProbeInfo<'_>) {
        let Ok(mut state) = self.0.lock() else { return };
        if let Some(event) = info.event() {
            if matches!(event.view(), gst::EventView::Segment(_)) {
                state.proof = match state.proof {
                    Proof::AwaitingSegment(seqnum) if seqnum == event.seqnum() => {
                        Proof::AwaitingAccessUnit
                    }
                    Proof::AwaitingAccessUnit | Proof::Confirmed => Proof::Rejected,
                    _ => return,
                };
            }
        }
        if matches!(state.proof, Proof::AwaitingAccessUnit) && info.buffer_list().is_some() {
            state.proof = Proof::Rejected;
        }
        if matches!(state.proof, Proof::AwaitingAccessUnit)
            && let Some(buffer) = info.buffer()
        {
            state.proof = match check_access_unit(pad, buffer) {
                Some(true) => Proof::Confirmed,
                Some(false) => Proof::Rejected,
                None => return,
            };
        }
    }
}

fn check_access_unit(pad: &gst::Pad, buffer: &gst::Buffer) -> Option<bool> {
    let Some(caps) = pad.current_caps() else {
        return Some(false);
    };
    let Some(format) = caps.structure(0) else {
        return Some(false);
    };
    if format.name() != "video/x-h264"
        || format.get::<&str>("stream-format").ok() != Some("avc")
        || format.get::<&str>("alignment").ok() != Some("au")
    {
        return Some(false);
    }
    let Ok(config) = format.get::<gst::Buffer>("codec_data") else {
        return Some(false);
    };
    let Ok(config) = config.map_readable() else {
        return Some(false);
    };
    if config.get(0) != Some(&1) || config.get(4).copied().map(|n| n & 3) != Some(3) {
        return Some(false);
    }
    let Ok(data) = buffer.map_readable() else {
        return Some(false);
    };
    check_avc4(data.as_slice())
}

fn check_avc4(mut data: &[u8]) -> Option<bool> {
    let mut idr = false;
    while !data.is_empty() {
        let Some((length, payload)) = data.split_first_chunk::<4>() else {
            return Some(false);
        };
        let size = u32::from_be_bytes(*length) as usize;
        let Some((nal, remaining)) = payload.split_at_checked(size) else {
            return Some(false);
        };
        let Some(first) = nal.first().copied() else {
            return Some(false);
        };
        if first & 0x80 != 0 {
            return Some(false);
        }
        match first & 0x1f {
            5 if nal.len() > 1 && first & 0x60 != 0 => idr = true,
            6..=9 | 12 => {}
            _ => return Some(false),
        }
        data = remaining;
    }
    idr.then_some(true)
}
