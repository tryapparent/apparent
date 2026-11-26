use std::cell::RefCell;
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const LIMIT: usize = 128;

#[derive(Clone, Copy)]
pub(crate) enum Operation {
    StopTracks,
    StopScreen,
    StopAudio,
    StopWindows,
    ActionContext,
    NotesWait,
    CircleLabels,
    BundleBuild,
    Transcribe,
    PrepareSpeechAudio,
    LoadSpeechModel,
    OpenSpeechSession,
    RecognizeSpeech,
    HostedTranscribe,
    TranscriptionFallback,
    PrepareVisuals,
    SelectFrames,
    DecodeFrames,
    AnnotateCrop,
    RenderSheet,
    WriteArtifacts,
    Whiteboard,
    PublicationLock,
    PublicationValidate,
    PublicationSync,
}

impl Operation {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::StopTracks => "recording.stop_tracks",
            Self::StopScreen => "recording.screen.stop",
            Self::StopAudio => "recording.audio.stop",
            Self::StopWindows => "recording.windows.stop",
            Self::ActionContext => "recording.action_context.finish",
            Self::NotesWait => "recording.notes.wait",
            Self::CircleLabels => "recording.circle_labels.apply",
            Self::BundleBuild => "recording.bundle.build",
            Self::Transcribe => "recording.transcribe",
            Self::PrepareSpeechAudio => "recording.speech.prepare_audio",
            Self::LoadSpeechModel => "recording.speech.load_model",
            Self::OpenSpeechSession => "recording.speech.open_session",
            Self::RecognizeSpeech => "recording.speech.recognize_and_assemble",
            Self::HostedTranscribe => "recording.transcribe.openrouter",
            Self::TranscriptionFallback => "recording.transcribe.fallback",
            Self::PrepareVisuals => "recording.visuals.prepare",
            Self::SelectFrames => "recording.keyframes.select",
            Self::DecodeFrames => "recording.frames.decode",
            Self::AnnotateCrop => "recording.frames.annotate_and_crop",
            Self::RenderSheet => "recording.contact_sheet.render",
            Self::WriteArtifacts => "recording.artifacts.write",
            Self::Whiteboard => "recording.whiteboard.finish_handoff",
            Self::PublicationLock => "recording.publication.coordinate",
            Self::PublicationValidate => "recording.publication.validate",
            Self::PublicationSync => "recording.publication.sync",
        }
    }
}

pub(crate) struct Span {
    pub id: usize,
    pub parent: usize,
    pub operation: Operation,
    pub start: u128,
    pub end: u128,
}

#[derive(Default)]
pub(crate) struct Collected {
    pub spans: Vec<Span>,
    pub dropped: usize,
}

struct Recording {
    instant: Instant,
    epoch: u128,
    next: usize,
    collected: Collected,
}

#[derive(Clone)]
struct Context {
    recording: Arc<Mutex<Recording>>,
    parent: usize,
}

thread_local! {
    static CURRENT: RefCell<Option<Context>> = const { RefCell::new(None) };
}

struct Enter(Option<Context>);

impl Enter {
    fn new(context: Option<Context>) -> Self {
        Self(CURRENT.with(|current| current.replace(context)))
    }
}

impl Drop for Enter {
    fn drop(&mut self) {
        CURRENT.with(|current| current.replace(self.0.take()));
    }
}

pub(crate) struct Guard {
    active: Option<(Context, usize, Operation, u128)>,
    _thread: PhantomData<Rc<()>>,
}

pub(crate) fn span(operation: Operation) -> Guard {
    let context = CURRENT.with(|current| current.borrow().clone());
    let active = context.and_then(|context| {
        let mut recording = context.recording.lock().unwrap_or_else(|e| e.into_inner());
        if recording.next >= LIMIT + 3 {
            recording.collected.dropped += 1;
            return None;
        }
        let id = recording.next;
        recording.next += 1;
        let start = recording.epoch + recording.instant.elapsed().as_nanos();
        drop(recording);
        CURRENT.with(|current| current.borrow_mut().as_mut().unwrap().parent = id);
        Some((context, id, operation, start))
    });
    Guard {
        active,
        _thread: PhantomData,
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        if let Some((context, id, operation, start)) = self.active.take() {
            let mut recording = context.recording.lock().unwrap_or_else(|e| e.into_inner());
            let end = recording.epoch + recording.instant.elapsed().as_nanos();
            recording.collected.spans.push(Span {
                id,
                parent: context.parent,
                operation,
                start,
                end,
            });
            drop(recording);
            CURRENT.with(|current| current.replace(Some(context)));
        }
    }
}

pub(crate) fn propagate<F, T>(work: F) -> impl FnOnce() -> T + Send
where
    F: FnOnce() -> T + Send,
{
    let context = CURRENT.with(|current| current.borrow().clone());
    move || {
        let _entered = Enter::new(context);
        work()
    }
}

fn epoch_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

pub(crate) fn collect<T>(enabled: bool, work: impl FnOnce() -> T) -> (T, Collected) {
    collect_on(enabled.then(|| (Instant::now(), epoch_ns())), work)
}

fn collect_on<T>(clock: Option<(Instant, u128)>, work: impl FnOnce() -> T) -> (T, Collected) {
    let recording = clock.map(|(instant, epoch)| {
        Arc::new(Mutex::new(Recording {
            instant,
            epoch,
            next: 3,
            collected: Collected::default(),
        }))
    });
    let _entered = Enter::new(recording.as_ref().map(|recording| Context {
        recording: recording.clone(),
        parent: 2,
    }));
    let result = work();
    let collected = recording
        .map(|recording| {
            std::mem::take(
                &mut recording
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .collected,
            )
        })
        .unwrap_or_default();
    (result, collected)
}

pub(crate) fn local_finish<T>(cutoff: Option<Instant>, work: impl FnOnce() -> T) -> T {
    let (Some(cutoff), Ok(attempt)) = (cutoff, std::env::var("APPARENT_FINISH_BENCH_SPANS")) else {
        return work();
    };
    if attempt.len() != 36
        || !attempt.bytes().enumerate().all(|(i, byte)| match i {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
        || CURRENT.with(|current| current.borrow().is_some())
    {
        return work();
    }
    let origin = epoch_ns().saturating_sub(cutoff.elapsed().as_nanos());
    let (result, collected) = collect_on(Some((cutoff, origin)), work);
    let elapsed = cutoff.elapsed().as_secs_f64() * 1000.0;
    let relative = |value: u128| value.saturating_sub(origin) as f64 / 1_000_000.0;
    let spans: Vec<_> = collected.spans.into_iter().map(|span| {
        serde_json::json!({
            "id": span.id,
            "parent": span.parent,
            "name": span.operation.name(),
            "startMs": relative(span.start),
            "endMs": relative(span.end),
        })
    }).collect();
    eprintln!(
        "BENCH_FINISH_SPANS {}",
        serde_json::json!({
            "attempt": attempt,
            "elapsedMs": elapsed,
            "dropped": collected.dropped,
            "spans": spans,
        })
    );
    result
}

#[cfg(test)]
#[path = "spans_tests.rs"]
mod tests;
