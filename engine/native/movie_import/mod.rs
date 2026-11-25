use std::ffi::CString;
use std::fs::{File, OpenOptions, Permissions};
use std::os::unix::{
    ffi::OsStrExt,
    fs::{OpenOptionsExt, PermissionsExt},
};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};

use crate::capture::engine::{
    runtime::phone::{MovieCapture, build_movie_bundle},
    sketch,
};
use crate::shared::model::{ApparentBundle, CaptureMode, TargetFrame, TargetInfo};

pub(crate) fn import(movie: &Path, destination: Option<&Path>) -> Result<PathBuf> {
    let default_destination = movie.with_extension("apparent");
    let destination = destination.unwrap_or(&default_destination);
    let extension = movie
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    ensure!(
        extension.eq_ignore_ascii_case("mp4") || extension.eq_ignore_ascii_case("mov"),
        "Import accepts local MP4 and MOV movies"
    );
    ensure!(
        destination
            .extension()
            .is_some_and(|value| value == "apparent"),
        "Import output must end in .apparent"
    );

    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = parent
        .canonicalize()
        .context("Open import destination directory")?;
    let name = destination.file_name().context("Missing bundle name")?;
    let destination = parent.join(name);
    ensure!(
        !destination.exists(),
        "{} already exists",
        destination.display()
    );

    let mut input = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(movie)?;
    ensure!(
        input.metadata()?.is_file(),
        "Import source must be a regular file"
    );
    let stage = tempfile::Builder::new()
        .prefix(".apparent-import-")
        .permissions(Permissions::from_mode(0o700))
        .tempdir_in(&parent)?;
    let bundle_dir = stage.path().join(name);
    std::fs::create_dir(&bundle_dir)?;
    std::fs::set_permissions(&bundle_dir, Permissions::from_mode(0o700))?;
    let copied = bundle_dir.join(format!("recording.{}", extension.to_ascii_lowercase()));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&copied)?;
    std::io::copy(&mut input, &mut output)?;
    drop(output);

    let (_, bundle, _) = build_movie_bundle(
        &bundle_dir,
        MovieCapture {
            movie: copied,
            target: TargetInfo {
                mode: CaptureMode::Display,
                app: Some("Imported video".into()),
                bundle_id: None,
                window_title: None,
                window_id: None,
                display_id: 0,
                frame: TargetFrame {
                    x: 0.0,
                    y: 0.0,
                    width: 0.0,
                    height: 0.0,
                    scale: 1.0,
                },
            },
            device: None,
            events: Vec::new(),
            strokes: Vec::new(),
            flags: Vec::new(),
            note: None,
            context: Default::default(),
            context_changes: Vec::new(),
            screens: Vec::new(),
        },
    )?;

    let summary = bundle_dir.join("summary.md");
    std::fs::write(&summary, sketch::summary_markdown(&bundle, &destination))?;
    File::open(&summary)?.sync_all()?;
    File::open(&bundle_dir)?.sync_all()?;
    publish(&bundle_dir, &destination)?;
    File::open(&parent)?.sync_all()?;
    Ok(destination)
}

fn publish(from: &Path, to: &Path) -> std::io::Result<()> {
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

pub(crate) fn uses_movie_assembly(imported: bool, device: bool) -> bool {
    let routes = include_bytes!(concat!(env!("OUT_DIR"), "/record-movie-route.bin"));
    routes[usize::from(imported) * 2 + usize::from(device)] == 1
}

pub(crate) fn rebuild(
    directory: &Path,
    movie: PathBuf,
    bundle: &ApparentBundle,
    flags: &[u64],
) -> Result<String> {
    build_movie_bundle(
        directory,
        MovieCapture {
            movie,
            target: bundle.target.clone(),
            device: bundle.device.clone(),
            events: bundle.events.clone(),
            strokes: bundle.strokes.clone(),
            flags: flags.to_vec(),
            note: bundle.note.clone(),
            context: bundle.context.clone(),
            context_changes: bundle.context_changes.clone(),
            screens: bundle.screens.clone(),
        },
    )
    .map(|(_, _, summary)| summary)
}
