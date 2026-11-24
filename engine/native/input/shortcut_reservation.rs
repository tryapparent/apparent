#[cfg(target_os = "macos")]
pub(super) fn native_shortcut_reserved(key: u32, modifiers: u32) -> bool {
    use std::{process::Command, time::Duration};

    if matches!(
        key,
        crate::capture::engine::runtime::MACOS_FN_KEY_CODE | 58 | 61
    ) && modifiers == 0
    {
        return false;
    }
    if key > 127 || modifiers & !0x1b00 != 0 {
        return true;
    }
    let Ok(path) = crate::capture::desktop::helper::path() else {
        return true;
    };
    let mut command = Command::new(path);
    command.args([
        "onboarding",
        "--validate-shortcut",
        &key.to_string(),
        &modifiers.to_string(),
    ]);
    query_shortcut_reservation(&mut command, Duration::from_secs(2))
}

#[cfg(any(target_os = "macos", test))]
fn query_shortcut_reservation(
    command: &mut std::process::Command,
    timeout: std::time::Duration,
) -> bool {
    use std::{
        io::Read,
        process::Stdio,
        time::{Duration, Instant},
    };
    let Ok(mut child) = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return true;
    };
    let stdout = child.stdout.take();
    let mut child = crate::capture::ui_process::UiChild::new(child);
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return true;
            }
        }
    }
    let mut bytes = Vec::new();
    let Some(stdout) = stdout else {
        return true;
    };
    if stdout.take(33).read_to_end(&mut bytes).is_err() {
        return true;
    }
    shortcut_reservation_projection(&bytes)
}

#[cfg(any(target_os = "macos", test))]
fn shortcut_reservation_projection(bytes: &[u8]) -> bool {
    if bytes.len() > 32 {
        return true;
    }
    serde_json::from_slice::<bool>(bytes).unwrap_or(true)
}
