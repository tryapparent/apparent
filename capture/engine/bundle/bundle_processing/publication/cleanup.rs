//! Recovery records are removed only after artifact durability. If cleanup or
//! final directory durability fails, restore every original record when possible.
use super::{Directory, IN_PROGRESS, fs, validate::TEXT_CAP};
use anyhow::{Context, Result};

pub(super) fn finish(
    root: &Directory,
    parent: &Directory,
    final_check: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let mut saved = Vec::new();
    for name in [
        crate::capture::engine::bundle::recover::UNFINISHED,
        crate::capture::engine::bundle::recover::RECOVERING,
        crate::capture::engine::bundle::recover::UNSAFE_VIDEO,
        crate::capture::engine::runtime::audio::persistence::RECORDING,
        IN_PROGRESS,
        "microphone-off", // Legacy intent is now persisted in apparent.json context.
    ] {
        // Open every marker before unlinking any: a directory/symlink collision
        // must not consume the recipe needed by the next recovery attempt.
        match root.file(name) {
            Ok(file) => saved.push((name, fs::bytes(&file, TEXT_CAP)?)),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
            Err(error) => return Err(error.context(format!("cannot clean recovery marker {name}"))),
        }
    }
    let result = (|| {
        for (name, _) in &saved {
            root.remove(name)
                .with_context(|| format!("could not finish publication: {name}"))?;
        }
        root.0.sync_all()?;
        parent.0.sync_all()?;
        final_check()
    })();
    if let Err(error) = result {
        for (name, bytes) in saved {
            root.write(name, &bytes).with_context(|| {
                format!("{error:#}; also failed to restore recovery marker {name}")
            })?;
        }
        root.0
            .sync_all()
            .context("could not durably restore recovery markers")?;
        parent
            .0
            .sync_all()
            .context("could not durably restore recovery parent")?;
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn durability_failure_restores_journal_and_in_progress_marker() {
        let fixture = tempfile::Builder::new().permissions(std::fs::Permissions::from_mode(0o700)).tempdir().unwrap();
        let path = fixture.path().join("bundle.apparent");
        let root = Directory::open(&path, true).unwrap();
        root.write(
            crate::capture::engine::bundle::recover::UNFINISHED,
            b"recipe must survive",
        )
        .unwrap();
        root.write(IN_PROGRESS, b"pending").unwrap();
        root.write(
            crate::capture::engine::runtime::audio::persistence::RECORDING,
            b"saved audio recipe",
        )
        .unwrap();
        let parent = Directory::open_sync_parent(path.parent().unwrap()).unwrap();
        let moved = path.with_extension("moved");
        assert!(
            finish(&root, &parent, || {
                std::fs::rename(&path, &moved)?;
                Directory::open(&path, false)?;
                Ok(())
            })
            .is_err()
        );
        assert_eq!(
            std::fs::read(moved.join(crate::capture::engine::bundle::recover::UNFINISHED)).unwrap(),
            b"recipe must survive"
        );
        assert!(moved.join(IN_PROGRESS).is_file());
        assert_eq!(
            std::fs::read(
                moved.join(crate::capture::engine::runtime::audio::persistence::RECORDING)
            )
            .unwrap(),
            b"saved audio recipe"
        );
    }
    #[test]
    fn successful_barrier_cleans_recovery_journals() {
        for marker in [
            crate::capture::engine::runtime::audio::persistence::RECORDING,
            crate::capture::engine::bundle::recover::UNSAFE_VIDEO,
        ] {
            let fixture = tempfile::Builder::new().permissions(std::fs::Permissions::from_mode(0o700)).tempdir().unwrap();
            let path = fixture.path().join("bundle.apparent");
            let root = Directory::open(&path, true).unwrap();
            root.write(marker, b"saved recovery state").unwrap();
            let parent = Directory::open_sync_parent(path.parent().unwrap()).unwrap();
            finish(&root, &parent, || Ok(())).unwrap();
            assert!(!path.join(marker).exists(), "retained {marker}");
        }
    }
}
