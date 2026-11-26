use super::{REQUEST_LIMIT, evaluate, evaluate_file};
use crate::composition::worker;
use serde_json::{Value, json};
use std::{
    io::{Read, Seek},
    process::Command,
    time::Duration,
};

#[test]
fn embedded_media_policy_matches_packaged_workers() {
    let (node, script) =
        worker::policy_assets("Record assembly", "record-media", "assembly-worker.js").unwrap();
    let output = worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(script)
            .arg("30000"),
        Duration::from_secs(5),
        1024,
    )
    .unwrap();
    let embedded = evaluate("nativeAssembly", b"30000", 1024).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&embedded).unwrap(),
        serde_json::from_slice::<Value>(&output).unwrap(),
    );

    for (endpoint, script, request) in [
        (
            "nativeSpeechCues",
            "selection/worker.js",
            json!({"version":1,"estimated":false,"words":["Look!", "here", "looké"]}),
        ),
        (
            "nativeScenes",
            "selection/scene-worker.js",
            json!({"version":1,"times":["0","1000","1250","1500"],"deltas":[0.3,0.4,0],"drawing":[]}),
        ),
        (
            "nativeTranscript",
            "transcript/worker.js",
            json!({
                "version":1,"times":["1000","4000"],"anchors":["900"],
                "transcript":{"text":"Look here. 音声","words":[
                    {"t0":"400","t1":"600","text":"Look"},
                    {"t0":"950","t1":"1100","text":"here."},
                    {"t0":"3200","t1":"3400","text":"音声"}
                ],"segments":[]}
            }),
        ),
    ] {
        let bytes = serde_json::to_vec(&request).unwrap();
        let mut input = worker::private_input(&bytes).unwrap();
        let embedded = if endpoint == "nativeScenes" {
            evaluate_file(endpoint, &mut input, 8192).unwrap()
        } else {
            evaluate(endpoint, &bytes, 8192)
        }
        .unwrap();
        let (node, script) = worker::policy_assets("Record media", "record-media", script).unwrap();
        let output = worker::run_with_input(
            Command::new(node)
                .env("ELECTRON_RUN_AS_NODE", "1")
                .arg(script),
            input,
            Duration::from_secs(10),
            8192,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&embedded).unwrap(),
            serde_json::from_slice::<Value>(&output).unwrap(),
            "{endpoint}",
        );
    }
}

#[test]
fn rejected_embedded_requests_leave_worker_input_available() {
    for (request, max_output) in [
        (vec![b' '; REQUEST_LIMIT + 1], 1024),
        (br#"{"version":2}"#.to_vec(), 1024),
        (
            br#"{"version":1,"times":["0","1000"],"deltas":[0.3],"drawing":[]}"#.to_vec(),
            1,
        ),
    ] {
        let mut input = worker::private_input(&request).unwrap();
        assert!(
            evaluate_file("nativeScenes", &mut input, max_output)
                .unwrap()
                .is_none()
        );
        assert_eq!(input.stream_position().unwrap(), 0);
        let mut contents = Vec::new();
        input.read_to_end(&mut contents).unwrap();
        assert_eq!(contents, request);
    }
}
