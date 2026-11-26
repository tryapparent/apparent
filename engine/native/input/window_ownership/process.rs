use std::{collections::HashMap, process::{Child, ExitStatus}, sync::{Arc, Mutex, Weak}};

struct Registration {
    child: Weak<Mutex<Child>>,
    settings: bool,
}

static CHILDREN: Mutex<Option<HashMap<u32, Registration>>> = Mutex::new(None);

pub(crate) struct UiChild(Arc<Mutex<Child>>);

impl UiChild {
    pub(crate) fn new(child: Child) -> Self {
        Self::register(child, false)
    }

    pub(crate) fn settings(child: Child) -> Self {
        Self::register(child, true)
    }

    fn register(child: Child, settings: bool) -> Self {
        let pid = child.id();
        let child = Arc::new(Mutex::new(child));
        CHILDREN.lock().unwrap().get_or_insert_with(HashMap::new)
            .insert(pid, Registration { child: Arc::downgrade(&child), settings });
        Self(child)
    }

    pub(crate) fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        self.0.lock().unwrap().try_wait()
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn pid(&self) -> i32 {
        self.0.lock().unwrap().id() as i32
    }

    pub(crate) fn kill(&mut self) -> std::io::Result<()> {
        self.0.lock().unwrap().kill()
    }

    pub(crate) fn wait(&mut self) -> std::io::Result<ExitStatus> {
        loop {
            if let Some(status) = self.try_wait()? { return Ok(status); }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}

impl Drop for UiChild {
    fn drop(&mut self) {
        let pid = self.0.lock().unwrap().id();
        if let Some(children) = CHILDREN.lock().unwrap().as_mut()
            && children.get(&pid).is_some_and(|entry| entry.child.ptr_eq(&Arc::downgrade(&self.0)))
        {
            children.remove(&pid);
        }
    }
}

pub(crate) fn owns(pid: i32) -> bool {
    owns_with_role(pid, false)
}

pub(crate) fn owns_settings(pid: i32) -> bool {
    owns_with_role(pid, true)
}

fn owns_with_role(pid: i32, settings_only: bool) -> bool {
    let child = CHILDREN.lock().unwrap().as_ref()
        .and_then(|children| children.get(&(pid as u32)))
        .filter(|entry| !settings_only || entry.settings)
        .and_then(|entry| entry.child.upgrade());
    child.is_some_and(|child| matches!(child.lock().unwrap().try_wait(), Ok(None)))
}

pub(crate) fn is_external_app(pid: i32) -> bool {
    pid > 0 && pid != std::process::id() as i32 && !owns(pid)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    #[test]
    fn external_receiver_excludes_the_live_owned_renderer() {
        assert!(!is_external_app(0));
        assert!(!is_external_app(std::process::id() as i32));
        let child = Command::new("/bin/cat").stdin(Stdio::piped())
            .stdout(Stdio::null()).spawn().unwrap();
        let pid = child.id() as i32;
        assert!(is_external_app(pid));
        let mut owned = UiChild::new(child);
        assert!(!is_external_app(pid));
        owned.kill().unwrap();
        owned.wait().unwrap();
    }
}
