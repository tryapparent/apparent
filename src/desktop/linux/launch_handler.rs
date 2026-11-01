//! Explicit desktop registration. Opening a URL never installs or changes its handler.
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

const ID: &str = "apparent-launch.desktop";
const MIME: &str = "x-scheme-handler/apparent";

fn desktop_entry(executable: &Path) -> Result<String> {
    let path = executable
        .to_str()
        .context("launch executable path must be UTF-8")?;
    // Generic xdg-open splits Exec itself and cannot resolve a quoted executable.
    // Refuse paths requiring quoting instead of registering a handler that cannot open.
    ensure!(
        executable.is_absolute()
            && path
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c)),
        "launch executable path contains unsupported desktop-file characters"
    );
    Ok(format!(
        "[Desktop Entry]\nType=Application\nName=Apparent\nExec={path} launch %u\nTerminal=false\nNoDisplay=true\nMimeType={MIME};\n"
    ))
}

pub fn status() -> Result<String> {
    let output = std::process::Command::new("xdg-mime")
        .args(["query", "default", MIME])
        .output()?;
    ensure!(output.status.success(), "xdg-mime query failed");
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

pub fn install() -> Result<()> {
    ensure!(
        crate::shared::handoff::experiment("nativeLaunch"),
        "nativeLaunch experiment is disabled"
    );
    let executable = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)?;
    let executable = std::fs::canonicalize(executable)?;
    let text = desktop_entry(&executable)?;
    let dir = dirs::data_dir()
        .context("XDG data directory unavailable")?
        .join("applications");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(ID);
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o644)
        .open(&path)
    {
        Ok(mut file) => file.write_all(text.as_bytes())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            ensure!(
                std::fs::symlink_metadata(&path)?.is_file()
                    && std::fs::read_to_string(&path)? == text,
                "{} already exists with different contents; inspect it before replacing",
                path.display()
            );
        }
        Err(error) => return Err(error.into()),
    }
    // Portals discover URI handlers through this cache, not only mimeapps.list.
    let result = std::process::Command::new("update-desktop-database")
        .arg(&dir)
        .status()
        .context("install desktop-file-utils (update-desktop-database) and retry registration")?;
    ensure!(result.success(), "desktop MIME cache could not be updated");
    let result = std::process::Command::new("xdg-mime")
        .args(["default", ID, MIME])
        .status()?;
    ensure!(
        result.success() && status()? == ID,
        "desktop did not select the Apparent launch handler"
    );
    println!("{ID}: {}", executable.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_uses_one_argument_and_no_shell() {
        assert!(
            desktop_entry(Path::new("/home/user/Apps/Apparent.AppImage"))
                .unwrap()
                .contains("Exec=/home/user/Apps/Apparent.AppImage launch %u\n")
        );
        for path in [
            "relative",
            "/home/user/My Apps/Apparent.AppImage",
            "/tmp/a%f",
            "/tmp/a\nb",
            "/tmp/a\"b",
            "/tmp/$HOME",
            "/tmp/`command`",
            "/tmp/a\\b",
        ] {
            assert!(desktop_entry(Path::new(path)).is_err(), "accepted {path:?}");
        }
    }
}
