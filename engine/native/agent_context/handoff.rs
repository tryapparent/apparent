use crate::embedded_policy::EmbeddedPolicy;
use crate::shared::model::{
    ActionKind, ActionWindow, ApparentBundle, Keyframe, Mark, Shape, format_clock,
};

const HANDOFF_LINE: &str = include_str!(concat!(env!("OUT_DIR"), "/agent-handoff-line.mjs"));

#[derive(Debug)]
pub struct FrameText {
    pub head: String,
    pub lines: Vec<String>,
}

#[derive(Clone, Copy)]
pub(super) enum WindowEvidence<'a> {
    None,
    Unknown,
    Nearby(&'a ActionWindow),
}

impl<'a> WindowEvidence<'a> {
    pub(super) fn action(bundle: &ApparentBundle, nearby: Option<&'a ActionWindow>) -> Self {
        match nearby {
            Some(window) => Self::Nearby(window),
            None if !bundle.action_context.is_empty() => Self::Unknown,
            None => Self::None,
        }
    }
}

pub(super) struct ContextLine<'a> {
    pub(super) text: String,
    pub(super) window: WindowEvidence<'a>,
}

impl<'a> ContextLine<'a> {
    pub(super) fn plain(text: String) -> Self {
        Self {
            text,
            window: WindowEvidence::None,
        }
    }
}

pub(crate) fn frame_is_flagged(bundle: &ApparentBundle, frame: &Keyframe) -> bool {
    frame
        .mark_id
        .as_ref()
        .and_then(|id| bundle.marks.iter().find(|mark| &mark.id == id))
        .is_some_and(|mark| mark.shape == Shape::Flag)
}

fn safe_window_text(text: &str) -> String {
    let mut safe = String::new();
    for ch in text.chars() {
        match ch {
            ch if ch.is_control() || matches!(ch, '\u{2028}' | '\u{2029}') => safe.push(' '),
            '\\' | '[' | ']' | '<' | '>' | '`' | '*' | '_' => {
                safe.push('\\');
                safe.push(ch);
            }
            ch => safe.push(ch),
        }
    }
    safe
}

pub(super) fn render_context_line<'a>(
    policy: &EmbeddedPolicy,
    compact: bool,
    line: ContextLine<'a>,
    previous: &mut Option<&'a ActionWindow>,
    out: &mut Vec<String>,
) -> Option<()> {
    let nearby = match line.window {
        WindowEvidence::Nearby(window) => Some(window),
        _ => None,
    };
    let text = match (compact, line.window) {
        (_, WindowEvidence::None) => line.text,
        (true, WindowEvidence::Unknown) => line.text + " · Window unknown",
        (true, WindowEvidence::Nearby(window)) => {
            let json = serde_json::to_string(&[*previous, Some(window)]).ok()?;
            let heading: String = policy.call("windowHeading", (json,)).ok()?;
            if !heading.is_empty() {
                out.push(safe_window_text(&heading));
            }
            format!("  {}", line.text)
        }
        (false, _) => {
            let json = serde_json::to_string(&[nearby]).ok()?;
            let suffix: String = policy.call("windowSuffix", (json,)).ok()?;
            line.text + &safe_window_text(&suffix)
        }
    };
    *previous = nearby;
    out.push(text);
    Some(())
}

pub(super) fn line(
    policy: &EmbeddedPolicy,
    kind: &str,
    t: u64,
    number: &str,
    text: &str,
    suffix: &str,
    compact: bool,
) -> Option<String> {
    let text = if kind == "Note" {
        text.to_owned()
    } else {
        text.replace(['\r', '\n'], " ")
    };
    policy
        .call(
            "handoffLine",
            (kind, format_clock(t), number, text, suffix, compact),
        )
        .ok()
}

pub(super) fn open_handoff_policy() -> Option<EmbeddedPolicy> {
    EmbeddedPolicy::open(
        "agent-handoff-line",
        HANDOFF_LINE,
        &[
            "handoffLine",
            "windowAgrees",
            "windowHeading",
            "windowSuffix",
            "keepFrameHead",
        ],
    )
    .ok()
}

pub(crate) fn append_frame(
    out: &mut String,
    prefix: &str,
    screen_marker: &str,
    flag: bool,
    text: FrameText,
    compact: bool,
) {
    if !compact || !screen_marker.is_empty() || flag || !text.head.is_empty() {
        out.push_str(prefix);
        out.push_str(screen_marker);
        if flag {
            out.push_str(" ⚑");
        }
        if !text.head.is_empty() {
            out.push(' ');
            out.push_str(&text.head);
        }
        out.push('\n');
    }
    for line in text.lines {
        if !compact {
            out.push_str("  ");
        }
        out.push_str(&line);
        out.push('\n');
    }
}

pub(super) fn window_near_mark<'a>(
    policy: &EmbeddedPolicy,
    bundle: &'a ApparentBundle,
    mark: &Mark,
) -> Option<Option<&'a ActionWindow>> {
    let observations: Vec<_> = mark
        .strokes
        .iter()
        .map(|&index| {
            let stroke = bundle.strokes.get(index)?;
            bundle.window_observed_near_action(ActionKind::Stroke, stroke.t0)
        })
        .collect();
    let nearby = match observations.as_slice() {
        [Some(window)] => Some(*window),
        [Some(window), ..] => {
            let json = serde_json::to_string(&observations).ok()?;
            let agrees = policy.call("windowAgrees", (json,)).ok()? == "yes";
            agrees.then_some(*window)
        }
        _ => None,
    };
    Some(nearby)
}

pub(crate) fn audio_notice(
    bundle: &ApparentBundle,
    bundle_dir: &std::path::Path,
    compact: bool,
) -> String {
    if bundle.source.as_deref() == Some("iphone")
        || bundle
            .context
            .get("microphoneCapture")
            .is_some_and(|value| value == "off")
    {
        return String::new();
    }
    if !bundle.has_microphone_samples(bundle_dir) {
        return "No microphone audio was saved. Check the microphone and try again.\n".into();
    }
    if !bundle.transcript.text.trim().is_empty() {
        return String::new();
    }
    match &bundle.transcript.missing {
        Some(missing) => format!("No transcript: {}\n", missing.reason),
        None if bundle.transcript.source == "none" => "No transcript: Recognition did not run. The audio is saved.\n".into(),
        None if compact && !bundle.transcript.source.trim().is_empty() => String::new(),
        None => "No words transcribed. Your audio was saved—check it or try again closer to the microphone.\n".into(),
    }
}
