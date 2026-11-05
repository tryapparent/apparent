use std::{fs, path::{Path, PathBuf}};
use anyhow::{Context, Result, ensure};
use crate::model::ApparentBundle;
pub fn resolve_bundle_dir(path_or_id: &Path, captures: &Path) -> Result<PathBuf> {
    if path_or_id == Path::new("latest") {
        return newest_bundle(captures);
    }
    let mut path = path_or_id.to_owned();
    if path.file_name().is_some_and(|name| name == "apparent.json") {
        path = path
            .parent()
            .context("Missing bundle directory")?
            .to_owned();
        if path.as_os_str().is_empty() {
            path = PathBuf::from(".");
        }
    }
    if !path.exists() && path.components().count() == 1 {
        path = captures.join(&path);
        if path.extension().is_none() {
            path.set_extension("apparent");
        }
    }
    ensure!(
        path.is_dir(),
        "Bundle directory not found: {}",
        path.display()
    );
    let path = plain_path(
        path.canonicalize()
            .with_context(|| format!("Could not resolve {}", path.display()))?,
    );
    ensure!(
        path.extension().is_some_and(|ext| ext == "apparent"),
        "Expected a .apparent directory: {}",
        path.display()
    );
    Ok(path)
}

pub fn newest_bundle(captures: &Path) -> Result<PathBuf> {
    capture_history(captures)?
        .into_iter()
        .next()
        .context("No .apparent captures found")
}

/// Completed captures in reverse creation order. Do not use directory mtime: reprocessing and
/// zooming an old capture can change it without making that capture the newest one.
pub fn capture_history(captures: &Path) -> Result<Vec<PathBuf>> {
    let mut candidates = Vec::new();
    for entry in
        fs::read_dir(captures).with_context(|| format!("Could not read {}", captures.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "apparent") && path.is_dir() {
            // A cancelled or still-processing capture has a directory but no manifest.
            // Never let it hide the last completed capture from paste/inspect latest.
            let Some(bundle) = fs::read(path.join("apparent.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<ApparentBundle>(&bytes).ok())
            else {
                continue;
            };
            // Bundle creation time is stable even after later zoom-frame extraction.
            candidates.push((bundle.created_at_ms, path));
        }
    }
    candidates.sort_unstable_by(|a, b| b.cmp(a));
    Ok(candidates
        .into_iter()
        .filter_map(|(_, path)| path.canonicalize().ok().map(plain_path))
        .collect())
}

/// `canonicalize` on Windows returns `\\?\C:\…`; agents and terminals want `C:\…`.
pub fn plain_path(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(|p| p.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

pub fn load_bundle(bundle_dir: &Path, captures: &Path) -> Result<(PathBuf, ApparentBundle)> {
    let directory = resolve_bundle_dir(bundle_dir, captures)?;
    let path = directory.join("apparent.json");
    let bundle = serde_json::from_slice(
        &fs::read(&path).with_context(|| format!("Could not read {}", path.display()))?,
    )
    .with_context(|| format!("Invalid bundle manifest: {}", path.display()))?;
    Ok((directory, bundle))
}

