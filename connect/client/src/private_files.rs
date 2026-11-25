use super::*;
pub(super) use super::file_transfer::publish_noreplace;

pub(super) fn asset_path(path: &str) -> bool {
    if path.len() > 128
        || !path.is_ascii()
        || path.contains('\\')
        || path.split('/').any(|p| p.is_empty() || p.starts_with('.'))
    {
        return false;
    }
    match path.split('/').collect::<Vec<_>>().as_slice() {
        [name] => matches!(
            *name,
            "summary.md"
                | "notes.json"
                | "apparent.json"
                | "contact-sheet.png"
                | "contact-sheet-full.png"
                | "recording.mp4"
                | "recording.mov"
                | "audio.wav"
                | "timeline.json"
                | "finish-trace.json"
        ),
        [dir, name] if matches!(*dir, "frames" | "frames-full") => name
            .strip_prefix("frame-")
            .and_then(|s| s.strip_suffix(".png"))
            .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())),
        _ => false,
    }
}
pub(super) fn validate_assets(files: &[Asset]) -> Result<()> {
    validate_assets_with_limit(files, MAX_FILE_BYTES)
}

pub(super) fn validate_assets_with_limit(files: &[Asset], asset_limit: u64) -> Result<()> {
    ensure!(
        !files.is_empty() && files.len() <= MAX_FILES,
        "invalid_manifest: file count"
    );
    let mut names = BTreeSet::new();
    let mut size = 0u64;
    for file in files {
        ensure!(
            file.size <= asset_limit,
            "file_too_large: an asset exceeds the transfer limit; no files were omitted"
        );
        ensure!(
            asset_path(&file.path) && hex_digest(&file.sha256) && names.insert(file.path.clone()),
            "invalid_manifest: unsafe or duplicate file"
        );
        size = size
            .checked_add(file.size)
            .context("invalid_manifest: size overflow")?;
        ensure!(
            size <= MAX_BYTES,
            "quota_exceeded: bundle exceeds account limit"
        );
    }
    for required in ["apparent.json", "summary.md", "contact-sheet.png"] {
        ensure!(
            names.contains(required),
            "invalid_manifest: missing {required}"
        );
    }
    Ok(())
}

pub(super) fn same_manifest(a: &[Asset], b: &[Asset]) -> bool {
    let mut a = a.to_vec();
    let mut b = b.to_vec();
    a.sort_by(|a, b| a.path.cmp(&b.path));
    b.sort_by(|a, b| a.path.cmp(&b.path));
    a == b
}


pub(super) fn no_symlinks(path: &Path) -> Result<()> {
    let mut prefix = PathBuf::new();
    for component in path.components() {
        ensure!(
            !matches!(component, std::path::Component::ParentDir),
            "Unsafe path"
        );
        prefix.push(component);
        if let Ok(meta) = fs::symlink_metadata(&prefix) {
            ensure!(!meta.file_type().is_symlink(), "Symlink path refused");
        }
    }
    Ok(())
}
pub(super) fn trusted_directory_tree(path: &Path, sticky_leaf: bool) -> Result<()> {
    let path = std::path::absolute(path)?;
    let component_count = path.components().count();
    let mut prefix = PathBuf::new();
    let mut private_ancestor = false;
    for (index, component) in path.components().enumerate() {
        ensure!(
            !matches!(component, std::path::Component::ParentDir),
            "Unsafe path"
        );
        prefix.push(component);
        let meta = fs::symlink_metadata(&prefix)?;
        let sticky = meta.mode() & libc::S_ISVTX as u32 != 0;
        #[cfg(target_os = "macos")]
        no_allow_acl(&prefix)?;

        let rejection = if !meta.is_dir() || meta.file_type().is_symlink() {
            Some("must be a directory and must not be a symlink")
        } else if meta.uid() != 0 && meta.uid() != unsafe { libc::geteuid() } {
            Some("must be owned by the current user or root")
        } else if !(meta.mode() & 0o022 == 0
            || (sticky && (prefix != path || sticky_leaf))
            || (private_ancestor && prefix != path))
        {
            Some("group or other users have write permission")
        } else {
            None
        };
        if let Some(reason) = rejection {
            let levels = component_count - index - 1;
            if levels == 0 {
                anyhow::bail!("Unsafe shared or unowned directory tree at the directory itself: {reason}");
            }
            anyhow::bail!(
                "Unsafe shared or unowned directory tree at an ancestor ({levels} levels above): {reason}"
            );
        }
        private_ancestor |= meta.mode() & 0o077 == 0;
    }
    Ok(())
}
#[cfg(target_os = "macos")]
pub(super) fn no_allow_acl(path: &Path) -> Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    unsafe extern "C" {
        fn acl_get_link_np(path: *const libc::c_char, kind: libc::c_int) -> *mut libc::c_void;
        fn acl_get_entry(
            acl: *mut libc::c_void,
            entry_id: libc::c_int,
            entry: *mut *mut libc::c_void,
        ) -> libc::c_int;
        fn acl_get_tag_type(entry: *mut libc::c_void, tag: *mut libc::c_int) -> libc::c_int;
        fn acl_free(acl: *mut libc::c_void) -> libc::c_int;
    }
    let path = CString::new(path.as_os_str().as_bytes())?;
    let acl = unsafe { acl_get_link_np(path.as_ptr(), 0x100) };
    if acl.is_null() {
        ensure!(
            std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOENT),
            "Could not verify directory ACL"
        );
        return Ok(());
    }
    let result = (|| -> Result<()> {
        let mut entry = std::ptr::null_mut();
        let mut selector = 0;
        loop {
            let found = unsafe { acl_get_entry(acl, selector, &mut entry) };
            if found != 0 {
                ensure!(
                    std::io::Error::last_os_error().raw_os_error() == Some(libc::EINVAL),
                    "Could not verify directory ACL entries"
                );
                return Ok(());
            }
            let mut tag = 0;
            ensure!(
                unsafe { acl_get_tag_type(entry, &mut tag) } == 0 && tag == 2,
                "Directory ACL grants are not supported for hosted transfers"
            );
            selector = -1;
        }
    })();
    unsafe {
        acl_free(acl);
    }
    result
}
pub(super) fn private_dir(path: &Path) -> Result<()> {
    no_symlinks(path)?;
    if !path.exists() {
        if let Some(parent) = path.parent() {
            create_trusted_parents(parent)?;
        }
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.into()),
        }
    }
    trusted_directory_tree(path, false)?;
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        meta.is_dir()
            && !meta.file_type().is_symlink()
            && meta.uid() == unsafe { libc::geteuid() }
            && meta.mode() & 0o077 == 0,
        "Hosted state directory must be owned and mode 0700"
    );
    Ok(())
}
pub(super) fn create_trusted_parents(path: &Path) -> Result<()> {
    if !path.exists() {
        create_trusted_parents(path.parent().context("Missing trusted parent")?)?;
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.into()),
        }
    }
    trusted_directory_tree(path, true)
}
pub(super) fn read_private(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    let meta = file.metadata()?;
    ensure!(
        meta.is_file()
            && meta.uid() == unsafe { libc::geteuid() }
            && meta.mode() & 0o077 == 0
            && meta.len() <= limit,
        "Hosted state file must be owned, private and bounded"
    );
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "Hosted state too large");
    Ok(bytes)
}
pub(super) fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    private_dir(path.parent().context("Missing parent")?)?;
    let tmp = path.with_extension(format!("{}.tmp", random_id()?));
    let result = (|| -> Result<()> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&serde_json::to_vec(value)?)?;
        f.sync_all()?;
        fs::rename(&tmp, path)?;
        File::open(path.parent().unwrap())?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
pub(super) struct Lock(File);
impl Lock {
    pub(super) fn acquire(path: &Path, nonblocking: bool) -> Result<Self> {
        Self::acquire_until(path, nonblocking, None)
    }
    pub(super) fn acquire_until(path: &Path, nonblocking: bool, deadline: Option<Instant>) -> Result<Self> {
        let f = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)?;
        let op = libc::LOCK_EX | libc::LOCK_NB;
        let before = f.metadata()?;
        ensure!(
            before.is_file()
                && before.uid() == unsafe { libc::geteuid() }
                && before.mode() & 0o077 == 0
                && before.nlink() == 1,
            "Unsafe hosted lock"
        );

        loop {
            if unsafe { libc::flock(f.as_raw_fd(), op) } == 0 {
                break;
            }
            let error = std::io::Error::last_os_error();
            ensure!(
                !nonblocking
                    && error.kind() == std::io::ErrorKind::WouldBlock
                    && deadline.is_none_or(|deadline| Instant::now() < deadline),
                "Hosted worker already running"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let after = fs::symlink_metadata(path)?;
        ensure!(
            after.dev() == before.dev()
                && after.ino() == before.ino()
                && !after.file_type().is_symlink(),
            "Hosted lock changed while waiting"
        );
        Ok(Self(f))
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        unsafe {
            libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

pub(super) struct Scratch(pub(super) PathBuf);
impl Scratch {
    pub(super) fn new(parent: &Path) -> Result<Self> {
        private_dir(parent)?;
        let path = parent.join(format!("request-{}", random_id()?));
        fs::DirBuilder::new().mode(0o700).create(&path)?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}


impl Scratch {
    pub(super) fn new_output(parent: &Path) -> Result<Self> {
        trusted_directory_tree(parent, true)?;
        let path = parent.join(format!(".apparent-fetch-{}", random_id()?));
        fs::DirBuilder::new().mode(0o700).create(&path)?;
        Ok(Self(path))
    }
}

pub(super) fn digest_file(path: &Path) -> Result<String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    ensure!(file.metadata()?.is_file(), "Expected regular asset");
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("/usr/bin/shasum");
        c.args(["-a", "256"]);
        c
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("sha256sum");
    let output = command
        .stdin(Stdio::from(file))
        .stderr(Stdio::null())
        .output()
        .context("SHA-256 tool is required")?;
    ensure!(output.status.success(), "SHA-256 failed");
    let output = String::from_utf8(output.stdout)?;
    let digest = output.split_whitespace().next().unwrap_or("");
    ensure!(hex_digest(digest), "Invalid SHA-256 output");
    Ok(digest.to_owned())
}


pub(super) fn snapshot_bounded(bundle: &Path, stage: &Path, asset_limit: u64) -> Result<Vec<Asset>> {
    no_symlinks(bundle)?;
    trusted_directory_tree(bundle, false)?;
    private_dir(stage)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(bundle)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| anyhow::anyhow!("Invalid asset name"))?;
        if matches!(name.as_str(), ".publication.lock" | "notes-ui.log" | ".connect-style.json") {
            let metadata = fs::symlink_metadata(entry.path())?;
            ensure!(
                metadata.is_file()
                    && metadata.uid() == unsafe { libc::geteuid() }
                    && metadata.mode() & 0o022 == 0
                    && metadata.nlink() == 1
                    && (name != ".publication.lock" || metadata.len() == 0),
                "Unsafe bundle publication lock or notes diagnostic"
            );
            continue;
        }
        if matches!(name.as_str(), "frames" | "frames-full") {
            trusted_directory_tree(&entry.path(), false)?;
            ensure!(
                entry.file_type()?.is_dir() && !entry.file_type()?.is_symlink(),
                "Symlink asset directory refused"
            );
            for child in fs::read_dir(entry.path())? {
                let child = child?;
                let name = format!(
                    "{name}/{}",
                    child.file_name().to_str().context("Invalid asset name")?
                );
                ensure!(
                    asset_path(&name),
                    "unsupported_asset: bundle contains an unknown asset; no files were omitted"
                );
                paths.push(name);
            }
        } else {
            ensure!(
                asset_path(&name),
                "unsupported_asset: bundle contains an unknown asset; no files were omitted"
            );
            paths.push(name);
        }
    }
    paths.sort();

    ensure!(paths.len() <= MAX_FILES, "Too many bundle assets");
    let mut files = Vec::new();
    let mut total = 0u64;
    for path in paths {
        no_symlinks(&bundle.join(&path))?;
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("snapshot_open", &bundle.join(&path));
        let mut source = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(bundle.join(&path))?;
        let metadata = source.metadata()?;
        ensure!(metadata.is_file(), "Non-regular asset refused");
        ensure!(
            metadata.len() <= asset_limit,
            "file_too_large: an asset exceeds the transfer limit; no files were omitted"
        );
        total = total
            .checked_add(metadata.len())
            .context("Asset size overflow")?;
        ensure!(
            total <= MAX_BYTES,
            "quota_exceeded: bundle exceeds transfer limit"
        );
        let target = stage.join(&path);
        private_dir(target.parent().unwrap())?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&target)?;
        let copied = std::io::copy(&mut (&mut source).take(metadata.len() + 1), &mut output)?;
        ensure!(copied == metadata.len(), "Asset changed during snapshot");
        output.sync_all()?;
        files.push(Asset {
            path,
            size: copied,
            sha256: digest_file(&target)?,
        });
    }
    validate_assets_with_limit(&files, asset_limit)?;
    validate_bundle_references(stage, &files)?;
    Ok(files)
}

pub(super) fn validate_bundle_references(bundle: &Path, files: &[Asset]) -> Result<()> {
    let metadata = files
        .iter()
        .find(|f| f.path == "apparent.json")
        .context("Missing bundle metadata")?;
    ensure!(metadata.size <= JSON_LIMIT, "Bundle metadata too large");
    let value: Value = serde_json::from_slice(&fs::read(bundle.join("apparent.json"))?)?;
    ensure!(value.is_object(), "Invalid bundle metadata");
    let names: BTreeSet<_> = files.iter().map(|f| f.path.as_str()).collect();
    let check = |value: &Value| -> Result<()> {
        if let Some(path) = value.as_str() {
            ensure!(
                asset_path(path) && names.contains(path),
                "Unsafe or missing bundle asset reference"
            );
        } else {
            ensure!(value.is_null(), "Invalid asset reference");
        }
        Ok(())
    };
    for field in ["contactSheet", "contact_sheet", "video", "audio"] {
        if let Some(value) = value.get(field) {
            check(value)?;
        }
    }
    if let Some(frames) = value.get("keyframes").and_then(Value::as_array) {
        for frame in frames {
            check(frame.get("file").context("Missing frame asset")?)?;
        }
    }
    if let Some(crop) = value.get("autocrop").filter(|v| !v.is_null()) {
        for field in ["fullContactSheet", "full_contact_sheet"] {
            if let Some(v) = crop.get(field) {
                check(v)?;
            }
        }
        for field in ["fullFrames", "full_frames"] {
            if let Some(v) = crop.get(field) {
                ensure!(
                    v.as_str() == Some("frames-full"),
                    "Unsafe full-frame directory"
                );
            }
        }
    }
    Ok(())
}
