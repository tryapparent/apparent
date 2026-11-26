use super::handoff::{
    BrowserPages, ContextLine, FrameText, PageRun, WindowEvidence, fold_repeats,
    open_handoff_policy, render_context_line, window_near_mark,
};
use super::{
    DragRun, Item, SCRUB_MS, Timed, changed_regions, click_anchor, drag_text,
    event_context_kind, event_text, frame_is_flagged, frame_starts, interleave, interleave_unsplit,
    marks_on, one_line, settled_events, window_changes, without_positions,
};
use crate::shared::model::{ActionKind, ApparentBundle, InteractionEvent, KeyframeReason, WordTiming};
use crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX;

pub(super) fn join_words(words: &[&WordTiming]) -> String {
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
    let mut words = words.into_iter();
    let mut out = Vec::with_capacity(bundle.keyframes.len());
    for frame in &bundle.keyframes {
        let target: String = frame.said.as_deref().unwrap_or("").split_whitespace().collect();
        let mut remaining = target.as_str();
        let mut taken = Vec::new();
        while !remaining.is_empty() {
            let word = words.next()?;
            let token: String = word.text.split_whitespace().collect();
            remaining = remaining.strip_prefix(&token)?;
            taken.push(word);
        }
        out.push(taken);
    }
    words.next().is_none().then_some(out)
}

pub(super) fn handoff_frames(bundle: &ApparentBundle, compact: bool) -> Option<Vec<FrameText>> {
    let frames = &bundle.keyframes;
    if frames.is_empty() {
        return None;
    }
    let policy = open_handoff_policy()?;
    let words = frame_words(bundle);
    let clicks: Vec<_> = frames
        .iter()
        .map(|frame| click_anchor(frame, &bundle.events))
        .collect();
    let starts = frame_starts(bundle, words.as_deref(), &clicks);
    let owner = |t: u64| starts.iter().rposition(|&s| s <= t).unwrap_or(0);
    let mut pages = BrowserPages::collect(bundle, compact);

    let mut items: Vec<Vec<Timed>> = frames.iter().map(|_| Vec::new()).collect();
    for (i, frame) in frames.iter().enumerate() {
        let shared = marks_on(frame, &bundle.marks);
        let numbered = shared.len() >= 2;
        for (n, mark) in shared.into_iter().enumerate() {
            if compact && mark.pin.is_some() && bundle.events.iter().any(|event| matches!(
                event, InteractionEvent::Note { t, pin, .. } if *t == mark.t0 && Some(*pin) == mark.pin
            )) {
                continue;
            }
            items[i].push(Timed {
                t: mark.t0,
                item: Item::Mark {
                    mark,
                    number: numbered.then_some(n + 1),
                    page: pages.take_mark(&policy, bundle, mark),
                },
            });
        }
        if frame.reason == KeyframeReason::Click && clicks[i].is_none() {
            let text = without_positions(&frame.event);
            if !text.trim().is_empty() {
                items[i].push(Timed {
                    t: frame.t,
                    item: Item::Event(ContextLine::plain(text)),
                });
            }
        }
    }
    for event in &bundle.events {
        if let InteractionEvent::Note { t, pin, text, .. } = event {
            let window = if compact {
                bundle
                    .marks
                    .iter()
                    .find(|mark| mark.pin == Some(*pin) && mark.t0 == *t)
                    .and_then(|mark| window_near_mark(&policy, bundle, mark).flatten())
            } else {
                None
            };
            items[owner(*t)].push(Timed {
                t: *t,
                item: Item::Note {
                    text: crate::capture::engine::sketch::typed_note_text(bundle, *pin, text),
                    window,
                },
            });
        }
    }
    for (t, action) in events(bundle, &mut pages) {
        items[owner(t)].push(Timed {
            t,
            item: Item::Event(action),
        });
    }

    let mut previous_window = None;
    let mut previous_screen = bundle.screen_at(0);
    let mut pending = None;
    let mut rendered = Vec::with_capacity(frames.len());
    for (i, frame) in frames.iter().enumerate() {
        let mut timed = std::mem::take(&mut items[i]);
        timed.sort_by_key(|item| item.t);
        let lines = match &words {
            Some(words) => interleave(&policy, bundle, &words[i], &timed, compact),
            None => interleave_unsplit(
                &policy,
                bundle,
                frame.said.as_deref(),
                frame.t,
                &timed,
                compact,
            ),
        }?;
        let scene = frame.reason == KeyframeReason::SceneChange;
        let keep_head = lines.is_empty()
            && (!compact || policy.call("keepFrameHead", (compact, scene, true)).ok()? == "yes");
        let head = match (!compact).then(|| changed_regions(bundle, i)).flatten() {
            Some(changed) => format!("[{changed} changed]"),
            None if keep_head => without_positions(&frame.event),
            None => String::new(),
        };
        if compact {
            let screen = bundle.screen_at(frame.t);
            if !head.is_empty() || screen != previous_screen || frame_is_flagged(bundle, frame) {
                PageRun::flush(&mut pending, &policy, &mut previous_window, &mut rendered)?;
                previous_window = None;
            }
            previous_screen = screen;
        }
        rendered.push(FrameText {
            head,
            lines: Vec::new(),
        });
        for line in lines {
            if let Some(url) = line.page {
                PageRun::push(
                    &mut pending,
                    &policy,
                    i,
                    line,
                    url,
                    &mut previous_window,
                    &mut rendered,
                )?;
            } else {
                PageRun::flush(&mut pending, &policy, &mut previous_window, &mut rendered)?;
                render_context_line(
                    &policy,
                    compact,
                    line,
                    &mut previous_window,
                    &mut rendered[i].lines,
                )?;
            }
        }
    }
    PageRun::flush(&mut pending, &policy, &mut previous_window, &mut rendered)?;
    for (frame, text) in frames.iter().zip(&mut rendered) {
        for mark in marks_on(frame, &bundle.marks) {
            let Some(pin) = mark.pin else { continue };
            let mut matches = bundle.action_context.iter().filter_map(|row| {
                let observation = row.pin_window.as_ref()?;
                (row.kind == ActionKind::Stroke && row.t == mark.t0 && observation.pin == pin)
                    .then_some(observation)
            });
            if let Some(snapshot) = matches.next()
                && matches.next().is_none()
                && let Ok(elements) = serde_json::to_string(&snapshot.elements)
                && let Ok(line) = policy.call("pinWindowLine", (
                    crate::shared::model::format_clock(mark.t0),
                    pin.to_string(),
                    elements,
                    snapshot.truncated,
                ))
                && !line.is_empty()
            {
                text.lines.push(line);
            }
        }
    }
    Some(rendered)
}

fn events<'a>(
    bundle: &'a ApparentBundle,
    pages: &mut BrowserPages<'a>,
) -> Vec<(u64, ContextLine<'a>)> {
    let settled = if pages.is_empty() {
        settled_events(&bundle.events)
    } else {
        let (verified_clicks, other): (Vec<_>, Vec<_>) = bundle.events.iter().cloned().partition(
            |event| matches!(event, InteractionEvent::Click { t, .. } if pages.url(*t).is_some()),
        );
        let mut settled = settled_events(&other);
        settled.extend(verified_clicks);
        settled.sort_by_key(InteractionEvent::timestamp_ms);
        settled
    };
    let page_scrubs: Vec<u64> = settled
        .iter()
        .filter_map(|e| match e {
            InteractionEvent::AppEvent { t, label }
                if bundle.device.is_none() && label.contains(" scrubbed to ") =>
            {
                Some(*t)
            }
            _ => None,
        })
        .collect();
    let mut out = Vec::new();
    let mut page_events = Vec::new();
    let mut drags = None::<DragRun<'_>>;
    for event in &settled {
        if let InteractionEvent::Drag { t, t1, .. } = event {
            let reported = page_scrubs
                .iter()
                .any(|&s| s + SCRUB_MS >= *t && s <= t1 + SCRUB_MS);
            if let Some(drag) = drag_text(event).filter(|_| !reported) {
                let window = bundle.window_observed_near_action(ActionKind::Pointer, *t);
                if let Some(url) = pages.take(*t) {
                    out.extend(drags.take().map(|run| run.line(bundle)));
                    let (time, mut action) = DragRun::new(drag, *t, *t1, window).line(bundle);
                    action.page = Some(url);
                    out.push((time, action));
                    continue;
                }
                match &mut drags {
                    Some(run) if run.joins(&drag, *t, window) => run.add(drag, *t1),
                    _ => {
                        out.extend(drags.take().map(|run| run.line(bundle)));
                        drags = Some(DragRun::new(drag, *t, *t1, window));
                    }
                }
            }
            continue;
        }
        let line = match event {
            InteractionEvent::AppEvent { t, label }
                if pages.url(*t).is_some() && label.starts_with(BROWSER_PAGE_EVENT_PREFIX) =>
            {
                page_events.push((*t, ContextLine::plain(label.clone())));
                None
            }
            InteractionEvent::AppEvent { t, label } if bundle.device.is_none() => {
                Some((*t, ContextLine::plain(label.clone())))
            }
            InteractionEvent::AppChange { t, app, .. } => {
                Some((*t, ContextLine::plain(format!("switched to {app}"))))
            }
            other => event_text(other).map(|text| {
                let window = event_context_kind(other).map_or(WindowEvidence::None, |kind| {
                    WindowEvidence::action(
                        bundle,
                        bundle.window_observed_near_action(kind, other.timestamp_ms()),
                    )
                });
                let t = other.timestamp_ms();
                let page = if matches!(other, InteractionEvent::Click { .. }) {
                    pages.take(t)
                } else {
                    None
                };
                (t, ContextLine { text, window, page })
            }),
        };
        out.extend(line);
    }
    out.extend(page_events.into_iter().filter(|(t, _)| !pages.consumed(*t)));
    out.extend(drags.map(|run| run.line(bundle)));
    out.extend(
        window_changes(&bundle.windows)
            .into_iter()
            .map(|(t, text)| (t, ContextLine::plain(text))),
    );
    out.extend(bundle.context_changes.iter().map(|change| {
        let text = match &change.value {
            Some(value) => format!("{} → {}", one_line(&change.key), one_line(value)),
            None => format!("{} cleared", one_line(&change.key)),
        };
        (change.t, ContextLine::plain(text))
    }));
    out.sort_by_key(|(t, _)| *t);
    if !bundle.has_action_window_observations() {
        fold_repeats(out)
    } else {
        out
    }
}
