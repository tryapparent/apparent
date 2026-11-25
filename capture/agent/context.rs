use crate::embedded_policy::EmbeddedPolicy;
#[path = "../../engine/native/agent_context/handoff.rs"]
mod handoff;
#[path = "../../engine/native/agent_context/timeline.rs"]
mod timeline;
use handoff::{ContextLine, FrameText, WindowEvidence, line, window_near_mark};
use timeline::handoff_frames;
pub(crate) use handoff::{append_frame, audio_notice, frame_is_flagged};
use crate::shared::model::*;
use crate::capture::engine::sketch::{
    describe_event, direction, mark_on_keyframe, marks_on, quote_label, settled_events,
};

pub(crate) fn clipboard_frame_hint() -> &'static str {
    if crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT) {
        "\nUse apparent zoom for unidentified targets or visual details.\n"
    } else {
        "\nInspect relevant frames before edits.\n"
    }
}

pub(crate) fn window_observation_notice(bundle: &ApparentBundle) -> &'static str {
    if !bundle.action_context.is_empty() {
        "Nearby windows were sampled after input. Exact action windows are unknown.\n"
    } else if !bundle.marks.is_empty() {
        "Action windows unknown.\n"
    } else {
        ""
    }
}

/// How far back an item's place in the speech moves to the start of its clause.
const CLAUSE_SNAP_MS: u64 = 3_000;

/// How far forward an item's place moves to the end of its clause when the start is too far back.
const CLAUSE_SNAP_AFTER_MS: u64 = 1_200;

/// A pause this long ends a clause (`keyframes::CLAUSE_GAP_MS`).
const CLAUSE_GAP_MS: u64 = 1_500;

const CLICK_ANCHOR_MS: u64 = 1_500;

/// An unnamed drag shorter than this (normalized) says nothing the images don't.
const MIN_DRAG: f32 = 0.15;

/// How close a drag is to the dev page's report of a video scrub it caused.
const SCRUB_MS: u64 = 1_500;

/// Repeats of one thing closer together than this read as one line (`pressed ⌘T ×3`).
const REPEAT_MS: u64 = 3_000;

/// More on-screen windows than this changing at once (a Space switch) is one line.
const WINDOW_BURST: usize = 4;

enum Item<'a> {
    Mark {
        mark: &'a Mark,
        number: Option<usize>,
        page: Option<&'a str>,
    },
    Event(ContextLine<'a>),
    Note { text: String, window: Option<&'a ActionWindow> },
}

struct Timed<'a> {
    t: u64,
    item: Item<'a>,
}

/// The circled number for the `n`th mark (1-based) on a shared keyframe.
pub fn circled(n: usize) -> String {
    const DIGITS: [char; 20] = [
        '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱',
        '⑲', '⑳',
    ];
    DIGITS
        .get(n.wrapping_sub(1))
        .map_or_else(|| format!("({n})"), char::to_string)
}

pub(crate) fn keyframe_texts(bundle: &ApparentBundle) -> Option<Vec<FrameText>> {
    handoff_frames(bundle, false)
}

pub(crate) fn compact_keyframe_texts(bundle: &ApparentBundle) -> Option<Vec<FrameText>> {
    handoff_frames(bundle, true)
}

#[derive(Clone, Debug)]
pub struct MarkEntry<'a> {
    pub mark: &'a Mark,
    /// 1-based keyframe index, when a keyframe draws the mark.
    pub keyframe: Option<usize>,
    pub display_time: Option<&'a str>,
    pub number: usize,
    pub numbered: bool,
}

impl MarkEntry<'_> {
    pub fn line(&self) -> String {
        let frame = self.display_time.map(str::to_owned)
            .unwrap_or_else(|| self.keyframe.map_or("#-".to_owned(), |k| format!("#{k}")));
        let num = self.numbered.then(|| circled(self.number)).unwrap_or_default();
        format!(
            "{frame} ✎{num} {} {} · {}",
            format_clock(self.mark.t0),
            mark_text(self.mark),
            self.mark.id
        )
    }

    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "keyframe": self.keyframe,
            "number": self.number,
            "numbered": self.numbered,
            "id": self.mark.id,
            "t0": self.mark.t0,
            "t1": self.mark.t1,
            "time": format_clock(self.mark.t0),
            "shape": self.mark.shape,
            "on": self.mark.on,
            "strokes": self.mark.strokes.len(),
            "text": mark_text(self.mark),
            "frame": self.mark.frame,
        })
    }
}

/// Every mark, in time order, numbered the way the summary numbers them.
pub fn mark_entries(bundle: &ApparentBundle) -> Vec<MarkEntry<'_>> {
    let mut entries: Vec<MarkEntry> = bundle
        .marks
        .iter()
        .map(|mark| {
            let frame = bundle.keyframes.iter().find(|k| mark_on_keyframe(mark, k));
            let shown = frame.map(|k| marks_on(k, &bundle.marks)).unwrap_or_default();
            let pos = shown.iter().position(|m| std::ptr::eq(*m, mark));
            MarkEntry {
                mark,
                keyframe: frame.map(|k| k.index),
                display_time: frame.and_then(|k| k.display_time.as_deref()),
                number: pos.map_or(1, |n| n + 1),
                numbered: pos.is_some() && shown.len() >= 2,
            }
        })
        .collect();
    entries.sort_by_key(|e| e.mark.t0);
    entries
}

/// The mark `query` names: its id (`m2`), or its number as the text shows it (`2` or `②`), on
/// keyframe `keyframe` when given. A number on several keyframes needs the keyframe; numbers
/// shown as ①②③ win over single, unnumbered marks.
pub fn find_mark<'a>(
    bundle: &'a ApparentBundle,
    query: &str,
    keyframe: Option<usize>,
) -> Result<MarkEntry<'a>, String> {
    let entries = mark_entries(bundle);
    let query = query.trim();
    if let Some(entry) = entries.iter().find(|e| e.mark.id == query) {
        return Ok(entry.clone());
    }
    let number = query
        .parse::<usize>()
        .ok()
        .or_else(|| (1..=20).find(|&n| circled(n) == query))
        .ok_or_else(|| format!("“{query}” is neither a mark number nor a mark id"))?;
    let on_frame: Vec<&MarkEntry> = entries
        .iter()
        .filter(|e| e.number == number && keyframe.is_none_or(|k| e.keyframe == Some(k)))
        .collect();
    let shown: Vec<&MarkEntry> = on_frame.iter().copied().filter(|e| e.numbered).collect();
    let candidates = if shown.is_empty() { on_frame } else { shown };
    match candidates.as_slice() {
        [one] => Ok((*one).clone()),
        [] => Err(match keyframe {
            Some(k) => format!("Keyframe #{k} has no mark {}", circled(number)),
            None => format!("No mark {} in this bundle", circled(number)),
        }),
        many => Err(format!(
            "Mark {} is on several keyframes ({}); add --frame <N> or use the mark id",
            circled(number),
            many.iter().map(|e| e.line()).collect::<Vec<_>>().join("; ")
        )),
    }
}

fn normalized(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Recovers which timed words each keyframe's `said` was built from (Record's transcript policy
/// gives every frame a run of the time-sorted words). `None` when the transcript has no word
/// times or the text doesn't line up, and the speech is then shown whole.
fn frame_words(bundle: &ApparentBundle) -> Option<Vec<Vec<&WordTiming>>> {
    let mut words: Vec<&WordTiming> = bundle
        .transcript
        .words
        .iter()
        .filter(|w| !w.text.trim().is_empty())
        .collect();
    if words.is_empty() {
        return None;
    }
    words.sort_by_key(|w| w.t0);
    let mut next = 0;
    let mut out = Vec::with_capacity(bundle.keyframes.len());
    for frame in &bundle.keyframes {
        let target = normalized(frame.said.as_deref().unwrap_or(""));
        let mut acc = String::new();
        let mut taken = Vec::new();
        while acc.len() < target.len() && next < words.len() {
            acc.push_str(&normalized(&words[next].text));
            taken.push(words[next]);
            next += 1;
        }
        if acc != target {
            return None;
        }
        out.push(taken);
    }
    Some(out)
}

/// When each keyframe's stretch of the recording starts: its first word, first mark or own moment,
/// whichever is earliest, and never before the previous one. The first frame owns the lead-in.
fn frame_starts(bundle: &ApparentBundle, words: Option<&[Vec<&WordTiming>]>, clicks: &[Option<u64>]) -> Vec<u64> {
    let mut starts: Vec<u64> = Vec::with_capacity(bundle.keyframes.len());
    for (i, frame) in bundle.keyframes.iter().enumerate() {
        let first_word = words.and_then(|w| w[i].first().map(|w| w.t0));
        let first_mark = marks_on(frame, &bundle.marks).first().map(|m| m.t0);
        let start = [Some(frame.t), first_word, first_mark, clicks[i]]
            .into_iter()
            .flatten()
            .min()
            .unwrap_or(frame.t);
        let start = if i == 0 { 0 } else { start.max(starts[i - 1]) };
        starts.push(start);
    }
    starts
}

fn click_anchor(frame: &Keyframe, events: &[InteractionEvent]) -> Option<u64> {
    if frame.reason != KeyframeReason::Click {
        return None;
    }
    events.iter()
        .filter(|event| matches!(event, InteractionEvent::Click { .. } | InteractionEvent::Drag { .. }))
        .map(InteractionEvent::timestamp_ms)
        .filter(|&t| t <= frame.t.saturating_add(200) && frame.t.saturating_sub(t) <= CLICK_ANCHOR_MS)
        .max()
}

/// A drag worth a line: one that names what it moved, or an unnamed one that went far.
#[derive(Clone, Debug, PartialEq)]
struct Drag {
    verb: &'static str,
    name: Option<String>,
    direction: String,
}

fn drag_text(event: &InteractionEvent) -> Option<Drag> {
    let InteractionEvent::Drag {
        x0,
        y0,
        x1,
        y1,
        label,
        button,
        ..
    } = event
    else {
        return None;
    };
    let label = label.as_deref().map(str::trim).filter(|l| !l.is_empty());
    if let Some(rest) = label.and_then(|l| l.strip_prefix("long press")) {
        let name = rest.trim_start_matches(':').trim();
        return Some(Drag {
            verb: "long-pressed",
            name: (!name.is_empty()).then(|| name.to_owned()),
            direction: String::new(),
        });
    }
    let touch = button.as_deref() == Some("touch");
    let (dx, dy) = (x1 - x0, y1 - y0);
    match label {
        Some(name) => {
            let lower = name.to_lowercase();
            let scrub = ["slider", "scroll bar", "scrubber", "timeline", "progress"]
                .iter()
                .any(|word| lower.contains(word));
            Some(Drag {
                verb: if scrub {
                    "scrubbed"
                } else if touch {
                    "swiped"
                } else {
                    "dragged"
                },
                name: Some(name.to_owned()),
                direction: direction(dx, dy, 0.04),
            })
        }
        None if dx.hypot(dy) >= MIN_DRAG => Some(Drag {
            verb: if touch { "swiped" } else { "dragged" },
            name: None,
            direction: direction(dx, dy, 0.04),
        }),
        None => None,
    }
}

/// Drags of one thing in quick succession, as one line.
struct DragRun<'a> {
    t: u64,
    end: u64,
    drags: Vec<Drag>,
    window: Option<&'a ActionWindow>,
}

impl<'a> DragRun<'a> {
    fn new(drag: Drag, t: u64, end: u64, window: Option<&'a ActionWindow>) -> Self {
        Self {
            t,
            end,
            drags: vec![drag],
            window,
        }
    }

    fn joins(&self, drag: &Drag, t: u64, window: Option<&ActionWindow>) -> bool {
        let first = &self.drags[0];
        first.verb == drag.verb && first.name == drag.name
            && self.window == window && t <= self.end + REPEAT_MS
    }

    fn add(&mut self, drag: Drag, end: u64) {
        self.end = self.end.max(end);
        self.drags.push(drag);
    }

    fn line(self, bundle: &ApparentBundle) -> (u64, ContextLine<'a>) {
        let first = &self.drags[0];
        let mut text = first.verb.to_owned();
        if let Some(name) = &first.name {
            text.push(' ');
            text.push_str(&quote_label(name));
        }
        let count = self.drags.len();
        let same_way = self.drags.iter().all(|d| d.direction == first.direction);
        // A scrub's direction and count say nothing; the dev page reports where it landed.
        if first.verb != "scrubbed" && first.verb != "long-pressed" {
            if same_way && first.direction != "a little" {
                text.push(' ');
                text.push_str(&first.direction);
            } else if !same_way {
                text.push_str(" back and forth");
            }
        }
        if count > 1 && first.verb != "scrubbed" {
            text.push_str(&format!(" ×{count}"));
        }
        (self.t, ContextLine { text, window: WindowEvidence::action(bundle, self.window), page: None })
    }
}

fn event_context_kind(event: &InteractionEvent) -> Option<ActionKind> {
    match event {
        InteractionEvent::Click { .. } | InteractionEvent::Drag { .. } => Some(ActionKind::Pointer),
        InteractionEvent::Key { .. } => Some(ActionKind::Key),
        InteractionEvent::Scroll { .. } => Some(ActionKind::Scroll),
        _ => None,
    }
}

fn event_text(event: &InteractionEvent) -> Option<String> {
    match event {
        InteractionEvent::Note { .. } => None, // Kept as separate lossless items in keyframe_texts().
        InteractionEvent::Click {
            label,
            button,
            role,
            ..
        } => {
            let mut text = if button.as_deref() == Some("touch") {
                "tapped"
            } else {
                "clicked"
            }
            .to_owned();
            if let Some(role) = role.as_deref().filter(|r| !r.is_empty()) {
                text.push(' ');
                text.push_str(role);
            }
            if let Some(label) = label.as_deref().filter(|l| !l.is_empty()) {
                text.push(' ');
                text.push_str(&quote_label(label));
            }
            Some(text)
        }
        InteractionEvent::Point { label, .. } => label
            .as_deref()
            .filter(|l| !l.is_empty())
            .map(|l| format!("pointed at {}", quote_label(l))),
        other => Some(describe_event(other)),
    }
}

/// What a mark is: its shape, what it was drawn on when something names that, and its stroke
/// count when more than one.
fn mark_text(mark: &Mark) -> String {
    let mut text = match mark.shape {
        Shape::Circle => "circled".to_owned(),
        Shape::Underline => "underlined".to_owned(),
        Shape::Line => "drew a line".to_owned(),
        Shape::Arrow => "drew an arrow".to_owned(),
        Shape::Pin => format!("pin {}", mark.pin.unwrap_or(1)),
        Shape::Tap => "tapped".to_owned(),
        Shape::Mark => "marked".to_owned(),
        Shape::Flag => "flagged this moment".to_owned(),
    };
    if let Some(on) = mark_target(mark) {
        text.push_str(match mark.shape {
            Shape::Arrow => " pointing to ",
            Shape::Pin | Shape::Line => " on ",
            _ => " ",
        });
        text.push_str(&on);
    }
    text.push_str(&stroke_suffix(mark));
    text
}

fn mark_target(mark: &Mark) -> Option<String> {
    mark.on.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(quote_label)
}

fn stroke_suffix(mark: &Mark) -> String {
    if mark.strokes.len() > 1 {
        format!(" ({} strokes)", mark.strokes.len())
    } else {
        String::new()
    }
}

/// A keyframe's own description without its `(x 0.50, y 0.70)` positions.
fn without_positions(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find(" (x ") {
        out.push_str(&rest[..start]);
        match rest[start..].find(')') {
            Some(end) => rest = &rest[start + end + 1..],
            None => {
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn one_line(raw: &str) -> String {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 60 {
        compact
    } else {
        let cut: String = compact.chars().take(59).collect();
        format!("{}…", cut.trim_end())
    }
}

/// Ordinary app windows appearing and disappearing between window-log snapshots, by app name.
fn window_changes(snapshots: &[WindowSnapshot]) -> Vec<(u64, String)> {
    let normal = |snapshot: &WindowSnapshot| -> Vec<(u32, String)> {
        snapshot
            .windows
            .iter()
            .filter(|w| w.layer == 0 && w.regular && w.app != "Apparent")
            .map(|w| (w.id, w.app.clone()))
            .collect()
    };
    let mut out = Vec::new();
    for pair in snapshots.windows(2) {
        let (before, after) = (normal(&pair[0]), normal(&pair[1]));
        let opened: Vec<&String> = after
            .iter()
            .filter(|(id, _)| !before.iter().any(|(b, _)| b == id))
            .map(|(_, app)| app)
            .collect();
        let closed: Vec<&String> = before
            .iter()
            .filter(|(id, _)| !after.iter().any(|(a, _)| a == id))
            .map(|(_, app)| app)
            .collect();
        let t = pair[1].t;
        if opened.len() + closed.len() > WINDOW_BURST {
            out.push((
                t,
                format!(
                    "on-screen windows changed ({} opened, {} closed)",
                    opened.len(),
                    closed.len()
                ),
            ));
            continue;
        }
        for app in closed {
            out.push((t, format!("{app} window closed")));
        }
        for app in opened {
            out.push((t, format!("{app} window opened")));
        }
    }
    out
}

/// Joins recognizer words the way Record's transcript policy does.
fn join_words(words: &[&WordTiming]) -> String {
    let mut text = String::new();
    for word in words {
        let unit = word.text.trim();
        let attached = unit.starts_with([',', '.', '!', '?', ';', ':', '’', '\'', ')', ']', '”']);
        let open = text.ends_with(['(', '[', '“']);
        if !text.is_empty() && !attached && !open {
            text.push(' ');
        }
        text.push_str(unit);
    }
    text
}

fn action_line<'a>(policy: &EmbeddedPolicy, bundle: &'a ApparentBundle, timed: &Timed<'a>, compact: bool) -> Option<ContextLine<'a>> {
    let t = timed.t;
    match &timed.item {
        Item::Mark { mark, number, page } => {
            let number = number.map(circled).unwrap_or_default();
            let nearby = window_near_mark(policy, bundle, mark)?;
            let text = if mark.shape == Shape::Circle {
                let target = mark_target(mark).unwrap_or_default();
                line(policy, "Circle", t, &number, &target, &stroke_suffix(mark), compact)?
            } else {
                line(policy, "Mark", t, &number, &mark_text(mark), "", compact)?
            };
            Some(ContextLine { text, window: WindowEvidence::action(bundle, nearby), page: *page })
        }
        Item::Event(action) => Some(ContextLine {
            text: line(policy, "Action", t, "", &action.text, "", compact)?,
            window: action.window,
            page: action.page,
        }),
        Item::Note { text, window } => Some(ContextLine {
            text: line(policy, "Note", t, "", text, "", compact)?,
            window: window.map_or(WindowEvidence::None, WindowEvidence::Nearby),
            page: None,
        }),
    }
}

/// Indexes of the words that start a clause: after clause punctuation (a comma once the clause
/// has three words), or after a pause of `CLAUSE_GAP_MS`, as `keyframes` breaks clauses.
fn clause_starts(words: &[&WordTiming]) -> Vec<usize> {
    let mut starts = Vec::new();
    let mut clause_words = 0;
    for (i, word) in words.iter().enumerate() {
        let new_clause = i == 0 || {
            let prev = words[i - 1];
            let text = prev.text.trim_end_matches(['"', '\'', '”', '’', ')', ']']);
            text.ends_with(['.', '!', '?', ';', ':'])
                || (clause_words >= 3 && text.ends_with(','))
                || word.t0.saturating_sub(prev.t1) >= CLAUSE_GAP_MS
        };
        if new_clause {
            starts.push(i);
            clause_words = 0;
        }
        clause_words += 1;
    }
    starts
}

/// Where the words split for an item. Speech isn't cut mid-clause when it can be helped: an item
/// moves back to the start of the clause in progress if that began within `CLAUSE_SNAP_MS`,
/// else forward to the clause's end if that comes within `CLAUSE_SNAP_AFTER_MS`.
fn split_point(t: u64, words: &[&WordTiming], clauses: &[usize]) -> u64 {
    let Some(inside) = words.iter().position(|w| w.t0 >= t) else {
        return t;
    };
    if clauses.contains(&inside) {
        return t.min(words[inside].t0);
    }
    let start = clauses
        .iter()
        .rev()
        .find(|&&c| c < inside)
        .copied()
        .unwrap_or(0);
    if t.saturating_sub(words[start].t0) <= CLAUSE_SNAP_MS {
        return words[start].t0;
    }
    // Forward to just after the clause's last word, if it ends soon.
    let end = clauses
        .iter()
        .find(|&&c| c > inside)
        .copied()
        .unwrap_or(words.len());
    if words[end - 1].t1.saturating_sub(t) <= CLAUSE_SNAP_AFTER_MS {
        words.get(end).map_or(words[end - 1].t1 + 1, |w| w.t0)
    } else {
        t
    }
}

fn interleave<'a>(
    policy: &EmbeddedPolicy,
    bundle: &'a ApparentBundle,
    words: &[&WordTiming],
    items: &[Timed<'a>],
    compact: bool,
) -> Option<Vec<ContextLine<'a>>> {
    let clauses = clause_starts(words);
    let mut lines = Vec::new();
    let mut remaining = words;
    let mut last_split = 0;
    for item in items {
        let split = if matches!(item.item, Item::Note { .. }) {
            item.t
        } else {
            split_point(item.t, words, &clauses)
        };
        last_split = split.max(last_split);
        let end = remaining.partition_point(|word| word.t0 < last_split);
        push_speech(policy, &mut lines, &remaining[..end], compact)?;
        lines.push(action_line(policy, bundle, item, compact)?);
        remaining = &remaining[end..];
    }
    push_speech(policy, &mut lines, remaining, compact)?;
    Some(lines)
}

fn push_speech(policy: &EmbeddedPolicy, lines: &mut Vec<ContextLine<'_>>, words: &[&WordTiming], compact: bool) -> Option<()> {
    if let Some(word) = words.first() {
        lines.push(ContextLine::plain(line(policy, "Speech", word.t0, "", &join_words(words), "", compact)?));
    }
    Some(())
}

fn interleave_unsplit<'a>(
    policy: &EmbeddedPolicy,
    bundle: &'a ApparentBundle,
    said: Option<&str>,
    t: u64,
    items: &[Timed<'a>],
    compact: bool,
) -> Option<Vec<ContextLine<'a>>> {
    let mut lines = items.iter().map(|item| action_line(policy, bundle, item, compact)).collect::<Option<Vec<_>>>()?;
    if let Some(speech) = said.map(str::trim).filter(|s| !s.is_empty()) {
        lines.insert(items.partition_point(|item| item.t <= t), ContextLine::plain(line(policy, "Speech", t, "", speech, "", compact)?));
    }
    Some(lines)
}

fn changed_regions(bundle: &ApparentBundle, index: usize) -> Option<String> {
    let frame = bundle.keyframes.get(index)?;
    if frame.reason != KeyframeReason::SceneChange {
        return None;
    }
    let boxes = bundle.autocrop.as_ref()?.changes.get(index)?;
    let area = |b: &[f32; 4]| (b[2] - b[0]) * (b[3] - b[1]);
    merge_boxes(boxes)
        .iter()
        .any(|b| area(b) >= 0.9)
        .then(|| "whole screen".into())
}

fn merge_boxes(boxes: &[[f32; 4]]) -> Vec<[f32; 4]> {
    const TOUCH: f32 = 0.02;
    let mut out: Vec<[f32; 4]> = boxes.to_vec();
    loop {
        let mut joined = false;
        'outer: for i in 0..out.len() {
            for j in i + 1..out.len() {
                let (a, b) = (out[i], out[j]);
                if a[0] - TOUCH <= b[2]
                    && b[0] - TOUCH <= a[2]
                    && a[1] - TOUCH <= b[3]
                    && b[1] - TOUCH <= a[3]
                {
                    out[i] = [
                        a[0].min(b[0]),
                        a[1].min(b[1]),
                        a[2].max(b[2]),
                        a[3].max(b[3]),
                    ];
                    out.remove(j);
                    joined = true;
                    break 'outer;
                }
            }
        }
        if !joined {
            return out;
        }
    }
}

#[cfg(test)]
mod tests {
    include!("../../engine/native/agent_context/tests.rs");

    #[test]
    fn shortcuts_drags_and_windows_appear_inline_without_titles_or_jitter() {
        let said = "Okay, I hit command shift B. The whole window closes.";
        let mut b = bundle(
            words(&[
                (500, "Okay,"),
                (900, "I"),
                (1_100, "hit"),
                (1_300, "command"),
                (1_600, "shift"),
                (1_900, "B."),
                (5_000, "The"),
                (5_200, "whole"),
                (5_400, "window"),
                (5_600, "closes."),
            ]),
            vec![keyframe(1, 1_000, KeyframeReason::Click, said)],
        );
        let key = |t| InteractionEvent::Key {
            t,
            shortcut: "⇧⌘B".into(),
        };
        let drag = |t, x1: f32| InteractionEvent::Drag {
            t,
            t1: t + 300,
            x0: 0.5,
            y0: 0.5,
            x1,
            y1: 0.5,
            label: None,
            button: None,
            path: Vec::new(),
        };
        b.events = vec![
            key(2_000),
            key(2_400),
            key(2_900),
            drag(3_000, 0.503),
            drag(3_200, 0.56),
            drag(3_500, 0.8),
            drag(4_000, 0.9),
        ];
        let window = |id, title: &str| WindowEntry {
            id,
            app: "OpenCode".into(),
            bundle_id: None,
            regular: true,
            title: title.into(),
            bounds: [0, 0, 100, 100],
            layer: 0,
            frontmost: true,
        };
        let overlay = WindowEntry {
            layer: 25,
            ..window(9, "Hex")
        };
        b.windows = vec![
            WindowSnapshot {
                t: 0,
                windows: vec![window(1, "Secret plans"), overlay],
            },
            WindowSnapshot {
                t: 4_800,
                windows: Vec::new(),
            },
        ];
        let text = &keyframe_texts(&b).unwrap()[0];
        let all = format!("{}\n{}", text.head, text.lines.join("\n"));
        assert!(all.contains("pressed ⇧⌘B ×3"), "{all}");
        assert!(all.contains("0:03 Action: dragged right ×2"), "{all}");
        assert_eq!(
            all.matches("dragged").count(),
            1,
            "short drags are dropped and a run is one line: {all}"
        );
        assert!(!all.contains("x 0."), "no coordinates: {all}");
        assert!(
            all.contains("0:04 Action: OpenCode window closed\n0:05 Said: “The whole window closes.”"),
            "{all}"
        );
        assert!(!all.contains("Secret") && !all.contains("Hex"), "{all}");
    }

    #[test]
    fn scene_changes_say_where_the_screen_changed() {
        let mut b = bundle(
            Vec::new(),
            vec![
                keyframe(1, 1_000, KeyframeReason::SceneChange, ""),
                keyframe(2, 3_000, KeyframeReason::SceneChange, ""),
                keyframe(3, 5_000, KeyframeReason::Click, ""),
            ],
        );
        b.autocrop = Some(AutocropInfo {
            changes: vec![
                vec![[0.0, 0.0, 1.0, 0.95]],
                vec![
                    [0.70, 0.02, 0.80, 0.10],
                    [0.80, 0.02, 0.96, 0.12],
                    [0.10, 0.50, 0.12, 0.52],
                ],
                vec![[0.0, 0.0, 1.0, 1.0]],
            ],
            ..Default::default()
        });
        let texts = keyframe_texts(&b).unwrap();
        assert_eq!(texts[0].head, "[whole screen changed]");
        assert_eq!(
            texts[1].head, "scene changed",
            "unnamed regions aren't listed"
        );
        assert_eq!(
            texts[2].lines, ["0:05 Action: scene changed"],
            "click keyframes keep their stored action when events are missing"
        );
    }

    #[test]
    fn places_appear_only_with_a_name() {
        let mut b = bundle(
            Vec::new(),
            vec![keyframe(1, 9_000, KeyframeReason::Mark, "")],
        );
        b.strokes = vec![
            Stroke {
                color: None,
                on: Some("button “Window”".into()),
                ..stroke(1_000, 0.1, 0.2)
            },
            stroke(3_000, 0.4, 0.5),
            stroke(3_100, 0.4, 0.52),
        ];
        b.marks = crate::capture::engine::sketch::marks_of(&b.strokes);
        for mark in &mut b.marks {
            mark.frame = Some("frames/frame-01.png".into());
        }
        let slider = |t, x1| InteractionEvent::Drag {
            t,
            t1: t + 300,
            x0: 0.5,
            y0: 0.9,
            x1,
            y1: 0.9,
            label: Some("slider “Playback”".into()),
            button: None,
            path: Vec::new(),
        };
        b.events = vec![
            InteractionEvent::Click {
                t: 5_000,
                x: 0.3,
                y: 0.3,
                button: None,
                label: Some("“Area”".into()),
                role: Some("button".into()),
            },
            slider(6_000, 0.6),
            slider(6_800, 0.4),
            slider(7_500, 0.45),
            InteractionEvent::Point {
                t: 8_500,
                x: 0.2,
                y: 0.2,
                label: None,
            },
        ];
        let text = &keyframe_texts(&b).unwrap()[0];
        let marks: Vec<&str> = text.lines.iter().map(String::as_str).collect();
        assert_eq!(
            marks,
            [
                "0:01 Mark: ① underlined button “Window”",
                "0:03 Mark: ② underlined (2 strokes)",
                "0:05 Action: clicked button “Area”",
                "0:06 Action: scrubbed slider “Playback”",
            ],
            "{text:?}"
        );
    }

    #[test]
    fn speech_without_word_times_stays_whole() {
        let mut b = bundle(
            Vec::new(),
            vec![keyframe(
                1,
                1_000,
                KeyframeReason::Click,
                "Make it smaller.",
            )],
        );
        b.events = vec![InteractionEvent::Key {
            t: 600,
            shortcut: "⌘K".into(),
        }];
        b.keyframes[0].event = "clicked button “Save” (x 0.50, y 0.50)".into();
        let text = &keyframe_texts(&b).unwrap()[0];
        assert_eq!(text.lines, [
            "0:00 Action: pressed ⌘K",
            "0:01 Action: clicked button “Save”",
            "0:01 Said: “Make it smaller.”",
        ]);
    }

    #[test]
    fn the_summary_uses_these_lines_only_with_the_experiment() {
        let mut b = bundle(
            words(&[(20_000, "Look here.")]),
            vec![keyframe(1, 20_000, KeyframeReason::Click, "Look here.")],
        );
        b.keyframes[0].display_time = Some("0:20".into());
        b.events = vec![InteractionEvent::Click {
            t: 20_000, x: 0.5, y: 0.5, button: None, role: None, label: None,
        }];
        let dir = std::path::Path::new("/b");
        let off = crate::capture::engine::sketch::summary_markdown_with(&b, dir, false);
        let on = crate::capture::engine::sketch::summary_markdown_with(&b, dir, true);
        assert!(!off.contains("Said:"), "{off}");
        assert!(on.contains("0:20\n  0:20 Action: clicked\n  0:20 Said: “Look here.”\n"), "{on}");
    }

    #[test]
    fn repeated_clicks_fold_and_a_click_keyframe_owns_its_click() {
        let click = |t, x| InteractionEvent::Click {
            t,
            x,
            y: 0.5,
            button: None,
            label: None,
            role: None,
        };
        let mut b = bundle(
            Vec::new(),
            vec![
                keyframe(1, 500, KeyframeReason::SceneChange, ""),
                keyframe(2, 9_300, KeyframeReason::Click, ""),
            ],
        );
        b.events = vec![
            click(1_000, 0.63),
            click(2_500, 0.63),
            click(4_000, 0.63),
            click(9_000, 0.2),
        ];
        for labels in [[None, None], [Some("0:01"), Some("0:09.300")]] {
            for (frame, label) in b.keyframes.iter_mut().zip(labels) {
                frame.display_time = label.map(str::to_owned);
            }
            let texts = keyframe_texts(&b).unwrap();
            assert_eq!(texts[0].lines, ["0:01 Action: clicked ×3"]);
            assert_eq!(texts[1].lines, ["0:09 Action: clicked"]);
            assert!(texts[1].head.is_empty());
        }
    }

    #[test]
    fn unidentified_clicks_are_concise_without_hiding_page_labels_or_touch() {
        let click = |role: Option<&str>, label: Option<&str>, button: Option<&str>| {
            InteractionEvent::Click {
                t: 0,
                x: 0.0,
                y: 0.0,
                role: role.map(str::to_owned),
                label: label.map(str::to_owned),
                button: button.map(str::to_owned),
            }
        };
        assert_eq!(
            event_text(&click(None, None, None)).as_deref(),
            Some("clicked")
        );
        assert_eq!(
            event_text(&click(Some(""), Some(""), None)).as_deref(),
            Some("clicked")
        );
        assert_eq!(
            event_text(&click(Some("button"), Some("Area"), None)).as_deref(),
            Some("clicked button “Area”")
        );
        assert_eq!(
            event_text(&click(None, None, Some("touch"))).as_deref(),
            Some("tapped")
        );
    }
}
