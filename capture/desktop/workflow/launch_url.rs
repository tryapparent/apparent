//! Deliberately literal launch contract: no parsing, normalization or decoded commands.
pub fn valid(url: &str) -> bool {
    url == "apparent://open"
}

/// A new, fixed destination contract. No caller-supplied executable, path or callback.
pub fn hermes_request(url: &str) -> Option<&str> {
    let request = url.strip_prefix("apparent://hermes/")?;
    valid_hermes_destination(request).then_some(request)
}

pub fn valid_hermes_destination(request: &str) -> bool {
    if request.len() > 38 { return false; }
    let parts: Vec<_> = request.split('/').collect();
    parts.len() == 2 && parts[0].len() == 32
        && parts[0].bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && parts[1].bytes().all(|c| c.is_ascii_digit())
        && parts[1].parse::<u16>().is_ok_and(|port| (32768..=60999).contains(&port))
}

pub fn open_hermes(token: &str) -> anyhow::Result<()> {
    open_hermes_mode(token, false)
}

pub fn open_hermes_trusted(destination: &str) -> anyhow::Result<()> {
    open_hermes_mode(destination, true)
}

fn open_hermes_mode(destination: &str, auto_start: bool) -> anyhow::Result<()> {
    use std::process::Stdio;
    anyhow::ensure!(valid_hermes_destination(destination), "Invalid Hermes request");
    hermes_command(super::electron::resolve()?, destination, auto_start)?
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
    Ok(())
}

fn hermes_command(resources: super::electron::Resources, destination: &str, auto_start: bool) -> anyhow::Result<std::process::Command> {
    anyhow::ensure!(resources.root.join("dist/hermes-main.cjs").is_file()
        && resources.root.join("dist/hermes-preload.cjs").is_file(), "Hermes recording UI is missing; update Apparent");
    let mut command = std::process::Command::new(&resources.executable);
    super::electron::configure_sandbox(&mut command, &resources.executable)?;
    if cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        command.arg("--ozone-platform=x11");
    }
    command.arg(resources.root.join("dist/hermes-main.cjs"))
        .arg("--hermes-request").arg(destination);
    if auto_start { command.arg("--hermes-autostart"); }
    command.arg("--apparent-executable").arg(resources.native_executable);
    Ok(command)
}

pub fn can_present(recording: bool, processing: bool, selecting: bool) -> bool {
    !recording && !processing && !selecting
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hermes_launch_uses_the_resolved_native_identity_and_shared_sandbox() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("assets");
        let runtime = dir.path().join("runtime/electron");
        let native = dir.path().join("App.app/Contents/MacOS/apparent");
        for file in [root.join("dist/hermes-main.cjs"), root.join("dist/hermes-preload.cjs"),
            runtime.clone(), runtime.with_file_name("chrome-sandbox"), native.clone()] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"synthetic").unwrap();
        }
        let native = native.canonicalize().unwrap();
        for trusted in [false, true] {
            let command = hermes_command(super::super::electron::Resources {
                executable: runtime.clone(), root: root.clone(), native_executable: native.clone(),
            }, "0123456789abcdef0123456789abcdef/45000", trusted).unwrap();
            let args: Vec<_> = command.get_args().collect();
            assert_eq!(command.get_program(), runtime.as_os_str());
            let native_flag = args.iter().position(|arg| *arg == "--apparent-executable").unwrap();
            assert_eq!(args[native_flag + 1], native.as_os_str());
            assert_eq!(args.iter().any(|arg| *arg == "--hermes-autostart"), trusted);
            assert!(!args.iter().any(|arg| *arg == "--no-sandbox"));
            #[cfg(target_os = "linux")]
            assert!(args.iter().any(|arg| *arg == "--disable-setuid-sandbox"));
        }
    }

    #[test]
    fn canonical_url_opens_the_app() {
        assert!(valid("apparent://open"));
    }

    #[test]
    fn hermes_launch_has_only_an_opaque_token() {
        let token = "0123456789abcdef0123456789abcdef/45000";
        assert_eq!(hermes_request(&format!("apparent://hermes/{token}")), Some(token));
        for suffix in ["", "../open", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcdef?callback=https://evil"] {
            assert!(hermes_request(&format!("apparent://hermes/{suffix}")).is_none());
        }
    }

    #[test]
    fn launch_never_presents_over_active_capture_work() {
        assert!(can_present(false, false, false));
        for state in 1..8 {
            assert!(!can_present(state & 1 != 0, state & 2 != 0, state & 4 != 0));
        }
    }

    #[test]
    fn untrusted_variants_are_not_commands() {
        for url in [
            "",
            "apparent:",
            "apparent://",
            "apparent://open/",
            "apparent://OPEN",
            "APPARENT://open",
            "apparent://open?record=true",
            "apparent://open#capture",
            "apparent://record",
            "apparent://open/latest",
            "apparent://user@open",
            "apparent://open:80",
            "apparent://%6fpen",
            " apparent://open",
            "apparent://open\n",
            "apparent://open\0",
            "https://open",
            "file:///tmp/capture",
            "apparent://open?",
            "apparent://open#",
            "apparent://open;sh",
            "apparent://open%00",
            "apparent://оpen",
        ] {
            assert!(!valid(url), "accepted {url:?}");
        }
        assert!(!valid(&format!("apparent://open{}", "x".repeat(1_000_000))));
    }
}
