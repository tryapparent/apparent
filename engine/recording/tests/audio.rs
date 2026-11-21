use super::*;

#[cfg(target_os = "linux")]
#[test]
fn cpal_choice_becomes_missing_when_pulse_inventory_takes_over() {
    use crate::capture::engine::runtime::audio::mic::{Choice, Input, Inputs, Pick};

    let saved = Choice {
        id: "cpal-mic".into(),
        name: "Original microphone".into(),
    };
    let cpal = Inputs {
        default: Some("cpal-mic".into()),
        devices: vec![Input {
            id: "cpal-mic".into(),
            name: saved.name.clone(),
        }],
    };
    assert!(matches!(Pick::new(Some(&saved), &cpal), Pick::Chosen(_)));

    let pulse = Inputs {
        default: Some("pulse:system".into()),
        devices: vec![Input {
            id: "pulse:system".into(),
            name: "System input".into(),
        }],
    };
    let pick = Pick::new(Some(&saved), &pulse);
    assert!(matches!(pick, Pick::Missing { .. }));
    assert_eq!(pick.device().unwrap().id, "pulse:system");
    assert_eq!(pick.note().unwrap(), "Original microphone isn't connected. Using System input.");
}

#[test]
fn input_level_responds_to_real_samples_not_silence_or_an_old_peak() {
    assert_eq!(input_level(&[]), 0.0);
    assert_eq!(input_level(&vec![0.0; 1280]), 0.0);
    let mut samples = vec![0.9; 1280];
    samples.extend(vec![0.0; 1280]);
    assert_eq!(input_level(&samples), 0.0, "old sound must leave the window");
    assert!(input_level(&vec![0.2; 1280]) > 0.0);
}
use std::time::Duration;

#[test]
fn input_health_distinguishes_open_failure_stall_and_sustained_silence() {
    let start = std::time::Instant::now();
    let mut h = InputHealth::new(start);
    assert_eq!(h.status(start + Duration::from_secs(2)), None);
    assert_eq!(h.status(start + Duration::from_secs(5)), Some(InputWarning::Stopped));
    h.open_failed();
    assert_eq!(h.status(start + Duration::from_secs(6)), Some(InputWarning::Unavailable));

    let mut h = InputHealth::new(start);
    h.sample(start + Duration::from_secs(1), 0.0);
    assert_eq!(h.status(start + Duration::from_secs(3)), None);
    h.sample(start + Duration::from_secs(4), 0.0);
    assert_eq!(h.status(start + Duration::from_secs(6)), None);
    h.sample(start + Duration::from_secs(21), 0.0);
    assert_eq!(h.status(start + Duration::from_secs(21)), Some(InputWarning::VeryQuiet));
}

#[test]
fn input_health_recovers_without_flicker_or_false_pause_alarm() {
    let start = std::time::Instant::now();
    let mut h = InputHealth::new(start);
    for second in 1..=10 {
        h.sample(start + Duration::from_secs(second), 0.2);
        assert_eq!(h.status(start + Duration::from_secs(second)), None);
    }
    assert_eq!(h.status(start + Duration::from_secs(12)), None);
    assert_eq!(h.status(start + Duration::from_secs(14)), Some(InputWarning::Stopped));
    h.sample(start + Duration::from_secs(15), 0.1);
    assert_eq!(h.status(start + Duration::from_secs(15)), Some(InputWarning::Stopped));
    h.sample(start + Duration::from_secs(16), 0.1);
    assert_eq!(h.status(start + Duration::from_secs(16)), None);
    h.sample(start + Duration::from_secs(17), 0.0);
    assert_eq!(h.status(start + Duration::from_secs(19)), None);
    h.stream_failed();
    assert_eq!(h.status(start + Duration::from_secs(19)), Some(InputWarning::Stopped));

    let mut h = InputHealth::new(start);
    h.sample(start + Duration::from_secs(21), 0.0);
    assert_eq!(h.status(start + Duration::from_secs(21)), Some(InputWarning::VeryQuiet));
    h.sample(start + Duration::from_secs(22), 0.1);
    h.sample(start + Duration::from_millis(22_500), 0.0);
    h.sample(start + Duration::from_secs(23), 0.1);
    assert_eq!(h.status(start + Duration::from_secs(23)), Some(InputWarning::VeryQuiet));
    h.sample(start + Duration::from_secs(24), 0.1);
    assert_eq!(h.status(start + Duration::from_secs(24)), None);
}

#[test]
fn pcm_waveform_preserves_captured_history_direction_and_silence() {
    assert_eq!(pcm_waveform(&[]), [0.0; 24]);
    let mut samples = vec![0.0; 24 * 640];
    samples.extend(vec![0.02; 640]);
    let spoken = pcm_waveform(&samples);
    assert!(spoken[23] > 0.0);
    assert!(spoken[..23].iter().all(|level| *level == 0.0));
    samples.extend(vec![0.0; 640]);
    let release = pcm_waveform(&samples);
    assert_eq!(release[22], spoken[23], "history moves left with real samples");
    assert!(release[23] > 0.0, "overlapping PCM window releases naturally");
    samples.extend(vec![0.0; 640]);
    assert_eq!(pcm_waveform(&samples)[23], 0.0);
    samples.extend(vec![0.0; 24 * 640]);
    assert_eq!(pcm_waveform(&samples), [0.0; 24]);
}

#[test]
fn input_activity_reads_capture_pcm_and_expires_a_stalled_stream() {
    let now = Instant::now();
    let recorder = AudioRecorder {
        worker: None, stop_sender: None,
        samples: Arc::new(Mutex::new(vec![0.2; 1280].into())),
        writer: None, error: Arc::new(Mutex::new(None)),
        health: Arc::new(Mutex::new(InputHealth::new(now))),
        live: None, word_probe: None,
        local_streaming: false,
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        streaming: None,
        #[cfg(target_os = "linux")]
        pause: None,
        #[cfg(target_os = "linux")]
        buffered: None,
    };
    assert_eq!(recorder.input_activity(), Some((1280, 0.0)));
    assert_eq!(recorder.input_waveform(), Some([0.0; 24]));
    recorder.health.lock().unwrap().sample(now, 0.2);
    assert!(recorder.input_activity().unwrap().1 > 0.0);
    assert!(recorder.input_waveform().unwrap()[23] > 0.0);
    recorder.health.lock().unwrap().last_sample = Some(now - Duration::from_secs(1));
    assert_eq!(recorder.input_activity(), Some((1280, 0.0)));
    recorder.samples.lock().unwrap().extend(vec![0.0; 1280]);
    recorder.health.lock().unwrap().sample(Instant::now(), 0.0);
    assert_eq!(recorder.input_activity(), Some((2560, 0.0)));
    assert_eq!(recorder.input_waveform().unwrap()[23], 0.0);
    let held = recorder.samples.lock().unwrap();
    assert_eq!(recorder.input_activity(), None, "meter must never block capture");
    assert_eq!(recorder.input_waveform(), None);
    drop(held);
}

#[test]
fn stop_joins_worker_before_reading_its_last_samples() {
    let samples = Arc::new(Mutex::new(Samples::default()));
    let output = Arc::clone(&samples);
    let (stop_sender, stop_receiver) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        assert!(matches!(
            stop_receiver.recv_timeout(Duration::from_secs(2)),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
        ));
        output.lock().unwrap().extend([0.1, 0.2, 0.3]);
        Ok(())
    });
    let audio = AudioRecorder {
        worker: Some(worker),
        stop_sender: Some(stop_sender),
        samples,
        writer: None,
        error: Arc::new(Mutex::new(None)),
        health: Arc::new(Mutex::new(InputHealth::new(Instant::now()))),
        live: None,
        word_probe: None,
        local_streaming: false,
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        streaming: None,
        #[cfg(target_os = "linux")]
        pause: None,
        #[cfg(target_os = "linux")]
        buffered: None,
    }
    .stop()
    .unwrap();
    assert_eq!(audio.sample_count, 3);
    assert_eq!(
        hound::WavReader::new(Cursor::new(audio.wav_bytes))
            .unwrap()
            .duration(),
        3
    );
}

#[test]
fn a_device_lost_partway_keeps_what_it_heard() {
    let recorder = |samples: Vec<f32>| AudioRecorder {
        worker: None,
        stop_sender: None,
        samples: Arc::new(Mutex::new(samples.into())),
        writer: None,
        error: Arc::new(Mutex::new(Some("Device disconnected".into()))),
        health: Arc::new(Mutex::new(InputHealth::new(Instant::now()))),
        live: None,
        word_probe: None,
        local_streaming: false,
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        streaming: None,
        #[cfg(target_os = "linux")]
        pause: None,
        #[cfg(target_os = "linux")]
        buffered: None,
    };
    assert_eq!(recorder(vec![0.1; 160]).stop().unwrap().sample_count, 160);
    assert_eq!(recorder(Vec::new()).stop().unwrap().sample_count, 0);
}

#[test]
fn unavailable_input_keeps_its_lease_through_screen_finalization() {
    let dir = std::env::temp_dir().join(format!("apparent-no-mic-{}", crate::shared::ids::make_bundle_id()));
    crate::capture::engine::bundle::recover::begin_screen_capture(&dir).unwrap();
    let samples = Arc::new(Mutex::new(Samples::default()));
    let error = Arc::new(Mutex::new(None));
    let writer = Writer::start(&dir, samples.clone(), error.clone()).unwrap();
    let recorder = AudioRecorder {
        worker: Some(std::thread::spawn(|| bail!("device unavailable"))),
        stop_sender: None,
        samples,
        writer: Some(writer),
        error,
        health: Arc::new(Mutex::new(InputHealth::new(Instant::now()))),
        live: None,
        word_probe: None,
        local_streaming: false,
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        streaming: None,
        #[cfg(target_os = "linux")]
        pause: None,
        #[cfg(target_os = "linux")]
        buffered: None,
    };
    let audio = recorder.stop().unwrap();
    assert_eq!(audio.sample_count, 0, "unavailable input must not claim recorded narration");
    assert!(super::super::persistence::Lease::acquire(&dir).is_err());
    assert!(!crate::capture::engine::bundle::recover::owed(&dir));
    drop(audio);
    super::super::persistence::acquire_released_lease(&dir).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn speech_islands_merge_only_short_silences() {
    let mut samples = vec![0.0; 32_000];
    samples[1_600..4_800].fill(0.2);
    samples[8_800..12_800].fill(0.2);
    samples[18_400..20_800].fill(0.2);
    assert_eq!(speech_islands(&samples), vec![(100, 800), (1_150, 1_300)]);
    assert!(speech_islands(&[0.001; 800]).is_empty());
    assert!(speech_islands(&[]).is_empty());
}

#[test]
fn speech_islands_adapt_to_a_noisy_floor() {
    let mut samples: Vec<f32> = (0..32_000)
        .map(|i| if i % 2 == 0 { 0.006 } else { -0.006 })
        .collect();
    samples[8_000..16_000]
        .iter_mut()
        .for_each(|s| *s = if *s > 0.0 { 0.15 } else { -0.15 });
    assert_eq!(speech_islands(&samples), vec![(500, 1_000)]);
}

#[test]
fn decoded_wav_round_trips() {
    let wav = encode_wav_16k(&[0.0, 0.5, -0.5]).unwrap();
    assert_eq!(decode_wav_16k(&wav).unwrap(), vec![0.0, 0.5, -0.5]);
    assert!(decode_wav_16k(b"nope").is_err());
}

#[test]
fn wav_is_mono_16k_pcm_and_clips_safely() {
    let bytes = encode_wav_16k(&[-2.0, -0.5, 0.0, 0.5, 2.0, f32::NAN]).unwrap();
    let mut reader = hound::WavReader::new(Cursor::new(bytes)).unwrap();
    assert_eq!(reader.spec().channels, 1);
    assert_eq!(reader.spec().sample_rate, 16_000);
    assert_eq!(reader.spec().bits_per_sample, 16);
    assert_eq!(reader.spec().sample_format, hound::SampleFormat::Int);
    assert_eq!(
        reader
            .samples::<i16>()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap(),
        vec![-32_768, -16_384, 0, 16_384, 32_767, 0]
    );
}
