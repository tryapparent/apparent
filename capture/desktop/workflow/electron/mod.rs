use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
    pub native_executable: PathBuf,
}

/// Preserve Chromium's namespace/renderer sandbox for user-owned Linux packages.
/// An unusable privileged helper must not prevent the ordinary sandbox route.
pub(crate) fn configure_sandbox(command: &mut std::process::Command, _executable: &Path) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let helper = std::fs::metadata(_executable.parent().context("Missing runtime directory")?.join("chrome-sandbox"))?;
        if helper.uid() != 0 || helper.permissions().mode() & 0o4000 == 0 {
            command.arg("--disable-setuid-sandbox");
        }
    }
    #[cfg(not(target_os = "linux"))]
    crate::shared::handoff::configure_nightly_child(command);
    Ok(())
}

pub(crate) fn resolve() -> Result<Resources> {
    resolve_from(&std::env::current_exe()?, &Path::new(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend"))
}

fn resolve_from(executable: &Path, development: &Path) -> Result<Resources> {
    // macOS can report the CLI alias as current_exe(). Assets and later
    // Launch Services routing must use the same installed bundle target.
    let native_executable = executable.canonicalize().context("Missing app executable")?;
    let installed = native_executable.parent().context("Missing app directory")?;
    #[cfg(target_os = "macos")]
    let root = installed.join("../Resources/note-ui");
    #[cfg(target_os = "linux")]
    let root = installed.join("../lib/apparent/note-ui");
    let packaged = root.join("dist/index.html").is_file();
    let root = if packaged { root } else { development.to_path_buf() };
    // Settings already packages the shared runtime. Assets and entry protocols
    // remain surface-owned; callers never derive the executable from the asset root.
    #[cfg(target_os = "macos")]
    let binary = if packaged {
        installed.join("../Resources/settings/runtime/Electron.app/Contents/MacOS/Electron")
    } else { root.join("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron") };
    #[cfg(target_os = "linux")]
    let binary = if packaged {
        installed.join("../share/apparent/settings/runtime/electron")
    } else { root.join("node_modules/electron/dist/electron") };
    ensure!(
        binary.is_file() && root.join("dist/index.html").is_file(),
        "Desktop UI is missing; rebuild the packaged Electron frontend"
    );
    Ok(Resources { executable: binary, root, native_executable })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn user_owned_runtime_keeps_namespace_and_renderer_sandbox_enabled() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        std::fs::create_dir(&dir).unwrap();
        let helper = dir.join("chrome-sandbox");
        std::fs::write(&helper, "synthetic helper").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o777)).unwrap();
        let mut command = std::process::Command::new(dir.join("electron"));
        configure_sandbox(&mut command, &dir.join("electron")).unwrap();
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--disable-setuid-sandbox"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn installed_popups_use_settings_runtime_and_never_a_stale_duplicate() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        #[cfg(target_os = "macos")]
        let (bin, assets, runtime, old) = ("App.app/Contents/MacOS", "App.app/Contents/Resources/note-ui", "App.app/Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron", "runtime/Electron.app/Contents/MacOS/Electron");
        #[cfg(target_os = "linux")]
        let (bin, assets, runtime, old) = ("AppDir/usr/bin", "AppDir/usr/lib/apparent/note-ui", "AppDir/usr/share/apparent/settings/runtime/electron", "runtime/electron");
        let bin = dir.join(bin);
        let assets = dir.join(assets);
        let runtime = dir.join(runtime);
        for file in [assets.join("dist/index.html"), assets.join(old), runtime.clone()] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"synthetic").unwrap();
        }
        std::fs::create_dir_all(&bin).unwrap();
        let native = bin.join("apparent");
        std::fs::write(&native, b"synthetic native executable").unwrap();
        let alias = dir.join("bin/apparent");
        std::fs::create_dir_all(alias.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&native, &alias).unwrap();
        for executable in [&native, &alias] {
            let resources = resolve_from(executable, &dir.join("unavailable-development")).unwrap();
            assert_eq!(resources.executable.canonicalize().unwrap(), runtime.canonicalize().unwrap());
            assert_eq!(resources.root.canonicalize().unwrap(), assets.canonicalize().unwrap());
            assert_eq!(resources.native_executable, native.canonicalize().unwrap());
        }
        std::fs::remove_file(runtime).unwrap();
        assert!(resolve_from(&alias, &dir.join("unavailable-development")).is_err(), "an old popup runtime cannot mask a broken installed package");
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[derive(Default)]
struct QuitPrompt(Option<crate::composition::worker::quit::Session>);

impl gpui::Global for QuitPrompt {}

pub(crate) fn confirm_quit(cx: &mut gpui::App) -> bool {
    let prompt = cx.default_global::<QuitPrompt>();
    if prompt.0.is_some() {
        return true;
    }
    let open = || {
        use crate::capture::desktop::settings::{LoginItem, login_item};
        let login = login_item();
        let state = crate::composition::worker::quit::State {
            checked: matches!(login, LoginItem::On | LoginItem::NeedsApproval),
            available: option_env!("APPARENT_PREVIEW_BUILD").is_none() && login != LoginItem::Unavailable,
            needs_approval: login == LoginItem::NeedsApproval,
            desktop_shortcut_possible: cfg!(target_os = "linux"),
        };
        let resources = resolve()?;
        let mut command = std::process::Command::new(&resources.executable);
        configure_sandbox(&mut command, &resources.executable)?;
        #[cfg(target_os = "linux")]
        if std::env::var_os("WAYLAND_DISPLAY").is_none() {
            command.arg("--ozone-platform=x11");
        }
        let entry = resources.root.join("dist/quit/main.cjs");
        ensure!(entry.is_file(), "Quit dialog bundle unavailable");
        command.arg(entry);
        crate::composition::worker::quit::Session::open(command, state)
    };
    match open() {
        Ok(dialog) => prompt.0 = Some(dialog),
        Err(error) => crate::capture::engine::runtime::apparent_log(format!("Quit dialog unavailable: {error:#}")),
    }
    prompt.0.is_some()
}

pub(crate) fn poll_windows(cx: &mut gpui::App) {
    #[cfg(target_os = "macos")]
    frog_nudge::poll(cx);
    crate::capture::desktop::settings::settings_window::poll(cx);
    let prompt = cx.default_global::<QuitPrompt>();
    let Some(dialog) = prompt.0.as_mut() else { return };
    use crate::composition::worker::quit::Event;
    let decision = match dialog.event() {
        Some(Event::Decided(decision)) => decision,
        Some(Event::Closed { before_display_failure }) => {
            prompt.0.take();
            if before_display_failure {
                crate::capture::engine::runtime::apparent_log("Quit dialog failed before display; using native shutdown");
                super::shutdown::request();
            }
            return;
        }
        Some(Event::Ready) | None => return,
    };
    let saved = decision.checked.map_or(Ok(()), crate::capture::desktop::settings::apply_quit_login_preference);
    if let Err(error) = &saved {
        crate::capture::engine::runtime::apparent_log(format!("Quit dialog startup setting: {error:#}"));
    }
    let replied = dialog.reply(saved.is_ok()).is_ok();
    if !replied || saved.is_ok() {
        prompt.0.take();
    }
    if saved.is_ok() && decision.quit {
        super::shutdown::request();
    }
}

#[cfg(target_os = "macos")]
mod frog_nudge {
    use std::{
        path::{Path, PathBuf},
        ptr::NonNull,
        process::{Child, Command, Stdio},
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc::{Receiver, channel},
        },
        time::{Duration, Instant},
    };

    use crate::shared::handoff::{default_config_path, update_config_in};

    include!(concat!(env!("OUT_DIR"), "/frog-nudge.rs"));

    const APPS: [(&str, &str); 2] = [
        ("com.electron.wispr-flow", "dictationFrogAlternation"),
        ("com.superduper.superwhisper", "superwhisperFrogAlternation"),
    ];

    use objc2::rc::autoreleasepool;
    use objc2_app_kit::NSRunningApplication;
    use objc2_core_audio::{
        AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectPropertyAddress,
        kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyElementMain,
        kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject, kAudioProcessPropertyBundleID,
        kAudioProcessPropertyIsRunningInput, kAudioProcessPropertyPID,
    };
    use objc2_core_foundation::{CFString, CFRetained};
    use objc2_foundation::NSString;

    fn property(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn read<T>(object: u32, selector: u32, data: &mut [T], size: &mut u32) -> bool {
        unsafe { AudioObjectGetPropertyData(
            object, NonNull::from(&mut property(selector)), 0, std::ptr::null(),
            NonNull::from(size), NonNull::from(data).cast(),
        ) == 0 }
    }

    fn read_one<T: Default>(object: u32, selector: u32) -> Option<T> {
        let mut data = [T::default()];
        let mut bytes = std::mem::size_of::<T>() as u32;
        if !read(object, selector, &mut data, &mut bytes) || bytes as usize != std::mem::size_of::<T>() {
            return None;
        }
        let [value] = data;
        Some(value)
    }

    fn mic_state(bundle_id: &str) -> usize {
        autoreleasepool(|_| {
            let apps = NSRunningApplication::runningApplicationsWithBundleIdentifier(
                &NSString::from_str(bundle_id),
            );
            if apps.is_empty() { return 0; }
            let system = kAudioObjectSystemObject as u32;
            let list = kAudioHardwarePropertyProcessObjectList;
            let mut bytes = 0;
            let status = unsafe { AudioObjectGetPropertyDataSize(
                system, NonNull::from(&mut property(list)), 0, std::ptr::null(),
                NonNull::from(&mut bytes),
            ) };
            if status != 0 || bytes % 4 != 0 || bytes > 64 * 1024 { return 0; }
            if bytes == 0 { return 1; }
            let mut objects = vec![0_u32; bytes as usize / 4];
            if !read(system, list, &mut objects, &mut bytes) { return 0; }
            let mut unresolved = false;
            for object in objects.into_iter().take(bytes as usize / 4) {
                let bundle = read_one::<*mut CFString>(object, kAudioProcessPropertyBundleID)
                    .and_then(NonNull::new)
                    .map(|ptr| unsafe { CFRetained::from_raw(ptr) }.to_string());
                let identified = bundle.as_deref().is_some_and(|id| {
                    id == bundle_id || id.strip_prefix(bundle_id).is_some_and(|suffix| suffix.starts_with('.'))
                }) || read_one::<libc::pid_t>(object, kAudioProcessPropertyPID)
                    .is_some_and(|pid| apps.iter().any(|app| app.processIdentifier() == pid));
                if identified {
                    match read_one::<u32>(object, kAudioProcessPropertyIsRunningInput) {
                        Some(0) => {}
                        Some(_) => return 2,
                        None => unresolved = true,
                    }
                }
            }
            usize::from(!unresolved)
        })
    }

    fn eligible(enabled: bool, blocked: bool) -> bool {
        ELIGIBLE[usize::from(enabled) * 2 + usize::from(blocked)]
    }

    fn enabled(config: &serde_json::Value) -> bool {
        config["experiments"]["dictationFrog"].as_bool() == Some(true)
    }

    fn finish_session(path: &Path, count: &str, blocked: &AtomicBool) -> bool {
        let mut due = false;
        update_config_in(path, |config| {
            anyhow::ensure!(
                eligible(enabled(config), blocked.load(Ordering::Acquire)),
                "Nudge unavailable"
            );
            let onboarding = config.as_object_mut().unwrap().entry("onboarding")
                .or_insert_with(|| serde_json::json!({}));
            let onboarding = onboarding.as_object_mut().ok_or_else(|| anyhow::anyhow!("Invalid onboarding"))?;
            let previous = onboarding.get(count).and_then(|v| v.as_u64()).unwrap_or(0);
            let (next, wave) = usize::try_from(previous).ok()
                .and_then(|index| CYCLE.get(index)).copied().unwrap_or(CYCLE[0]);
            onboarding.insert(count.into(), next.into());
            due = wave;
            Ok(())
        }).is_ok() && due
    }

    struct Nudge {
        blocked: Arc<AtomicBool>,
        due: Receiver<()>,
        child: Option<Child>,
        entry: PathBuf,
        runtime: PathBuf,
    }

    impl Nudge {
        fn start(app: PathBuf, runtime: PathBuf) -> Option<Self> {
            let entry = app.join("dist/frog-nudge/entry.cjs");
            if !entry.is_file() {
                return None;
            }
            let (send, due) = channel();
            let blocked = Arc::new(AtomicBool::new(true));
            let paused = blocked.clone();
            let config = default_config_path();
            std::thread::Builder::new().name("dictation-nudge".into()).spawn(move || {
                let mut states = [(0, None); APPS.len()];
                let mut next_config_check = Instant::now();
                let mut watching = false;
                loop {
                    if Instant::now() >= next_config_check {
                        let saved = std::fs::read(&config).ok()
                            .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
                        watching = enabled(&saved);
                        next_config_check = Instant::now() + Duration::from_millis(750);
                    }
                    if eligible(watching, paused.load(Ordering::Acquire)) {
                        for ((bundle, count), (previous, pending)) in APPS.into_iter().zip(&mut states) {
                            let state = mic_state(bundle);
                            if ENDED[*previous][state] {
                                *pending = Some(Instant::now());
                            } else if state != 1 {
                                *pending = None;
                            }
                            *previous = state;
                            if pending.is_some_and(|at| at.elapsed() >= Duration::from_millis(SETTLE_MS)) {
                                *pending = None;
                                if finish_session(&config, count, &paused) && send.send(()).is_err() {
                                    return;
                                }
                            }
                        }
                    } else {
                        states.fill((0, None));
                    }
                    std::thread::sleep(Duration::from_millis(if watching { 125 } else { 750 }));
                }
            }).ok()?;
            Some(Self { blocked, due, child: None, entry, runtime })
        }

        fn tick(&mut self, blocked: bool) {
            self.blocked.store(blocked, Ordering::Release);
            if let Some(child) = &mut self.child {
                if blocked {
                    child.stdin.take();
                }
                if !matches!(child.try_wait(), Ok(None)) {
                    self.child = None;
                }
            }
            if blocked {
                while self.due.try_recv().is_ok() {}
            } else if self.child.is_none() && self.due.try_recv().is_ok() {
                self.child = Command::new(&self.runtime)
                    .arg(&self.entry)
                    .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
                    .spawn().ok();
            }
        }
    }

    struct FrogNudge(std::cell::RefCell<Option<Nudge>>);
    impl gpui::Global for FrogNudge {}

    pub(super) fn poll(cx: &mut gpui::App) {
        if !cx.has_global::<FrogNudge>() {
            let assets = crate::capture::desktop::settings::presentation::assets();
            cx.set_global(FrogNudge(std::cell::RefCell::new(assets.and_then(|(app, runtime)| Nudge::start(app, runtime)))));
        }
        if let Some(nudge) = &mut *cx.global::<FrogNudge>().0.borrow_mut() {
            nudge.tick(super::super::shutdown::busy()
                || super::super::shutdown::requested()
                || crate::capture::desktop::ui::macos::reduce_motion());
        }
    }
}
