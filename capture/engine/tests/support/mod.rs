use apparent_capture_engine::new_id;
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

pub struct Fixture(pub PathBuf);
impl Fixture {
    pub fn new() -> Self {
        // Canonicalize the owned fixture base, never relax Engine's no-follow guard.
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("apparent-dev-engine-fixture-{}", new_id().unwrap()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
