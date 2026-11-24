use super::*;

#[test]
fn propagated_workers_keep_parents_and_real_overlap() {
    let (_, collected) = collect(true, || {
        let _build = span(Operation::BundleBuild);
        std::thread::scope(|scope| {
            let (started, wait) = std::sync::mpsc::channel();
            let (finish, finished) = std::sync::mpsc::channel();
            let worker = scope.spawn(propagate(move || {
                let _transcribe = span(Operation::Transcribe);
                started.send(()).unwrap();
                finished.recv().unwrap();
            }));
            wait.recv().unwrap();
            {
                let _visuals = span(Operation::PrepareVisuals);
                let _decode = span(Operation::DecodeFrames);
            }
            finish.send(()).unwrap();
            worker.join().unwrap();
        });
    });
    let get = |name| {
        collected
            .spans
            .iter()
            .find(|s| s.operation.name() == name)
            .unwrap()
    };
    let build = get("recording.bundle.build");
    let speech = get("recording.transcribe");
    let visuals = get("recording.visuals.prepare");
    let decode = get("recording.frames.decode");
    assert_eq!(build.parent, 2);
    assert_eq!(speech.parent, build.id);
    assert_eq!(visuals.parent, build.id);
    assert_eq!(decode.parent, visuals.id);
    assert!(speech.start <= visuals.start && speech.end >= visuals.end);
    for child in [speech, visuals, decode] {
        assert!(build.start <= child.start && child.end <= build.end);
    }
}

#[test]
fn disabled_collection_and_unpropagated_threads_do_not_leak() {
    let (_, outer) = collect(true, || {
        let _outer = span(Operation::BundleBuild);
        let (_, disabled) = collect(false, || {
            let _disabled = span(Operation::Transcribe);
        });
        assert!(disabled.spans.is_empty());
        std::thread::spawn(|| {
            let _unrelated = span(Operation::DecodeFrames);
        })
        .join()
        .unwrap();
    });
    assert_eq!(outer.spans.len(), 1);
    let (_, next) = collect(true, || {
        let _next = span(Operation::NotesWait);
    });
    assert_eq!(next.spans.len(), 1);
    assert_eq!(next.spans[0].parent, 2);
    assert!(CURRENT.with(|current| current.borrow().is_none()));
}

#[test]
fn errors_unwind_spans_and_capacity_is_bounded() {
    let (result, collected) = collect(true, || -> Result<(), ()> {
        let _build = span(Operation::BundleBuild);
        for _ in 0..LIMIT + 10 {
            let _decode = span(Operation::DecodeFrames);
        }
        Err(())
    });
    assert!(result.is_err());
    assert_eq!(collected.spans.len(), LIMIT);
    assert_eq!(collected.dropped, 11);
    let root = collected.spans.iter().find(|s| s.parent == 2).unwrap();
    assert!(
        collected
            .spans
            .iter()
            .all(|s| s.start <= s.end && s.end <= root.end)
    );
    assert!(CURRENT.with(|current| current.borrow().is_none()));
}
