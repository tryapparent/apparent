use super::{encoder, host_distro, init, movie_output};
use anyhow::{Context, Result, anyhow, bail, ensure};
use gstreamer as gst;
use gstreamer::prelude::*;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub fn encoder_warning() -> Option<String> {
    static CHECK: OnceLock<std::result::Result<(), String>> = OnceLock::new();
    CHECK
        .get_or_init(|| {
            check_encoder().map_err(|error| {
                encoder_diagnostic(
                    &error,
                    std::env::var_os("APPIMAGE").is_some(),
                    &host_distro(),
                )
            })
        })
        .as_ref()
        .err()
        .cloned()
}

fn check_encoder() -> Result<()> {
    init()?;
    let selected = encoder().context("No H.264 encoder plugin is installed")?;
    let directory = preflight_directory()?;
    let movie = directory.join("encoder-check.mp4");
    let result = encode_synthetic(&movie, selected, true);
    let _ = std::fs::remove_file(&movie);
    let _ = std::fs::remove_dir(directory);
    result
}

fn preflight_directory() -> Result<PathBuf> {
    for attempt in 0..16 {
        let directory = std::env::temp_dir().join(format!(
            "apparent-encoder-check-{}-{}-{attempt}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        ));
        match std::fs::DirBuilder::new().mode(0o700).create(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    bail!("Could not create a private H.264 encoder-check directory")
}

fn encoder_repair_for(distro: &str) -> &'static str {
    match distro {
        "arch" | "archarm" | "omarchy" | "manjaro" | "endeavouros" => {
            "sudo pacman -S gst-plugins-ugly"
        }
        "ubuntu" | "debian" | "linuxmint" | "pop" => "sudo apt install gstreamer1.0-plugins-ugly",
        "fedora" => "sudo dnf install gstreamer1-plugins-ugly",
        _ => "Install your distribution's GStreamer H.264 encoder (often gst-plugins-ugly)",
    }
}

fn encoder_diagnostic(reason: &anyhow::Error, packaged: bool, distro: &str) -> String {
    use std::io::ErrorKind::{QuotaExceeded, StorageFull};
    let storage = match reason
        .downcast_ref::<std::io::Error>()
        .map(std::io::Error::kind)
    {
        Some(StorageFull) => Some("temporary storage is full"),
        Some(QuotaExceeded) => Some("temporary storage quota was exceeded"),
        _ => None,
    };
    if let Some(storage) = storage {
        return format!(
            "H.264 preflight failed because {storage}. Free space or set TMPDIR to a writable location with more space, then restart Apparent. No recording was started."
        );
    }
    if packaged {
        format!(
            "H.264 encoder failed in this Apparent AppImage ({reason}). Install a fresh Apparent AppImage; host GStreamer packages cannot repair its bundled runtime. No recording was started."
        )
    } else {
        format!(
            "H.264 encoder failed ({reason}). Install: {}. Restart Apparent, then retry. No recording was started.",
            encoder_repair_for(distro)
        )
    }
}

fn encoder_storage_error(error: &gst::glib::Error, debug: &str) -> Option<std::io::Error> {
    use gst::ResourceError::{NoSpaceLeft, OpenReadWrite, OpenWrite, Write};
    let errno = match error.kind::<gst::ResourceError>() {
        Some(NoSpaceLeft) => Some(libc::ENOSPC),
        Some(OpenReadWrite | OpenWrite | Write) => {
            [libc::ENOSPC, libc::EDQUOT].into_iter().find(|&errno| {
                let detail = unsafe { std::ffi::CStr::from_ptr(gst::glib::ffi::g_strerror(errno)) };
                debug
                    .trim_end()
                    .ends_with(detail.to_string_lossy().as_ref())
            })
        }
        _ => None,
    };
    errno.map(std::io::Error::from_raw_os_error)
}

pub fn encode_check_movie(movie: &Path) -> Result<()> {
    init()?;
    let selected = encoder().ok_or_else(|| anyhow!("No H.264 encoder plugin is installed"))?;
    encode_synthetic(movie, selected, false)
}

fn encode_synthetic(movie: &Path, selected: &str, diagnose: bool) -> Result<()> {
    let output = movie_output();
    let launch = format!(
        "videotestsrc num-buffers=12 ! video/x-raw,width=160,height=90,framerate=10/1 ! videoconvert ! video/x-raw,format=I420 ! {selected} ! h264parse ! {output} name=encoder_output"
    );
    let pipeline = gst::parse::launch(&launch)?
        .downcast::<gst::Pipeline>()
        .map_err(|_| anyhow!("Not a pipeline"))?;
    pipeline
        .by_name("encoder_output")
        .context("Encoder pipeline has no output sink")?
        .set_property("location", movie.to_string_lossy().as_ref());
    let result = (|| {
        let bus = pipeline.bus().context("Encoder pipeline has no bus")?;
        let state = pipeline.set_state(gst::State::Playing);
        let wait = if state.is_ok() {
            gst::ClockTime::from_seconds(10)
        } else {
            gst::ClockTime::ZERO
        };
        match bus.timed_pop_filtered(wait, &[gst::MessageType::Eos, gst::MessageType::Error]) {
            Some(message) => match message.view() {
                gst::MessageView::Eos(..) => Ok(()),
                gst::MessageView::Error(error) => {
                    let detail = error.debug().unwrap_or_default();
                    let cause = error.error();
                    if diagnose {
                        let debug = safe_encoder_debug(&detail, movie);
                        let domain = cause.domain().as_str();
                        let code = cause.code();
                        let source = error
                            .src()
                            .map(|source| safe_encoder_field(&source.name()))
                            .unwrap_or_else(|| "unknown".to_owned());
                        crate::capture::engine::runtime::apparent_log(format!(
                            "H.264 encoder preflight failed stage=synthetic_encode domain={domain} code={code} source={source} debug={debug} output=encoder-check.mp4"
                        ));
                    }
                    let writing_movie = error
                        .src()
                        .and_then(|source| source.downcast_ref::<gst::Element>())
                        .and_then(|element| element.factory())
                        .is_some_and(|factory| {
                            matches!(factory.name().as_str(), "mp4mux" | "filesink")
                        });
                    if writing_movie && let Some(storage) = encoder_storage_error(&cause, &detail) {
                        return Err(storage).context("H.264 encoding failed");
                    }
                    bail!(
                        "H.264 encoding failed: {}",
                        safe_encoder_debug(cause.message(), movie)
                    );
                }
                _ => unreachable!(),
            },
            None => {
                state?;
                bail!("H.264 encoding timed out");
            }
        }
    })();
    let _ = pipeline.set_state(gst::State::Null);
    result?;
    ensure!(
        std::fs::metadata(movie)?.len() > 1024,
        "H.264 movie is empty"
    );
    Ok(())
}

fn safe_encoder_field(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(160)
        .collect()
}

fn safe_encoder_debug(value: &str, movie: &Path) -> String {
    let mut safe = value.to_owned();
    if let Some(parent) = movie.parent() {
        safe = safe.replace(&parent.to_string_lossy().to_string(), "<private-temp>");
    }
    if let Some(home) = std::env::var_os("HOME") {
        safe = safe.replace(&home.to_string_lossy().to_string(), "<home>");
    }
    safe_encoder_field(&safe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoder_repair_names_the_host_package_without_installing_it() {
        assert_eq!(
            encoder_repair_for("arch"),
            "sudo pacman -S gst-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("omarchy"),
            "sudo pacman -S gst-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("ubuntu"),
            "sudo apt install gstreamer1.0-plugins-ugly"
        );
        assert_eq!(
            encoder_repair_for("fedora"),
            "sudo dnf install gstreamer1-plugins-ugly"
        );
        assert!(encoder_repair_for("other").contains("distribution"));
        assert!(
            encoder_diagnostic(&anyhow!("not found"), false, "omarchy")
                .contains("sudo pacman -S gst-plugins-ugly")
        );
        let packaged = encoder_diagnostic(&anyhow!("not found"), true, "omarchy");
        assert!(packaged.contains("fresh Apparent AppImage"));
        assert!(!packaged.contains("sudo pacman"));
    }

    #[test]
    fn encoder_preflight_uses_a_private_directory() {
        use std::os::unix::fs::PermissionsExt;
        let directory = preflight_directory().unwrap();
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(!directory.join("encoder-check.mp4").exists());
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn synthetic_encoder_preflight_classifies_a_missing_output_parent() {
        if init().is_err() {
            return;
        }
        let Some(selected) = encoder() else {
            return;
        };
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let movie = std::env::temp_dir().join(format!(
            "apparent-dev-encoder-diagnostics-{}-{nonce}/missing/encoder-check.mp4",
            std::process::id()
        ));
        let result = encode_synthetic(&movie, selected, true);
        assert!(
            result.is_err(),
            "filesink must refuse an output whose parent is missing"
        );
        assert!(!movie.exists());
    }

    #[test]
    fn encoder_debug_redacts_private_output_and_home_paths() {
        let movie = std::env::temp_dir().join("private/output.mp4");
        let detail = format!(
            "Could not write {} under {}",
            movie.display(),
            std::env::var("HOME").unwrap_or_default()
        );
        let safe = safe_encoder_debug(&detail, &movie);
        assert!(!safe.contains("private/output.mp4"));
        if let Ok(home) = std::env::var("HOME") {
            assert!(!safe.contains(&home));
        }
        assert!(safe.contains("<private-temp>"));
        assert!(safe.chars().count() <= 160);
    }

    #[test]
    fn encoder_storage_warning_distinguishes_space_and_quota() {
        for (errno, reason) in [
            (libc::ENOSPC, "storage is full"),
            (libc::EDQUOT, "quota was exceeded"),
        ] {
            let error = anyhow::Error::new(std::io::Error::from_raw_os_error(errno));
            let warning = encoder_diagnostic(&error, true, "omarchy");
            assert!(warning.contains(reason), "{warning}");
            assert!(warning.contains("TMPDIR"), "{warning}");
            assert!(!warning.contains("Install"), "{warning}");
        }
    }

    #[test]
    fn quota_detail_survives_gstreamer_resource_write_mapping() {
        let resource = gst::glib::Error::new(gst::ResourceError::Write, "Failed to write");
        let quota = unsafe { std::ffi::CStr::from_ptr(gst::glib::ffi::g_strerror(libc::EDQUOT)) };
        let debug = format!("system error: {}", quota.to_string_lossy());
        assert_eq!(
            encoder_storage_error(&resource, &debug).unwrap().kind(),
            std::io::ErrorKind::QuotaExceeded
        );
        assert!(encoder_storage_error(&resource, "Input/output error").is_none());
    }

    #[test]
    fn synthetic_gstreamer_probe_preserves_output_capacity_failure() {
        init().unwrap();
        let Some(selected) = encoder() else { return };
        let error = encode_synthetic(Path::new("/dev/full"), selected, true).unwrap_err();
        let warning = encoder_diagnostic(&error, true, "omarchy");
        assert!(warning.contains("temporary storage is full"), "{warning}");
    }
}
