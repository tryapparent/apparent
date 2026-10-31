//! Source-based audits must follow production code when it leaves capture.rs.

#[test]
fn extracted_sources_never_request_input_monitoring() {
    // Extend onboarding's literal-file audit without editing that separately owned module.
    let sources = [
        include_str!("../capture.rs"),
        include_str!("recorder.rs"),
        include_str!("telemetry.rs"),
        include_str!("artifacts.rs"),
    ];
    let calls = [
        concat!("CGRequest", "ListenEventAccess"),
        concat!("CGPreflight", "ListenEventAccess"),
        concat!("IOHIDRequest", "Access"),
        concat!("IOHIDCheck", "Access"),
        concat!("kCGEventTapOption", "ListenOnly"),
    ];
    for source in sources {
        assert!(!source.trim().is_empty());
        for call in calls {
            assert!(!source.contains(call), "{call} is still called");
        }
    }
}

#[test]
fn desktop_types_stay_out_of_the_direct_recorder_and_artifact_sources() {
    let recorder = include_str!("recorder.rs");
    let artifacts = include_str!("artifacts.rs");
    let desktop = include_str!("telemetry.rs");
    for source in [recorder, artifacts] {
        for dependency in [
            "LiveOverlayEvent",
            "SharedCaptureTelemetry",
            "crate::settings",
            "crate::onboarding",
            "crate::ui",
            "crate::handoff",
        ] {
            assert!(
                !source.contains(dependency),
                "direct Desktop dependency: {dependency}"
            );
        }
    }
    assert!(desktop.contains("pub enum LiveOverlayEvent"));
    assert!(desktop.contains("crate::onboarding::Event"));
    assert!(desktop.contains("crate::settings::Event"));
    assert!(desktop.contains("crate::settings::Shortcuts::load()"));
    // This seam is in-tree only: do not disguise the remaining native/retention dependencies.
    assert!(recorder.contains("platform::run_sampler"));
    assert!(recorder.contains("crate::retention::Recording"));
    assert!(artifacts.contains("crate::render::save_png"));
}
