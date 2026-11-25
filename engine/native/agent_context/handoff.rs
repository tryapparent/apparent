use crate::embedded_policy::EmbeddedPolicy;
use crate::shared::model::{
    ActionKind, ActionWindow, ApparentBundle, InteractionEvent, Keyframe, Mark, Shape, format_clock,
};
use crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX;
use std::collections::{HashMap, HashSet};

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
            None if bundle.has_action_window_observations() => Self::Unknown,
            None => Self::None,
        }
    }
}

pub(super) struct ContextLine<'a> {
    pub(super) text: String,
    pub(super) window: WindowEvidence<'a>,
    pub(super) page: Option<&'a str>,
}

impl<'a> ContextLine<'a> {
    pub(super) fn plain(text: String) -> Self {
        Self {
            text,
            window: WindowEvidence::None,
            page: None,
        }
    }
}

#[derive(Default)]
pub(super) struct BrowserPages<'a> {
    urls: HashMap<u64, &'a str>,
    consumed: HashSet<u64>,
}

impl<'a> BrowserPages<'a> {
    pub(super) fn collect(bundle: &'a ApparentBundle, compact: bool) -> Self {
        if !compact || bundle.device.is_some() {
            return Self::default();
        }
        let mut observations = HashMap::new();
        for event in &bundle.events {
            if let InteractionEvent::AppEvent { t, label } = event
                && let Some(url) = label.strip_prefix(BROWSER_PAGE_EVENT_PREFIX)
            {
                observations.entry(*t).and_modify(|entry| *entry = None).or_insert(Some(url));
            }
        }
        if observations.is_empty() {
            return Self::default();
        }
        let mut actions = HashMap::<u64, usize>::new();
        for t in bundle.events.iter().filter_map(|event| match event {
            InteractionEvent::Click { t, .. } | InteractionEvent::Drag { t, .. } => Some(*t),
            _ => None,
        }).chain(bundle.strokes.iter().filter(|stroke| !stroke.laser).map(|stroke| stroke.t0)) {
            *actions.entry(t).or_default() += 1;
        }
        let urls = observations.into_iter()
            .filter_map(|(t, url)| {
                let url = url?;
                (actions.get(&t) == Some(&1)
                    && crate::shared::routing::browser_page_url(url).as_deref() == Some(url))
                    .then_some((t, url))
            })
            .collect();
        Self { urls, consumed: HashSet::new() }
    }

    pub(super) fn url(&self, t: u64) -> Option<&'a str> {
        self.urls.get(&t).copied()
    }

    pub(super) fn is_empty(&self) -> bool {
        self.urls.is_empty()
    }

    pub(super) fn consumed(&self, t: u64) -> bool {
        self.consumed.contains(&t)
    }

    pub(super) fn take(&mut self, t: u64) -> Option<&'a str> {
        let url = self.url(t)?;
        self.consumed.insert(t).then_some(url)
    }

    pub(super) fn take_mark(
        &mut self,
        policy: &EmbeddedPolicy,
        bundle: &ApparentBundle,
        mark: &Mark,
    ) -> Option<&'a str> {
        if self.is_empty() || mark.pin.is_some() {
            return None;
        }
        let stamps = mark.strokes.iter()
            .map(|&index| bundle.strokes.get(index).map(|stroke| stroke.t0))
            .collect::<Option<Vec<_>>>()?;
        let first = self.url(*stamps.first()?)?;
        if stamps.iter().any(|&t| self.consumed(t)) {
            return None;
        }
        if stamps.len() > 1 {
            let pages: Vec<_> = stamps.iter().map(|&t| self.url(t).unwrap_or_default()).collect();
            let json = serde_json::to_string(&pages).ok()?;
            if policy.call("agreedPage", (json,)).ok()? != first {
                return None;
            }
        }
        self.consumed.extend(stamps);
        Some(first)
    }
}

pub(super) struct PageRun<'a> {
    frame: usize,
    url: &'a str,
    scope: String,
    window: Option<&'a ActionWindow>,
    rows: Vec<(String, String)>,
    multiple: bool,
}

impl<'a> PageRun<'a> {
    pub(super) fn push(
        pending: &mut Option<Self>,
        policy: &EmbeddedPolicy,
        frame: usize,
        line: ContextLine<'a>,
        url: &'a str,
        previous: &mut Option<&'a ActionWindow>,
        frames: &mut [FrameText],
    ) -> Option<()> {
        let (clock, text) = line.text.split_once(' ')?;
        let window = match line.window {
            WindowEvidence::Nearby(window) => Some(window),
            _ => None,
        };
        let scope = match window {
            Some(window) => {
                let path_empty = url.split_once("://")
                    .and_then(|(_, rest)| rest.split_once('/')).is_some_and(|(_, path)| path.is_empty());
                let json = serde_json::to_string(&[None, Some(window)]).ok()?;
                let heading = policy.call("windowHeading", (json,)).ok()?;
                policy.call("pageScope", (path_empty, safe_window_text(&heading))).ok()?
            }
            None => String::new(),
        };
        if let Some(run) = pending.as_mut()
            && policy.call("samePage", (run.url, run.scope.as_str(), url, scope.as_str())).ok()? == "yes"
        {
            run.multiple = true;
            if let Some((clocks, body)) = run.rows.last_mut()
                && policy.call("joinPageClicks", (body.as_str(), text)).ok()? == "yes"
            {
                clocks.push_str(", ");
                clocks.push_str(clock);
            } else {
                run.rows.push((clock.to_owned(), text.to_owned()));
            }
            return Some(());
        }
        Self::flush(pending, policy, previous, frames)?;
        *pending = Some(Self {
            frame, url, scope, window, rows: vec![(clock.to_owned(), text.to_owned())], multiple: false,
        });
        Some(())
    }

    pub(super) fn flush(
        pending: &mut Option<Self>,
        policy: &EmbeddedPolicy,
        previous: &mut Option<&'a ActionWindow>,
        frames: &mut [FrameText],
    ) -> Option<()> {
        let Some(run) = pending.take() else { return Some(()); };
        let out = &mut frames[run.frame].lines;
        let within_window = !run.multiple && run.window.is_some() && run.window == *previous;
        let scope = if within_window { "" } else { &run.scope };
        let heading = policy.call("pageHeading", (run.url, scope)).ok()?;
        if run.multiple {
            out.push(heading.clone());
        }
        for (clock, text) in run.rows {
            let inline = if run.multiple { "" } else { &heading };
            let line = policy.call("pageLine", (clock, text, inline)).ok()?;
            out.push(if run.multiple || within_window { format!("  {line}") } else { line });
        }
        if !within_window {
            *previous = None;
        }
        Some(())
    }
}

pub(super) fn fold_repeats(items: Vec<(u64, ContextLine<'_>)>) -> Vec<(u64, ContextLine<'_>)> {
    let mut out: Vec<(u64, ContextLine<'_>, u64, usize)> = Vec::new();
    for (t, action) in items {
        match out.last_mut() {
            Some((_, prev, last, count))
                if prev.text == action.text
                    && t - *last < super::REPEAT_MS
                    && prev.page.is_none()
                    && action.page.is_none()
                    && !action.text.starts_with(BROWSER_PAGE_EVENT_PREFIX) =>
            {
                *last = t;
                *count += 1;
            }
            _ => out.push((t, action, t, 1)),
        }
    }
    out.into_iter()
        .map(|(t, mut action, _, count)| {
            if count > 1 {
                action.text.push_str(&format!(" ×{count}"));
            }
            (t, action)
        })
        .collect()
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
            "agreedPage",
            "pageScope",
            "samePage",
            "joinPageClicks",
            "pageHeading",
            "pageLine",
            "pinWindowLine",
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
    if bundle.source.as_deref() == Some(crate::shared::model::IMPORTED_MOVIE_SOURCE) {
        let mut notice = String::from("Source: imported video. Structured clicks, ink, and window metadata are unavailable.\n");
        if let Some(missing) = &bundle.transcript.missing {
            notice.push_str(&format!("No transcript: {}\n", missing.reason));
        } else if bundle.audio.is_none() {
            notice.push_str("The imported movie has no audio track.\n");
        } else if bundle.transcript.text.trim().is_empty() {
            notice.push_str("No words transcribed from the imported movie.\n");
        }
        return notice;
    }
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
        None => "No words transcribed. The audio was saved.\n".into(),
    }
}
