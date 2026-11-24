use super::*;
use gstreamer_app::{AppSink, AppSrc};
use gstreamer_video::{VideoFormat, VideoInfo};

struct Replay {
    pipeline: gst::Pipeline,
    input: AppSrc,
    candidate: AppSink,
    full: AppSink,
}

impl Replay {
    fn new(branch: &CandidateBranch) -> Self {
        let launch = branch.launch("appsrc name=input is-live=true format=time");
        let pipeline = gst::parse::launch(&format!(
            "{launch} t. ! queue ! appsink name=full sync=false"
        ))
        .unwrap()
        .downcast::<gst::Pipeline>()
        .unwrap();
        branch.isolate_reconfigure(&pipeline).unwrap();
        let input = pipeline.by_name("input").unwrap().downcast().unwrap();
        let candidate = pipeline.by_name("candidates").unwrap().downcast().unwrap();
        let full = pipeline.by_name("full").unwrap().downcast().unwrap();
        pipeline.set_state(gst::State::Playing).unwrap();
        Self {
            pipeline,
            input,
            candidate,
            full,
        }
    }

    fn push(&self, format: VideoFormat, width: u32, height: u32, tick: u64) {
        let info = VideoInfo::builder(format, width, height)
            .fps(gst::Fraction::new(30, 1))
            .build()
            .unwrap();
        self.input.set_caps(Some(&info.to_caps().unwrap()));
        let pixels: Vec<_> = (0..info.size())
            .map(|index| (index.wrapping_mul(71).wrapping_add(index / 83) % 251) as u8)
            .collect();
        let mut buffer = gst::Buffer::from_mut_slice(pixels);
        let data = buffer.get_mut().unwrap();
        data.set_pts(gst::ClockTime::from_mseconds(tick * 33));
        data.set_duration(gst::ClockTime::from_mseconds(33));
        self.input.push_buffer(buffer).unwrap();
    }
}

impl Drop for Replay {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

fn assert_samples_equal(
    original: &AppSink,
    guarded: &AppSink,
    format: VideoFormat,
    size: (u32, u32),
) {
    let wait = gst::ClockTime::from_seconds(3);
    let original = original.try_pull_sample(wait).expect("original sample");
    let guarded = guarded.try_pull_sample(wait).expect("guarded sample");
    let a = VideoInfo::from_caps(original.caps().unwrap()).unwrap();
    let b = VideoInfo::from_caps(guarded.caps().unwrap()).unwrap();
    assert_eq!(
        (a.format(), a.width(), a.height()),
        (format, size.0, size.1)
    );
    assert_eq!(
        (b.format(), b.width(), b.height()),
        (format, size.0, size.1)
    );
    assert_eq!(a.stride(), b.stride());
    assert_eq!(a.size(), b.size());
    let a = original.buffer().unwrap();
    let b = guarded.buffer().unwrap();
    assert_eq!(a.pts(), b.pts());
    assert_eq!(a.dts(), b.dts());
    assert_eq!(a.duration(), b.duration());
    assert_eq!(a.flags(), b.flags());
    assert!(
        a.map_readable().unwrap().as_slice() == b.map_readable().unwrap().as_slice(),
        "different pixels for {format:?} at {size:?}"
    );
}

#[test]
fn format_switches_and_source_resizes_preserve_candidate_and_full_resolution_output() {
    gst::init().unwrap();
    let out = (128, 80);
    let candidate = (48, 30);
    let branch = CandidateBranch::new(out, candidate);
    let original = Replay::new(&CandidateBranch {
        use_switch: false,
        ..branch
    });
    let guarded = Replay::new(&branch);
    let switch = guarded
        .pipeline
        .iterate_elements()
        .into_iter()
        .filter_map(|element| element.ok())
        .find(|element| {
            element
                .factory()
                .is_some_and(|factory| factory.name() == "switchbin")
        });
    assert_eq!(
        switch.is_some(),
        gst::version() >= (1, 24, 0, 0) && gst::ElementFactory::find("switchbin").is_some()
    );

    for (tick, (format, width, height)) in [
        (VideoFormat::Bgrx, 128, 80),
        (VideoFormat::Nv12, 128, 80),
        (VideoFormat::Bgrx, 96, 60),
        (VideoFormat::Bgra, 96, 60),
        (VideoFormat::Rgb16, 128, 80),
        (VideoFormat::Bgrx, 128, 80),
    ]
    .into_iter()
    .enumerate()
    {
        original.push(format, width, height, tick as u64);
        guarded.push(format, width, height, tick as u64);
        assert_samples_equal(
            &original.candidate,
            &guarded.candidate,
            VideoFormat::Rgba,
            candidate,
        );
        assert_samples_equal(&original.full, &guarded.full, format, out);
        if let Some(switch) = &switch {
            assert_eq!(
                switch.property::<u32>("current-path"),
                u32::from(format != VideoFormat::Bgrx),
            );
        }
    }
}

#[test]
fn equal_sizes_keep_the_convert_before_scale_branch() {
    gst::init().unwrap();
    let size = (128, 80);
    let branch = CandidateBranch::new(size, size);
    assert!(!branch.use_switch);
    let launch = branch.launch("videotestsrc");
    assert!(
        launch.contains("leaky=downstream ! videoconvert ! videoscale ! video/x-raw,format=RGBA")
    );
}
