use super::{KeyframeReason, bundle, keyframe, keyframe_texts, words};

#[test]
fn handoff_keeps_timed_punctuation_with_the_speech_in_its_keyframe() {
    let mut recording = bundle(
        words(&[
            (0, "Review"),
            (500, "this"),
            (700, ","),
            (2800, "then"),
            (3100, "save."),
        ]),
        vec![
            keyframe(1, 1000, KeyframeReason::SceneChange, "Review this,"),
            keyframe(2, 3000, KeyframeReason::SceneChange, "then save."),
        ],
    );
    let frames = keyframe_texts(&recording).unwrap();
    assert_eq!(frames[0].lines, ["0:00 Said: “Review this,”"]);
    assert_eq!(frames[1].lines, ["0:02 Said: “then save.”"]);

    recording.keyframes[0].said = Some("Review this!".into());
    let frames = keyframe_texts(&recording).unwrap();
    assert_eq!(frames[0].lines, ["0:01 Said: “Review this!”"]);
    assert_eq!(frames[1].lines, ["0:03 Said: “then save.”"]);
}
