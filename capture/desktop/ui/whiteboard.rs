use anyhow::{Context as _, Result, ensure};
use gpui::{App, Entity};
use serde_json::json;

use super::super::ApparentCoordinator;
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    sync::mpsc::{Receiver, SyncSender, TryRecvError, sync_channel},
    time::{Duration, Instant},
};

use serde_json::Value;


#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Event {
    Ready { frame: [f32; 4] },
    Edit { sequence: u32, operation: Edit, point: Option<[f32; 2]> },
}

pub(crate) struct Window {
    pub(crate) id: String,
    child: Option<crate::capture::ui_process::UiChild>,
    #[cfg(target_os = "linux")]
    pid: u32,
    practice: bool,
    send: SyncSender<Value>,
    events: Receiver<Event>,
    deadline: Instant,
    pub(crate) frame: Option<[f32; 4]>,
}

impl Window {
    pub(crate) fn launch(mut command: Command, id: String, practice: bool, paper: &Paper) -> Result<Self> {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .context("Launch Whiteboard")?;
        let mut input = child.stdin.take().expect("piped stdin");
        let output = child.stdout.take().expect("piped stdout");
        let (send, messages) = sync_channel::<Value>(4);
        let (deliver, events) = sync_channel(512);
        let window = Self {
            id,
            #[cfg(target_os = "linux")]
            pid: child.id(),
            child: Some(crate::capture::ui_process::UiChild::new(child)),
            practice,
            send,
            events,
            deadline: Instant::now() + Duration::from_secs(12), frame: None };
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
        window.send(json!({"type": "initial", "practice": practice, "paper": paper}))?;
        Ok(window)
    }

    pub(crate) fn send(&self, message: Value) -> Result<()> {
        self.send.try_send(message).map_err(|_| anyhow::anyhow!("Whiteboard receiver unavailable"))
    }

    pub(crate) fn event(&self) -> Result<Option<Event>> {
        match self.events.try_recv() {
            Ok(event) => Ok(Some(event)),
            Err(TryRecvError::Empty) => {
                ensure!(self.frame.is_some() || Instant::now() < self.deadline, "Whiteboard did not become ready");
                Ok(None)
            }
            Err(TryRecvError::Disconnected) => anyhow::bail!("Whiteboard disconnected"),
        }
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn pid(&self) -> u32 {
        self.pid
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

use crate::embedded_policy::EmbeddedPolicy;

pub(crate) const PAPER_WIDTH: f32 = 1600.0;
pub(crate) const PAPER_HEIGHT: f32 = 1100.0;

#[derive(Clone, Default, Serialize)]
pub(in crate::capture::desktop) struct Paper {
    pub color: [u8; 3],
    pub strokes: Vec<Vec<[f32; 2]>>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Edit {
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
    RemoveLast,
    Erase,
    Hide,
    CommitAndHide,
    CommitAndStart,
}

struct PaperState {
    pub paper: Paper,
    visible: bool,
    active: Option<Vec<[f32; 2]>>,
    policy: EmbeddedPolicy,
}

impl PaperState {
    pub(crate) fn open(color: [u8; 3]) -> Result<Self> {
        Ok(Self {
            paper: Paper { color, strokes: Vec::new() },
            visible: false,
            active: None,
            policy: EmbeddedPolicy::open(
                "record-whiteboard",
                include_str!(concat!(env!("OUT_DIR"), "/record-whiteboard.mjs")),
                &["whiteboardEdit"],
            )?,
        })
    }

    pub(crate) fn edit(&mut self, event: Edit, point: Option<[f32; 2]>) -> Result<bool> {
        let point = point.filter(|[x, y]| {
            (0.0..PAPER_WIDTH).contains(x) && (0.0..PAPER_HEIGHT).contains(y)
        });
        let output = self.policy.call("whiteboardEdit", (
            format!("{event:?}"),
            self.visible,
            self.active.is_some(),
            point.is_some(),
            self.paper.strokes.len() as u32,
            self.active.as_ref().map_or(0, |stroke| stroke.len() as u32),
        ))?;
        match serde_json::from_str(&output)? {
            Effect::Ignore => return Ok(false),
            Effect::Show => self.visible = true,
            Effect::Hide => self.visible = false,
            Effect::Start => self.active = point.map(|p| vec![p]),
            Effect::Append => {
                if let (Some(active), Some(point)) = (&mut self.active, point) {
                    active.push(point);
                }
            }
            Effect::Discard => self.active = None,
            Effect::RemoveLast => { self.paper.strokes.pop(); }
            Effect::Erase => {
                self.active = None;
                self.paper.strokes.clear();
            }
            Effect::Commit => self.commit(),
            Effect::CommitAndHide => {
                self.commit();
                self.visible = false;
            }
            Effect::CommitAndStart => {
                self.commit();
                self.active = point.map(|p| vec![p]);
            }
        }
        Ok(true)
    }

    fn commit(&mut self) {
        self.paper.strokes.extend(self.active.take());
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

    fn open(&mut self, practice: bool) -> Result<()> {
        if let Some(window) = &self.window {
            return window.send(json!({"type": "focus"}));
        }
        let resources = crate::capture::desktop::workflow::electron::resolve()?;
        let entry = resources.root.join("dist/whiteboard/main.cjs");
        ensure!(entry.is_file(), "Packaged Whiteboard unavailable");
        let mut command = std::process::Command::new(&resources.executable);
        crate::capture::desktop::workflow::electron::configure_sandbox(&mut command, &resources.executable)?;
        #[cfg(target_os = "linux")]
        command.arg("--ozone-platform=x11");
        let board = match self.board.as_mut() {
            Some(board) => board,
            None => self.board.insert(PaperState::open(self.color)?),
        };
        let id = crate::shared::ids::make_bundle_id();
        command.arg(entry);
        let window = Window::launch(
            command,
            id, practice, &board.paper,
        )?;
        board.edit(Edit::Open, None)?;
        self.window = Some(window);
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
        self.board.as_ref().is_some_and(|board| !board.paper.strokes.is_empty())
    }

    pub fn close(&mut self) {
        self.window.take();
        if let Some(board) = &mut self.board
            && let Err(error) = board.edit(Edit::Close, None)
        {
            crate::capture::engine::runtime::apparent_log(format!("Whiteboard close: {error:#}"));
        }
    }

    pub fn tick(&mut self, cx: &mut App) -> bool {
        match self.drain(cx) {
            Ok(changed) => changed,
            Err(error) => {
                self.close();
                crate::capture::engine::runtime::apparent_log(format!("Whiteboard unavailable: {error:#}"));
                true
            }
        }
    }

    fn drain(&mut self, cx: &mut App) -> Result<bool> {
        let (Some(window), Some(board)) = (&mut self.window, &mut self.board) else { return Ok(false) };
        let mut changed = false;
        for _ in 0..512 {
            match window.event()? {
                Some(Event::Ready { frame }) if window.frame.is_none() && frame.iter().all(|n| n.is_finite()) && frame[2] > 0.0 && frame[3] > 0.0 => {
                    window.frame = Some(frame);
                    #[cfg(target_os = "linux")]
                    super::linux::float_whiteboard(window.pid(), cx);
                }
                Some(Event::Edit { sequence, operation, point }) if window.frame.is_some() => {
                    changed |= board.edit(operation, point)?
                        && matches!(operation, Edit::End | Edit::Undo | Edit::Clear | Edit::Close);
                    match operation {
                        Edit::Begin | Edit::Move => {}
                        Edit::Close => {
                            self.window.take();
                            return Ok(changed);
                        }
                        _ => window.send(json!({"type": "paper", "sequence": sequence, "paper": board.paper}))?,
                    }
                }
                Some(_) => anyhow::bail!("Invalid Whiteboard event"),
                None => break,
            }
        }
        Ok(changed)
    }

    pub fn finish(&mut self, cx: &mut App) -> Paper {
        self.tick(cx);
        self.close();
        self.board.take().map_or_else(Paper::default, |board| board.paper)
    }
}

pub(in crate::capture::desktop) fn open(coord: &Entity<ApparentCoordinator>, cx: &mut App) {
    coord.update(cx, |coord, _| {
        if !coord.is_recording() {
            return;
        }
        let practice = coord.onboarding.as_ref().is_some_and(|session| session.practice_active());
        if let Err(error) = coord.whiteboard.borrow_mut().open(practice).context("Open recording Whiteboard") {
            crate::capture::engine::runtime::apparent_log(format!("{error:#}"));
        }
    });
}

/// A paper export is optional. Never turn a finished screen recording into a failed capture.
pub(in crate::capture::desktop) fn finish_handoff(
    dir: &std::path::Path,
    bundle: crate::shared::model::ApparentBundle,
    summary: String,
    board: &Paper,
) -> (crate::shared::model::ApparentBundle, String) {
    finish_handoff_with(dir, bundle, summary, board, |_| Ok(()))
}

pub(in crate::capture::desktop) fn finish_handoff_with(
    dir: &std::path::Path,
    mut bundle: crate::shared::model::ApparentBundle,
    summary: String,
    board: &Paper,
    before_publish: impl FnMut(usize) -> anyhow::Result<()>,
) -> (crate::shared::model::ApparentBundle, String) {
    if let Err(error) = append_to_bundle_with(dir, &mut bundle, board, before_publish) {
        crate::capture::engine::runtime::apparent_log(format!(
            "Whiteboard handoff skipped: {error:#}"
        ));
        return (bundle, summary);
    }
    let summary = crate::capture::engine::sketch::summary_markdown(&bundle, dir);
    (bundle, summary)
}

/// Keep the whole finished sketch legible even if the window was closed or resized at stop.
fn append_to_bundle_with(
    dir: &std::path::Path,
    bundle: &mut crate::shared::model::ApparentBundle,
    board: &Paper,
    before_publish: impl FnMut(usize) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    use crate::shared::model::{Keyframe, KeyframeCrop, KeyframeReason};
    use std::io::BufReader;

    if board.strokes.is_empty() {
        return Ok(());
    }
    let root = crate::capture::engine::bundle::bundle_processing::publication::Directory::open(
        dir, false,
    )?;
    let read = |path: &str| -> anyhow::Result<crate::shared::model::RgbaFrame> {
        crate::capture::engine::render::decode_png(BufReader::new(root.file(path)?))
    };
    let mut frames: Vec<_> = bundle
        .keyframes
        .iter()
        .map(|key| Ok((key.clone(), read(&key.file)?)))
        .collect::<anyhow::Result<_>>()?;
    let index = frames.len() + 1;
    let count = board.strokes.len();
    let event = format!(
        "whiteboard drawing ({count} stroke{}; final state)",
        if count == 1 { "" } else { "s" }
    );
    let key = Keyframe {
        index,
        t: bundle.duration_ms,
        display_time: crate::composition::frame_labels::appended(&bundle.keyframes, bundle.duration_ms),
        reason: KeyframeReason::Whiteboard,
        file: format!("frames/frame-{index:02}.png"),
        event,
        said: None,
        mark_id: None,
        cursor: None,
    };
    let paper = render_paper(&board.strokes, bundle.duration_ms, board.color);
    frames.push((key.clone(), paper.clone()));
    let sheet = crate::capture::engine::render::render_contact_sheet_for_duration(
        bundle.duration_ms,
        &frames,
    );
    let mut stamped = vec![(key.clone(), paper)];
    crate::capture::engine::render::stamp_keyframe_badges(&mut stamped);
    let png = crate::capture::engine::render::encode_png(&stamped[0].1)?;
    let full_sheet = if let Some(crop) = &bundle.autocrop {
        let mut full: Vec<_> = bundle
            .keyframes
            .iter()
            .map(|key| {
                let name = std::path::Path::new(&key.file).file_name().unwrap();
                let path = format!("{}/{}", crop.full_frames, name.to_string_lossy());
                Ok((key.clone(), read(&path)?))
            })
            .collect::<anyhow::Result<_>>()?;
        full.push((key.clone(), stamped[0].1.clone()));
        Some(
            crate::capture::engine::render::render_contact_sheet_for_duration(
                bundle.duration_ms,
                &full,
            ),
        )
    } else {
        None
    };

    let mut next = bundle.clone();
    let mut writes = vec![
        (key.file.clone(), png.clone()),
        (
            bundle.contact_sheet.clone(),
            crate::capture::engine::render::encode_png(&sheet)?,
        ),
    ];
    if let (Some(crop), Some(full)) = (&mut next.autocrop, full_sheet) {
        let name = std::path::Path::new(&key.file).file_name().unwrap();
        writes.push((
            format!("{}/{}", crop.full_frames, name.to_string_lossy()),
            png,
        ));
        writes.push((
            crop.full_contact_sheet.clone(),
            crate::capture::engine::render::encode_png(&full)?,
        ));
        crop.crops.push(KeyframeCrop {
            index,
            x: 0.0,
            y: 0.0,
            width: bundle.target.frame.width,
            height: bundle.target.frame.height,
            kind: crate::capture::engine::autocrop::autocrop::CropKind::Full,
            reason: "whiteboard paper (not a screen crop)".into(),
            apps: Vec::new(),
        });
        crop.changes.push(Vec::new());
    }
    next.keyframes.push(key);
    writes.push(("apparent.json".into(), serde_json::to_vec_pretty(&next)?));
    writes.push((
        "summary.md".into(),
        crate::capture::engine::sketch::summary_markdown(&next, dir).into_bytes(),
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

    let root = crate::capture::engine::bundle::bundle_processing::publication::Directory::open(
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

fn render_paper(strokes: &[Vec<[f32; 2]>], t_ms: u64, color:[u8;3]) -> crate::shared::model::RgbaFrame {
    use crate::shared::model::RgbaFrame;

    let (mut x0, mut y0, mut x1, mut y1) = (PAPER_WIDTH, PAPER_HEIGHT, 0.0f32, 0.0f32);
    for point in strokes.iter().flatten() {
        x0 = x0.min(point[0]);
        y0 = y0.min(point[1]);
        x1 = x1.max(point[0]);
        y1 = y1.max(point[1]);
    }
    let width = (x1 - x0 + 100.0).max(400.0).min(PAPER_WIDTH);
    let height = (y1 - y0 + 100.0).max(300.0).min(PAPER_HEIGHT);
    let left = ((x0 + x1 - width) / 2.0).clamp(0.0, PAPER_WIDTH - width);
    let top = ((y0 + y1 - height) / 2.0).clamp(0.0, PAPER_HEIGHT - height);
    let (w, h) = (width.ceil() as u32, height.ceil() as u32);
    let mut image = RgbaFrame::new(t_ms, w, h, vec![255; w as usize * h as usize * 4]);
    let dot = |image: &mut RgbaFrame, x: f32, y: f32| {
        let (x, y) = (x.round() as i32, y.round() as i32);
        for dy in -2..=2 {
            for dx in -2..=2 {
                if dx * dx + dy * dy > 5 {
                    continue;
                }
                let (px, py) = (x + dx, y + dy);
                if px >= 0 && py >= 0 && px < image.width as i32 && py < image.height as i32 {
                    let at = (py as usize * image.width as usize + px as usize) * 4;
                    image.rgba[at..at + 3].copy_from_slice(&color);
                }
            }
        }
    };
    for stroke in strokes {
        for point in stroke {
            dot(&mut image, point[0] - left, point[1] - top);
        }
        for pair in stroke.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let steps = ((b[0] - a[0]).hypot(b[1] - a[1]) * 2.0).ceil() as usize;
            for i in 0..=steps.max(1) {
                let f = i as f32 / steps.max(1) as f32;
                dot(
                    &mut image,
                    a[0] + (b[0] - a[0]) * f - left,
                    a[1] + (b[1] - a[1]) * f - top,
                );
            }
        }
    }
    image
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepted_paper_survives_close_reopen_and_rejects_invalid_input() {
        let mut board = PaperState::open([26, 26, 26]).unwrap();
        assert!(!board.edit(Edit::Begin, Some([10.0, 20.0])).unwrap());
        board.edit(Edit::Open, None).unwrap();
        assert!(!board.edit(Edit::Begin, Some([f32::NAN, 20.0])).unwrap());
        board.edit(Edit::Begin, Some([10.0, 20.0])).unwrap();
        board.edit(Edit::Move, Some([30.0, 40.0])).unwrap();
        board.edit(Edit::End, None).unwrap();
        board.edit(Edit::Begin, Some([90.0, 100.0])).unwrap();
        board.edit(Edit::End, None).unwrap();
        board.edit(Edit::Undo, None).unwrap();
        board.edit(Edit::Begin, Some([105.0, 100.0])).unwrap();
        board.edit(Edit::Undo, None).unwrap();
        board.edit(Edit::Close, None).unwrap();
        assert!(!board.edit(Edit::Clear, None).unwrap());
        board.edit(Edit::Open, None).unwrap();
        assert_eq!(board.paper.strokes, vec![vec![[10.0, 20.0], [30.0, 40.0]]]);
        board.edit(Edit::Begin, Some([85.0, 20.0])).unwrap();
        board.edit(Edit::Close, None).unwrap();
        assert_eq!(board.paper.strokes.len(), 2);
        board.edit(Edit::Open, None).unwrap();
        board.edit(Edit::Clear, None).unwrap();
        assert!(board.paper.strokes.is_empty());
    }
    use crate::shared::model::KeyframeReason;

    #[test]
    #[test]
    fn finished_whiteboard_is_a_legible_handoff_frame_and_text() {
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let (dir, mut bundle, _) =
            crate::capture::desktop::demo::generate_demo_bundle(Some(root.join("demo.apparent")))
                .unwrap();
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
        let board = Paper { color: [26, 26, 26], strokes: vec![vec![[40.0, 40.0], [420.0, 310.0]]] };
        append_to_bundle_with(&dir, &mut bundle, &board, |_| Ok(())).unwrap();
        let frame = bundle.keyframes.last().unwrap();
        assert_eq!(frame.reason, KeyframeReason::Whiteboard);
        assert!(
            crate::capture::engine::sketch::summary_markdown_with(&bundle, &dir, false)
                .contains("whiteboard drawing (1 stroke; final state)")
        );
        assert!(
            crate::capture::engine::sketch::summary_markdown_with(&bundle, &dir, true)
                .contains("whiteboard drawing (1 stroke; final state)")
        );
        assert!(dir.join(&frame.file).is_file());
        let image = crate::capture::engine::render::decode_png(std::io::BufReader::new(
            std::fs::File::open(dir.join(&frame.file)).unwrap(),
        ))
        .unwrap();
        assert!(image.rgba.chunks_exact(4).any(|p| p[0] < 100 && p[1] < 100));
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
        let saved: crate::shared::model::ApparentBundle =
            serde_json::from_slice(&std::fs::read(dir.join("apparent.json")).unwrap()).unwrap();
        assert_eq!(saved.keyframes, bundle.keyframes);
        assert_eq!(
            std::fs::read_to_string(dir.join("summary.md")).unwrap(),
            crate::capture::engine::sketch::summary_markdown(&bundle, &dir)
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn empty_or_cleared_paper_does_not_add_a_handoff_tile() {
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let (dir, mut bundle, _) =
            crate::capture::desktop::demo::generate_demo_bundle(Some(root.join("demo.apparent")))
                .unwrap();
        let before = std::fs::read(dir.join("contact-sheet.png")).unwrap();
        let keys = bundle.keyframes.len();
        let board = Paper::default();
        append_to_bundle_with(&dir, &mut bundle, &board, |_| Ok(())).unwrap();
        assert_eq!(bundle.keyframes.len(), keys);
        assert_eq!(
            std::fs::read(dir.join("contact-sheet.png")).unwrap(),
            before
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_paper_publish_keeps_the_original_capture_and_clipboard_text() {
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let (dir, bundle, summary) =
            crate::capture::desktop::demo::generate_demo_bundle(Some(root.join("demo.apparent")))
                .unwrap();
        let manifest = std::fs::read(dir.join("apparent.json")).unwrap();
        let sheet = std::fs::read(dir.join("contact-sheet.png")).unwrap();
        let text = std::fs::read(dir.join("summary.md")).unwrap();
        let next_frame = dir.join(format!(
            "frames/frame-{:02}.png",
            bundle.keyframes.len() + 1
        ));
        let board = Paper { color: [26, 26, 26], strokes: vec![vec![[40.0, 40.0], [420.0, 310.0]]] };

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
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cleanup_failure_retains_stage_and_blocks_fallback_publication() {
        use crate::capture::engine::bundle::bundle_processing::publication;
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let (dir, bundle, summary) =
            crate::capture::desktop::demo::generate_demo_bundle(Some(root.join("demo.apparent")))
                .unwrap();
        let board = Paper { color: [26, 26, 26], strokes: vec![vec![[40.0, 40.0], [420.0, 310.0]]] };
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
        std::fs::remove_dir_all(root).unwrap();
    }
}
