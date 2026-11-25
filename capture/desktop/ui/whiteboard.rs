use anyhow::{Context as _, Result, ensure};
use gpui::{App, Entity};
use serde_json::{Value, json};

use super::super::{ApparentCoordinator, workflow::electron};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    sync::Arc,
    sync::mpsc::{Receiver, SyncSender, TryRecvError, sync_channel},
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Event {
    Ready { frame: [f32; 4] },
    Edit { sequence: u32, operation: Edit, point: Option<[f32; 2]> },
}

struct Window {
    id: String,
    child: Option<crate::capture::ui_process::UiChild>,
    #[cfg(target_os = "linux")]
    pid: u32,
    practice: bool,
    send: SyncSender<Value>,
    events: Receiver<Event>,
    deadline: Option<Instant>,
    frame: Option<[f32; 4]>,
}

impl Window {
    fn launch(mut command: Command) -> Result<Self> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let mut input = child.stdin.take().expect("piped stdin");
        let output = child.stdout.take().expect("piped stdout");
        let (send, messages) = sync_channel::<Value>(4);
        let (deliver, events) = sync_channel(512);
        let window = Self {
            id: crate::shared::ids::make_bundle_id(),
            #[cfg(target_os = "linux")]
            pid: child.id(),
            child: Some(crate::capture::ui_process::UiChild::new(child)),
            practice: false,
            send,
            events,
            deadline: None, frame: None };
        std::thread::Builder::new().name("whiteboard-input".into()).spawn(move || {
            for message in messages {
                if serde_json::to_writer(&mut input, &message).is_err()
                    || input.write_all(b"\n").is_err()
                    || input.flush().is_err()
                {
                    break;
                }
            }
        })?;
        std::thread::Builder::new().name("whiteboard-output".into()).spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                let Ok(length) = reader.by_ref().take(1025).read_until(b'\n', &mut line) else { break };
                if length == 0 || length > 1024 || line.last() != Some(&b'\n') {
                    break;
                }
                let Ok(event) = serde_json::from_slice(&line) else { break };
                if deliver.try_send(event).is_err() {
                    break;
                }
            }
        })?;
        Ok(window)
    }

    fn send(&self, message: Value) -> Result<()> {
        self.send.try_send(message).map_err(|_| anyhow::anyhow!("Whiteboard receiver unavailable"))
    }

    fn event(&self) -> Result<Option<Event>> {
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => {
                ensure!(self.frame.is_some() || self.deadline.is_none_or(|deadline| Instant::now() < deadline), "Whiteboard did not become ready");
                Ok(None)
            }
            Err(TryRecvError::Disconnected) => anyhow::bail!("Whiteboard disconnected"),
        }
    }
}

impl Drop for Window {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            std::thread::spawn(move || { let _ = child.wait(); });
        }
    }
}
use serde::{Deserialize, Serialize};

use crate::capture::engine::{bundle::bundle_processing::publication, render, sketch};
use crate::embedded_policy::EmbeddedPolicy;
use crate::shared::model::ApparentBundle;

#[path = "../../../engine/recording/whiteboard/pixels.rs"]
mod pixels;
use pixels::{PAPER_HEIGHT, PAPER_WIDTH, contact_sheet, render_paper};

type Stroke = Arc<Vec<[f32; 2]>>;

#[derive(Clone, Default, Serialize)]
pub(in crate::capture::desktop) struct Paper {
    pub color: [u8; 3],
    #[serde(serialize_with = "serialize_strokes")]
    pub strokes: Vec<Stroke>,
}

fn serialize_strokes<S: serde::Serializer>(strokes: &[Stroke], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_seq(strokes.iter().map(Arc::as_ref))
}

struct Revision {
    t: u64,
    edit: &'static str,
    paper: Paper,
}

#[derive(Default)]
pub(in crate::capture::desktop) struct SavedBoard {
    paper: Paper,
    revisions: VecDeque<Revision>,
}

#[cfg(test)]
impl From<Paper> for SavedBoard {
    fn from(paper: Paper) -> Self {
        Self { paper, ..Self::default() }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Edit {
    Begin,
    Move,
    End,
    Cancel,
    Undo,
    Clear,
    Close,
    #[serde(skip_deserializing)]
    Open,
}

#[derive(Deserialize)]
#[serde(tag = "$")]
enum Effect {
    Ignore,
    Show,
    Start,
    Append,
    Commit,
    Discard,
    UndoDraft { evict: bool },
    UndoStroke { evict: bool },
    ClearPaper { evict: bool },
    Hide,
    CommitAndHide,
    CommitAndStart,
}

struct PaperState {
    saved: SavedBoard,
    visible: bool,
    active: Option<Stroke>,
    policy: EmbeddedPolicy,
}

impl PaperState {
    fn open(color: [u8; 3]) -> Result<Self> {
        Ok(Self {
            saved: SavedBoard { paper: Paper { color, strokes: Vec::new() }, ..SavedBoard::default() },
            visible: false,
            active: None,
            policy: EmbeddedPolicy::open(
                "record-whiteboard",
                include_str!(concat!(env!("OUT_DIR"), "/record-whiteboard.mjs")),
                &["whiteboardEdit"],
            )?,
        })
    }

    fn edit(&mut self, event: Edit, point: Option<[f32; 2]>, t: u64) -> Result<bool> {
        let point = point.filter(|[x, y]| {
            (0.0..PAPER_WIDTH).contains(x) && (0.0..PAPER_HEIGHT).contains(y)
        });
        let output = self.policy.call("whiteboardEdit", (
            format!("{event:?}"),
            self.visible,
            self.active.is_some(),
            point.is_some(),
            self.saved.paper.strokes.len() as u32,
            self.active.as_ref().map_or(0, |stroke| stroke.len() as u32),
            self.saved.revisions.len() as u32,
        ))?;
        match serde_json::from_str(&output)? {
            Effect::Ignore => return Ok(false),
            Effect::Show => self.visible = true,
            Effect::Hide => self.visible = false,
            Effect::Start => self.active = point.map(|p| Arc::new(vec![p])),
            Effect::Append => {
                if let (Some(active), Some(point)) = (&mut self.active, point) {
                    Arc::make_mut(active).push(point);
                }
            }
            Effect::Discard => self.active = None,
            Effect::UndoDraft { evict } => {
                self.remember(t, "before Undo", evict);
                self.active = None;
            }
            Effect::UndoStroke { evict } => {
                self.remember(t, "before Undo", evict);
                self.saved.paper.strokes.pop();
            }
            Effect::ClearPaper { evict } => {
                self.remember(t, "before Clear", evict);
                self.active = None;
                self.saved.paper.strokes.clear();
            }
            Effect::Commit => self.commit(),
            Effect::CommitAndHide => {
                self.commit();
                self.visible = false;
            }
            Effect::CommitAndStart => {
                self.commit();
                self.active = point.map(|p| Arc::new(vec![p]));
            }
        }
        Ok(true)
    }

    fn commit(&mut self) {
        self.saved.paper.strokes.extend(self.active.take());
    }

    fn remember(&mut self, t: u64, edit: &'static str, evict: bool) {
        if evict { self.saved.revisions.pop_front(); }
        let mut paper = self.saved.paper.clone();
        paper.strokes.extend(self.active.iter().cloned());
        self.saved.revisions.push_back(Revision { t, edit, paper });
    }
}
#[derive(Default)]
pub(in crate::capture::desktop) struct Board {
    color: [u8; 3],
    board: Option<PaperState>,
    window: Option<Window>,
}

impl Board {
    pub fn reset(&mut self) {
        *self = Self { color: crate::shared::handoff::pen::rgb(), ..Self::default() };
    }

    fn open(&mut self, practice: bool, warm: bool) -> Result<()> {
        if warm && self.board.is_some() { return Ok(()); }
        let board = match self.board.as_mut() {
            Some(board) => board,
            None => self.board.insert(PaperState::open(self.color)?),
        };
        if self.window.is_none() {
            let resources = electron::resolve()?;
            let entry = resources.root.join("dist/whiteboard/main.cjs");
            ensure!(entry.is_file(), "Packaged Whiteboard unavailable");
            let mut command = Command::new(&resources.executable);
            electron::configure_sandbox(&mut command, &resources.executable)?;
            #[cfg(target_os = "linux")]
            command.arg("--ozone-platform=x11");
            command.arg(entry);
            self.window = Some(Window::launch(command)?);
        }
        let window = self.window.as_mut().expect("Whiteboard window");
        if warm { return Ok(()); }
        if window.deadline.is_some() { return window.send(json!({"type": "focus"})); }
        window.send(json!({"type": "initial", "practice": practice, "paper": &board.saved.paper}))?;
        window.deadline = Some(Instant::now() + Duration::from_secs(12));
        window.practice = practice;
        board.edit(Edit::Open, None, 0)?;
        Ok(())
    }

    pub fn visible(&self) -> Option<(&str, [f32; 4])> {
        let window = self.window.as_ref()?;
        Some((&window.id, window.frame?))
    }

    pub fn practice_window(&self) -> bool {
        self.window.as_ref().is_some_and(|window| window.practice)
    }

    pub fn has_ink(&self) -> bool {
        self.board.as_ref().is_some_and(|board| !board.saved.paper.strokes.is_empty())
    }

    pub fn close(&mut self) {
        self.window.take();
        if let Some(board) = &mut self.board
            && let Err(error) = board.edit(Edit::Close, None, 0)
        {
            crate::capture::engine::runtime::apparent_log(format!("Whiteboard close: {error:#}"));
        }
    }

    pub fn tick(&mut self, cx: &mut App, t: u64) -> bool {
        match self.drain(cx, t) {
            Ok(changed) => changed,
            Err(error) => {
                self.close();
                crate::capture::engine::runtime::apparent_log(format!("Whiteboard unavailable: {error:#}"));
                true
            }
        }
    }

    fn drain(&mut self, cx: &mut App, t: u64) -> Result<bool> {
        let (Some(window), Some(board)) = (&mut self.window, &mut self.board) else { return Ok(false) };
        let mut changed = false;
        for _ in 0..512 {
            match window.event()? {
                Some(Event::Ready { frame }) if window.frame.is_none() && frame.iter().all(|n| n.is_finite()) && frame[2] > 0.0 && frame[3] > 0.0 => {
                    window.frame = Some(frame);
                    #[cfg(target_os = "linux")]
                    super::linux::float_whiteboard(window.pid, cx);
                }
                Some(Event::Edit { sequence, operation, point }) if window.frame.is_some() => {
                    changed |= board.edit(operation, point, t)?
                        && matches!(operation, Edit::End | Edit::Undo | Edit::Clear | Edit::Close);
                    match operation {
                        Edit::Begin | Edit::Move => {}
                        Edit::Close => {
                            self.window.take();
                            return Ok(changed);
                        }
                        _ => window.send(json!({"type": "paper", "sequence": sequence, "paper": board.saved.paper}))?,
                    }
                }
                Some(_) => anyhow::bail!("Invalid Whiteboard event"),
                None => break,
            }
        }
        Ok(changed)
    }

    pub fn finish(&mut self, cx: &mut App, t: u64) -> SavedBoard {
        self.tick(cx, t);
        self.close();
        self.board.take().map_or_else(SavedBoard::default, |board| board.saved)
    }
}

pub(in crate::capture::desktop) fn tick(
    coordinator: &mut ApparentCoordinator,
    cx: &mut gpui::Context<ApparentCoordinator>,
) {
    let t = coordinator.active_recording.as_ref().map_or(0, |recording| recording.elapsed_ms());
    if coordinator.is_recording() && coordinator.onboarding.as_ref().is_some_and(|session| session.local_practice()) {
        let _ = coordinator.whiteboard.borrow_mut().open(true, true);
    }
    if coordinator.whiteboard.borrow_mut().tick(cx, t) && coordinator.is_recording() {
        let generation = coordinator.capture_generation;
        cx.spawn(async move |coord, cx| {
            cx.background_executor().timer(Duration::from_millis(120)).await;
            let _ = coord.update(cx, |coord, _| {
                if coord.capture_generation == generation {
                    coord.request_immediate_frame();
                }
            });
        }).detach();
    }
}

pub(in crate::capture::desktop) fn open(coord: &Entity<ApparentCoordinator>, cx: &mut App) {
    coord.update(cx, |coord, _| {
        if !coord.is_recording() {
            return;
        }
        let practice = coord.onboarding.as_ref().is_some_and(|session| session.practice_active());
        if let Err(error) = coord.whiteboard.borrow_mut().open(practice, false).context("Open recording Whiteboard") {
            crate::capture::engine::runtime::apparent_log(format!("{error:#}"));
        }
    });
}

/// A paper export is optional. Never turn a finished screen recording into a failed capture.
pub(in crate::capture::desktop) fn finish_handoff(
    dir: &std::path::Path,
    bundle: ApparentBundle,
    summary: String,
    board: &SavedBoard,
) -> (ApparentBundle, String) {
    finish_handoff_with(dir, bundle, summary, board, |_| Ok(()))
}

pub(in crate::capture::desktop) fn finish_handoff_with(
    dir: &std::path::Path,
    mut bundle: ApparentBundle,
    summary: String,
    board: &SavedBoard,
    before_publish: impl FnMut(usize) -> anyhow::Result<()>,
) -> (ApparentBundle, String) {
    if let Err(error) = append_to_bundle_with(dir, &mut bundle, board, before_publish) {
        crate::capture::engine::runtime::apparent_log(format!(
            "Whiteboard handoff skipped: {error:#}"
        ));
        return (bundle, summary);
    }
    let summary = sketch::summary_markdown(&bundle, dir);
    (bundle, summary)
}

fn append_to_bundle_with(
    dir: &std::path::Path,
    bundle: &mut ApparentBundle,
    board: &SavedBoard,
    before_publish: impl FnMut(usize) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    use crate::shared::model::{Keyframe, KeyframeCrop, KeyframeReason};
    use std::io::BufReader;


    let final_paper = (!board.paper.strokes.is_empty()).then_some(Revision {
        t: bundle.duration_ms,
        edit: "final state",
        paper: board.paper.clone(),
    });
    if board.revisions.is_empty() && final_paper.is_none() {
        return Ok(());
    }
    let root = publication::Directory::open(
        dir, false,
    )?;
    let read = |key: &Keyframe, path: &str| -> Result<_> {
        Ok((key.clone(), render::decode_png(BufReader::new(root.file(path)?))?))
    };
    let mut frames = bundle.keyframes.iter().map(|key| read(key, &key.file)).collect::<Result<Vec<_>>>()?;
    let full_path = |folder: &str, key: &Keyframe| -> String {
        let name = std::path::Path::new(&key.file).file_name().unwrap_or_default();
        format!("{folder}/{}", name.to_string_lossy())
    };
    let mut full = bundle.autocrop.as_ref().map(|crop| {
        bundle.keyframes.iter().map(|key| read(key, &full_path(&crop.full_frames, key))).collect::<Result<Vec<_>>>()
    }).transpose()?;
    let mut next = bundle.clone();
    let mut writes = Vec::new();
    let keep_final = final_paper.is_some();
    let first_index = bundle.keyframes.iter().map(|frame| frame.index).max().unwrap_or(0) + 1;
    for (offset, revision) in board.revisions.iter().chain(final_paper.iter()).enumerate() {
        let index = first_index + offset;
        let count = revision.paper.strokes.len();
        let t = revision.t.min(bundle.duration_ms);
        let key = Keyframe {
            index,
            t,
            display_time: crate::composition::frame_labels::appended(&next.keyframes, t),
            reason: KeyframeReason::Whiteboard,
            file: format!("frames/frame-{index:02}.png"),
            event: format!("whiteboard drawing ({count} stroke{}; {})", if count == 1 { "" } else { "s" }, revision.edit),
            said: None,
            mark_id: None,
            cursor: None,
        };
        let position = next.keyframes.partition_point(|frame| frame.t <= t);
        let mut paper = render_paper(&revision.paper.strokes, t, revision.paper.color);
        frames.insert(position, (key.clone(), paper.clone()));
        render::stamp_keyframe_badge_in_place(&mut paper, &key);
        let png = crate::capture::engine::render::encode_png(&paper)?;
        writes.push((key.file.clone(), png.clone()));
        if let (Some(crop), Some(full)) = (&mut next.autocrop, &mut full) {
            writes.push((full_path(&crop.full_frames, &key), png));
            full.insert(position, (key.clone(), paper));
            crop.crops.insert(position, KeyframeCrop {
                index,
                x: 0.0,
                y: 0.0,
                width: bundle.target.frame.width,
                height: bundle.target.frame.height,
                kind: crate::capture::engine::autocrop::autocrop::CropKind::Full,
                reason: "whiteboard paper (not a screen crop)".into(),
                apps: Vec::new(),
            });
            if !crop.changes.is_empty() {
                crop.changes.insert(position, Vec::new());
            }
        }
        next.keyframes.insert(position, key);
    }
    let sheet = |frames| contact_sheet(bundle.duration_ms, frames, keep_final);
    writes.push((bundle.contact_sheet.clone(), sheet(frames)?));
    if let (Some(crop), Some(full)) = (&next.autocrop, full) {
        writes.push((crop.full_contact_sheet.clone(), sheet(full)?));
    }
    writes.push(("apparent.json".into(), serde_json::to_vec_pretty(&next)?));
    writes.push((
        "summary.md".into(),
        sketch::summary_markdown(&next, dir).into_bytes(),
    ));
    publish_artifacts(dir, &writes, before_publish)?;
    *bundle = next;
    Ok(())
}

/// Stage replacements and independent backups before replacing anything. Rollback
/// renames allocate no payload bytes; a staging failure leaves originals intact.
fn publish_artifacts(
    dir: &std::path::Path,
    writes: &[(String, Vec<u8>)],
    mut before_publish: impl FnMut(usize) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    use anyhow::Context;

    let root = publication::Directory::open(
        dir, false,
    )?;
    let stage_name = format!(".whiteboard-{}", crate::shared::ids::make_bundle_id());
    let stage = root.child(&stage_name, true)?;
    let mut rollback_failed = false;
    let mut originals = vec![false; writes.len()];
    let result = (|| -> anyhow::Result<()> {
        for (index, (path, bytes)) in writes.iter().enumerate() {
            stage.write(&format!("new-{index}"), bytes)?;
            match root.file(path) {
                Ok(_) => {
                    root.copy_to(path, &stage, &format!("old-{index}"))
                        .with_context(|| format!("backing up {path}"))?;
                    originals[index] = true;
                }
                Err(error)
                    if error
                        .downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
                Err(error) => return Err(error),
            }
        }
        let mut published = 0;
        for (index, (path, _)) in writes.iter().enumerate() {
            if let Err(error) = before_publish(index)
                .and_then(|()| stage.rename_to(&format!("new-{index}"), &root, path))
            {
                for (prior, (path, _)) in writes[..published].iter().enumerate().rev() {
                    let backup = format!("old-{prior}");
                    let restored = if originals[prior] {
                        stage.rename_to(&backup, &root, path)
                    } else {
                        root.remove_path(path)
                    };
                    if let Err(restore_error) = restored {
                        rollback_failed = true;
                        crate::capture::engine::runtime::apparent_log(format!(
                            "Whiteboard rollback failed for {path}: {restore_error}"
                        ));
                    }
                }
                return Err(error).context("publishing whiteboard handoff");
            }
            published += 1;
        }
        Ok(())
    })();
    if rollback_failed {
        crate::capture::engine::runtime::apparent_log(format!(
            "Whiteboard backups left at {} for recovery",
            dir.join(&stage_name).display()
        ));
    } else {
        before_publish(writes.len()).context("Whiteboard stage cleanup failed")?;
        for leaf in stage.names()? {
            stage
                .remove(&leaf)
                .context("Whiteboard stage cleanup failed")?;
        }
        root.remove_directory(&stage_name)
            .context("Whiteboard stage cleanup failed")?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::model::KeyframeReason;

    fn demo() -> (std::path::PathBuf, ApparentBundle, String) {
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        crate::capture::desktop::demo::generate_demo_bundle(Some(root.join("demo.apparent"))).unwrap()
    }

    #[test]
    fn finished_whiteboard_is_a_legible_handoff_frame_and_text() {
        let (dir, mut bundle, _) = demo();
        let sheet_before = std::fs::read(dir.join("contact-sheet.png")).unwrap();
        let full_dir = dir.join("frames-full");
        std::fs::create_dir(&full_dir).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&full_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        for frame in &bundle.keyframes {
            std::fs::copy(
                &dir.join(&frame.file),
                full_dir.join(std::path::Path::new(&frame.file).file_name().unwrap()),
            )
            .unwrap();
        }
        std::fs::copy(
            dir.join("contact-sheet.png"),
            dir.join("contact-sheet-full.png"),
        )
        .unwrap();
        bundle.autocrop = Some(crate::shared::model::AutocropInfo {
            label: "the activity".into(),
            full_frames: "frames-full".into(),
            full_contact_sheet: "contact-sheet-full.png".into(),
            crops: bundle
                .keyframes
                .iter()
                .map(|frame| crate::shared::model::KeyframeCrop {
                    index: frame.index,
                    x: 0.0,
                    y: 0.0,
                    width: bundle.target.frame.width,
                    height: bundle.target.frame.height,
                    kind: crate::capture::engine::autocrop::autocrop::CropKind::Full,
                    reason: "test".into(),
                    apps: vec![],
                })
                .collect(),
            changes: vec![vec![]; bundle.keyframes.len()],
        });
        let mut state = PaperState::open([20, 90, 210]).unwrap();
        state.edit(Edit::Open, None, 0).unwrap();
        for point in [[40.0, 40.0], [420.0, 310.0]] {
            state.edit(Edit::Begin, Some(point), 100).unwrap();
            state.edit(Edit::End, None, 150).unwrap();
        }
        state.edit(Edit::Undo, None, 300).unwrap();
        state.edit(Edit::Clear, None, 600).unwrap();
        assert!(!state.edit(Edit::Clear, None, 650).unwrap());
        state.edit(Edit::Begin, Some([200.0, 200.0]), 700).unwrap();
        state.edit(Edit::End, None, 750).unwrap();
        append_to_bundle_with(&dir, &mut bundle, &state.saved, |_| Ok(())).unwrap();
        assert!(bundle.keyframes.is_sorted_by_key(|key| key.t));
        let history: Vec<_> = bundle.keyframes.iter().filter(|key| key.reason == KeyframeReason::Whiteboard).collect();
        assert_eq!(history.iter().map(|key| key.t).collect::<Vec<_>>(), [300, 600, bundle.duration_ms]);
        assert!(history[0].event.contains("2 strokes; before Undo"));
        assert!(history[1].event.contains("1 stroke; before Clear"));
        for compact in [false, true] {
            let text = sketch::summary_markdown_with(&bundle, &dir, compact);
            assert!(history.iter().all(|key| text.contains(&key.event)));
        }
        let crop = bundle.autocrop.as_ref().unwrap();
        assert!(crop.crops.iter().zip(&bundle.keyframes).all(|(crop, key)| crop.index == key.index));
        assert_eq!(crop.changes.len(), bundle.keyframes.len());
        let frame = bundle.keyframes.last().unwrap();
        assert_eq!(frame.reason, KeyframeReason::Whiteboard);
        assert!(dir.join(&frame.file).is_file());
        let image = render::decode_png(std::io::BufReader::new(
            std::fs::File::open(dir.join(&frame.file)).unwrap(),
        ))
        .unwrap();
        assert!(image.rgba.chunks_exact(4).any(|p| p[..3] == [20, 90, 210]));
        assert_ne!(
            std::fs::read(dir.join("contact-sheet.png")).unwrap(),
            sheet_before
        );
        assert_eq!(
            bundle.autocrop.as_ref().unwrap().crops.len(),
            bundle.keyframes.len()
        );
        assert!(
            full_dir
                .join(std::path::Path::new(&frame.file).file_name().unwrap())
                .exists()
        );
        assert_ne!(
            std::fs::read(dir.join("contact-sheet-full.png")).unwrap(),
            sheet_before
        );
        let saved: ApparentBundle =
            serde_json::from_slice(&std::fs::read(dir.join("apparent.json")).unwrap()).unwrap();
        assert_eq!(saved.keyframes, bundle.keyframes);
        assert_eq!(
            std::fs::read_to_string(dir.join("summary.md")).unwrap(),
            sketch::summary_markdown(&bundle, &dir)
        );
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn cleared_paper_preserves_history_without_a_final_tile() {
        let (dir, mut bundle, _) = demo();
        let before = std::fs::read(dir.join("contact-sheet.png")).unwrap();
        let keys = bundle.keyframes.len();
        let board = SavedBoard::default();
        append_to_bundle_with(&dir, &mut bundle, &board, |_| Ok(())).unwrap();
        assert_eq!(bundle.keyframes.len(), keys);
        assert_eq!(
            std::fs::read(dir.join("contact-sheet.png")).unwrap(),
            before
        );
        let mut state = PaperState::open([20, 90, 210]).unwrap();
        state.edit(Edit::Open, None, 0).unwrap();
        state.edit(Edit::Begin, Some([100.0, 100.0]), 100).unwrap();
        state.edit(Edit::Clear, None, 200).unwrap();
        append_to_bundle_with(&dir, &mut bundle, &state.saved, |_| Ok(())).unwrap();
        let history: Vec<_> = bundle.keyframes.iter().filter(|key| key.reason == KeyframeReason::Whiteboard).collect();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].t, 200);
        assert!(history[0].event.contains("1 stroke; before Clear"));
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn failed_paper_publish_keeps_the_original_capture_and_clipboard_text() {
        let (dir, bundle, summary) = demo();
        let manifest = std::fs::read(dir.join("apparent.json")).unwrap();
        let sheet = std::fs::read(dir.join("contact-sheet.png")).unwrap();
        let text = std::fs::read(dir.join("summary.md")).unwrap();
        let next_frame = dir.join(format!(
            "frames/frame-{:02}.png",
            bundle.keyframes.len() + 1
        ));
        let board = SavedBoard::from(Paper { color: [26, 26, 26], strokes: vec![vec![[40.0, 40.0], [420.0, 310.0]].into()] });

        // Fail after the sheet, then again after the manifest, and restore all originals.
        for fail_at in [2, 3] {
            let (returned, returned_summary) =
                finish_handoff_with(&dir, bundle.clone(), summary.clone(), &board, |index| {
                    if index == fail_at {
                        anyhow::bail!("injected paper publish failure")
                    }
                    Ok(())
                });
            assert_eq!(returned.keyframes, bundle.keyframes);
            assert_eq!(returned_summary, summary);
            assert_eq!(std::fs::read(dir.join("apparent.json")).unwrap(), manifest);
            assert_eq!(std::fs::read(dir.join("contact-sheet.png")).unwrap(), sheet);
            assert_eq!(std::fs::read(dir.join("summary.md")).unwrap(), text);
            assert!(!next_frame.exists());
            assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".whiteboard-")
            }));
        }
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }
    #[test]
    fn cleanup_failure_retains_stage_and_blocks_fallback_publication() {
        let (dir, bundle, summary) = demo();
        let board = SavedBoard::from(Paper { color: [26, 26, 26], strokes: vec![vec![[40.0, 40.0], [420.0, 310.0]].into()] });
        let result = publication::publish_after(&dir, || {
            let (fallback, text) =
                finish_handoff_with(&dir, bundle.clone(), summary.clone(), &board, |index| {
                    if index == 4 {
                        anyhow::bail!("injected stage cleanup failure")
                    }
                    Ok(())
                });
            assert_eq!(fallback.keyframes, bundle.keyframes);
            assert_eq!(text, summary);
            Ok((dir.clone(), fallback, text))
        });
        assert!(result.is_err());
        assert!(dir.join(publication::IN_PROGRESS).exists());
        assert!(std::fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".whiteboard-")
        }));
        assert!(publication::checked(&dir, &bundle, &summary).is_err());
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }
}
