use super::*;
use crate::{
    bundle_processing::{SourceExtras, build_bundle_from_parts},
    model::{RgbaFrame, TargetInfo, TranscriptData},
};
use std::os::unix::fs::{PermissionsExt, symlink};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("{}.apparent", crate::make_bundle_id())))
    }
    fn build(&self) -> Built {
        let frame = RgbaFrame::new(0, 16, 16, vec![180; 16 * 16 * 4]);
        let target: TargetInfo = serde_json::from_value(serde_json::json!({
            "mode":"device","displayId":0,"frame":{"x":0.0,"y":0.0,"width":16.0,"height":16.0,"scale":1.0}
        })).unwrap();
        build_bundle_from_parts(
            &self.0,
            target,
            200,
            vec![frame],
            vec![],
            vec![],
            TranscriptData::default(),
            None,
            None,
            SourceExtras {
                autocrop: Some(None),
                ..Default::default()
            },
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn publication_coordination_blocks_other_threads_until_last_guard_in_either_drop_order() {
    use std::sync::mpsc;
    use std::time::Duration;

    for drop_first_acquired in [true, false] {
        let fixture = Fixture::new();
        let first = coordinate(&fixture.0).unwrap();
        let second = coordinate(&fixture.0).unwrap();
        let path = fixture.0.clone();
        let (started, start_rx) = mpsc::channel();
        let (acquired, acquire_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            started.send(()).unwrap();
            let _guard = coordinate(&path).unwrap();
            acquired.send(()).unwrap();
        });
        start_rx.recv_timeout(Duration::from_secs(4)).unwrap();
        let blocked_with_both = acquire_rx.recv_timeout(Duration::from_millis(100)).is_err();
        let remaining = if drop_first_acquired {
            drop(first);
            second
        } else {
            drop(second);
            first
        };
        let blocked_with_one = acquire_rx.recv_timeout(Duration::from_millis(100)).is_err();
        drop(remaining);
        // Always release and join before asserting, including on the old broken behavior.
        worker.join().unwrap();
        assert!(blocked_with_both, "worker entered with both guards alive");
        assert!(
            blocked_with_one,
            "worker entered before the final guard dropped"
        );
        // A fresh lease must also work after the owning thread's last guard is gone.
        let _fresh = coordinate(&fixture.0).unwrap();
    }
}

#[test]
fn publication_checks_real_image_audio_movie_and_exact_manifest_inputs() {
    for (movie_name, movie_bytes) in [
        (
            "recording.mp4",
            include_bytes!("../../../tests/fixtures/publication/tiny.mp4").as_slice(),
        ),
        (
            "recording.mov",
            include_bytes!("../../../tests/fixtures/publication/tiny.mov").as_slice(),
        ),
    ] {
        let fixture = Fixture::new();
        let (_, mut bundle, summary) = fixture.build();
        let root = Directory::open(&fixture.0, false).unwrap();
        root.write(
            "audio.wav",
            &crate::audio::encode_wav_16k(&[0.0; 16]).unwrap(),
        )
        .unwrap();
        root.write(movie_name, movie_bytes).unwrap();
        bundle.audio = Some("audio.wav".into());
        bundle.video = Some(movie_name.into());
        let manifest = serde_json::to_vec_pretty(&bundle).unwrap();
        root.write("apparent.json", &manifest).unwrap();
        let inputs = checked(&fixture.0, &bundle, &summary).unwrap();
        assert_eq!(inputs.manifest, manifest);
        assert_eq!(inputs.bundle_id, bundle.id);
        assert_eq!(inputs.path, fixture.0);
        for (name, bytes) in [
            ("audio.wav", b"RIFF invalid WAV".as_slice()),
            (movie_name, b"not a movie".as_slice()),
            ("contact-sheet.png", b"not PNG".as_slice()),
        ] {
            let old = std::fs::read(fixture.0.join(name)).unwrap();
            root.write(name, bytes).unwrap();
            assert!(
                checked(&fixture.0, &bundle, &summary).is_err(),
                "accepted {name}"
            );
            root.write(name, &old).unwrap();
        }
        root.write("summary.md", b"stale summary").unwrap();
        assert!(checked(&fixture.0, &bundle, &summary).is_err());
    }
}

#[test]
fn publication_rejects_movie_with_valid_boxes_but_truncated_sample_payload() {
    for (movie_name, movie_bytes) in [
        (
            "recording.mp4",
            include_bytes!("../../../tests/fixtures/publication/tiny.mp4").as_slice(),
        ),
        (
            "recording.mov",
            include_bytes!("../../../tests/fixtures/publication/tiny.mov").as_slice(),
        ),
    ] {
        let fixture = Fixture::new();
        let (_, mut bundle, summary) = fixture.build();
        let mut movie = movie_bytes.to_vec();
        let mdat = movie.windows(4).position(|w| w == b"mdat").unwrap();
        // Keep every box syntactically valid, but claim video samples in an empty mdat.
        movie[mdat - 4..mdat].copy_from_slice(&8u32.to_be_bytes());
        movie.truncate(mdat + 4);
        let root = Directory::open(&fixture.0, false).unwrap();
        root.write(movie_name, &movie).unwrap();
        bundle.video = Some(movie_name.into());
        root.write("apparent.json", &serde_json::to_vec(&bundle).unwrap())
            .unwrap();
        assert!(checked(&fixture.0, &bundle, &summary).is_err());
    }
}

#[test]
fn publication_rejects_nested_symlinks_traversal_and_replaced_artifacts() {
    let fixture = Fixture::new();
    let (_, mut bundle, summary) = fixture.build();
    let outside = Fixture::new();
    outside.build();
    let before = std::fs::read(outside.0.join("contact-sheet.png")).unwrap();
    symlink(&outside.0, fixture.0.join("nested-link")).unwrap();
    let error = checked(&fixture.0, &bundle, &summary).err().unwrap();
    assert!(format!("{error:#}").contains("symlink"));
    std::fs::remove_file(fixture.0.join("nested-link")).unwrap();
    let root = Directory::open(&fixture.0, false).unwrap();
    assert!(root.write("../outside", b"bad").is_err());
    bundle.keyframes[0].file = "../contact-sheet.png".into();
    root.write("apparent.json", &serde_json::to_vec(&bundle).unwrap())
        .unwrap();
    assert!(checked(&fixture.0, &bundle, &summary).is_err());
    assert_eq!(
        std::fs::read(outside.0.join("contact-sheet.png")).unwrap(),
        before
    );
    let (_, bundle, summary) = fixture.build();
    let result = checked_with(&fixture.0, &bundle, &summary, || {
        std::fs::rename(fixture.0.join("frames"), fixture.0.join("old-frames"))?;
        symlink(outside.0.join("frames"), fixture.0.join("frames"))?;
        Ok(())
    });
    assert!(result.is_err());
    assert_eq!(
        std::fs::read(outside.0.join("contact-sheet.png")).unwrap(),
        before
    );
}

#[test]
fn publication_holds_final_mutations_and_checks_fallback_before_return() {
    for restore in [false, true] {
        let fixture = Fixture::new();
        let mut success_effects = 0;
        let result = publish_after(&fixture.0, || {
            let built = fixture.build();
            assert!(
                fixture.0.join(IN_PROGRESS).is_file(),
                "inner build must not publish early"
            );
            let sheet = std::fs::read(fixture.0.join("contact-sheet.png"))?;
            std::fs::write(
                fixture.0.join("contact-sheet.png"),
                b"failed optional whiteboard write",
            )?;
            if restore {
                std::fs::write(fixture.0.join("contact-sheet.png"), sheet)?;
            }
            Ok(built)
        });
        if result.is_ok() {
            success_effects += 1;
        }
        assert_eq!(success_effects, usize::from(restore));
        assert_eq!(fixture.0.join(IN_PROGRESS).exists(), !restore);
    }
}

#[test]
fn publication_rejects_marker_cleanup_failure_and_readonly_leaf_without_root_bypass() {
    let fixture = Fixture::new();
    let (_, bundle, summary) = fixture.build();
    std::fs::create_dir(fixture.0.join(crate::recover::RECOVERING)).unwrap();
    assert!(checked(&fixture.0, &bundle, &summary).is_err());
    assert!(fixture.0.join(crate::recover::RECOVERING).is_dir());
    std::fs::remove_dir(fixture.0.join(crate::recover::RECOVERING)).unwrap();
    // An occupied directory fails even as root (mode 000 alone would not).
    std::fs::create_dir(fixture.0.join(crate::recover::UNFINISHED)).unwrap();
    assert!(
        crate::recover::write(
            &fixture.0,
            &crate::recover::orphan_recipe(
                &crate::helper::Probe {
                    duration_ms: 200,
                    width: 16,
                    height: 16,
                    fps: 10.0,
                    audio_tracks: 0,
                },
                None
            )
        )
        .is_err()
    );
    std::fs::remove_dir(fixture.0.join(crate::recover::UNFINISHED)).unwrap();
    std::fs::set_permissions(
        fixture.0.join("summary.md"),
        std::fs::Permissions::from_mode(0o666),
    )
    .unwrap();
    assert!(
        checked(&fixture.0, &bundle, &summary).is_err(),
        "unsafe permissions must fail even as root"
    );
}

#[test]
fn publication_detects_postvalidation_manifest_replacement_before_cleanup() {
    let fixture = Fixture::new();
    let (_, bundle, summary) = fixture.build();
    let root = Directory::open(&fixture.0, false).unwrap();
    root.write(IN_PROGRESS, b"pending").unwrap();
    let result = checked_with(&fixture.0, &bundle, &summary, || {
        root.write("apparent.json", b"{}")
    });
    assert!(result.is_err());
    assert!(fixture.0.join(IN_PROGRESS).exists());
}

#[test]
fn publication_rejects_bundle_directory_replacement_under_existing_writer_lease() {
    let fixture = Fixture::new();
    let (_, bundle, summary) = fixture.build();
    let _lease = coordinate(&fixture.0).unwrap();
    let moved = Fixture::new();
    std::fs::rename(&fixture.0, &moved.0).unwrap();
    std::fs::create_dir(&fixture.0).unwrap();
    assert!(checked(&fixture.0, &bundle, &summary).is_err());
}
