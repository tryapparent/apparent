#[test]
fn demo_bundle_saves_finish_trace_without_configuration() {
    let dir = std::env::temp_dir().join(format!("{}.apparent", make_bundle_id()));
    let (result, stages) = trace::collect(true, || generate_demo_bundle(Some(dir.clone())));
    let (built, _, _) = result.unwrap();
    let names: Vec<_> = stages.spans.iter().map(|s| s.operation.name()).collect();
    for expected in [
        "recording.bundle.build",
        "recording.keyframes.select",
        "recording.frames.annotate_and_crop",
        "recording.contact_sheet.render",
        "recording.artifacts.write",
        "recording.publication.validate",
        "recording.publication.sync",
    ] {
        assert!(names.contains(&expected), "missing {expected}: {names:?}");
    }
    let build = stages
        .spans
        .iter()
        .find(|s| s.operation.name() == "recording.bundle.build")
        .unwrap();
    assert!(
        stages
            .spans
            .iter()
            .all(|s| build.start <= s.start && s.end <= build.end)
    );
    assert_eq!(built, dir);
    let trace: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("finish-trace.json")).unwrap()).unwrap();
    assert_eq!(trace["version"], 1);
    assert!(trace["totalMs"].is_u64());
    assert!(dir.join("apparent.json").exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn finish_trace_contains_only_timings() {
    let dir = std::env::temp_dir().join(make_bundle_id());
    std::fs::create_dir_all(&dir).unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let trace = FinishTrace {
        version: 1,
        stop_ms: Some(8),
        audio_ms: None,
        candidates_ms: None,
        transcribe_ms: Some(40),
        hosted_transcription: None,
        select_ms: 2,
        decode_ms: 3,
        autocrop_ms: 4,
        sheet_ms: 5,
        write_ms: 6,
        total_ms: 50,
        prepared_visuals: false,
    };
    let path = dir.join("finish-trace.json");
    save_finish_trace(&dir, &trace).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(json["transcribeMs"], 40);
    assert_eq!(json["totalMs"], 50);
    assert_eq!(json["preparedVisuals"], false);
    assert_eq!(json.as_object().unwrap().len(), 12);
    std::fs::remove_dir_all(dir).unwrap();
}
