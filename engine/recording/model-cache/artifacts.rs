#[cfg(target_os = "linux")]
use crate::capture::desktop::helper::SpeechModelLine;
#[cfg(target_os = "linux")]
use anyhow::Result;

pub struct Artifact {
    pub filename: &'static str,
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

pub const PARAKEET: Artifact = Artifact {
    filename: "parakeet-unified-en-0.6b-Q8_0.gguf",
    url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/7e948f21b7bdbac698d3318db9d350f1096f3b6c/parakeet-unified-en-0.6b-Q8_0.gguf",
    bytes: 731_357_568,
    sha256: "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795",
};

const PARAKEET_Q4: Artifact = Artifact {
    filename: "parakeet-unified-en-0.6b-Q4_K_M.gguf",
    url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/7e948f21b7bdbac698d3318db9d350f1096f3b6c/parakeet-unified-en-0.6b-Q4_K_M.gguf",
    bytes: 477_274_496,
    sha256: "a8bf3de2b393bd14ead5a858c3748d5e3b07a20fdeabdd3b498fba4f463fa929",
};

pub(crate) fn preferred_parakeet() -> &'static Artifact {
    if cfg!(target_os = "linux") {
        &PARAKEET_Q4
    } else {
        &PARAKEET
    }
}

#[cfg(target_os = "linux")]
pub fn install(stop: &dyn Fn() -> bool, mut line: impl FnMut(SpeechModelLine)) -> Result<()> {
    let installed = super::installed_models();
    let own_dir = super::own_models_dir();
    let preferred = preferred_parakeet();
    let preparing = [preferred.filename, PARAKEET.filename].iter().any(|name| {
        ["", ".partial", ".nightly.partial"]
            .iter()
            .any(|suffix| own_dir.join(format!("{name}{suffix}")).exists())
    });
    let resident = super::resident_final::wants_install(!installed.is_empty(), preparing);
    let report = |status: &str, progress: Option<f64>, error: Option<String>| SpeechModelLine {
        status: status.into(),
        engine: Some(if resident { "Nemotron" } else { "Parakeet" }.into()),
        locale: Some("en".into()),
        locales: None,
        progress,
        error,
    };
    if resident {
        let result = super::resident_final::install(&own_dir, stop, &mut |done| {
            line(report("downloading", Some(done), None));
        });
        if !stop() {
            match result {
                Ok(()) => line(report("installed", Some(1.0), None)),
                Err(error) => line(report("failed", None, Some(format!("{error:#}")))),
            }
        }
        return Ok(());
    }
    let needs_preferred = installed.is_empty()
        || (installed.iter().all(|path| path.starts_with(&own_dir))
            && !installed.iter().any(|path| {
                path.file_name()
                    .is_some_and(|name| name == preferred.filename)
            }));
    if needs_preferred {
        let mut progress = |done: f64| {
            if installed.is_empty() {
                line(report("downloading", Some(done), None));
            }
        };
        if let Err(error) = super::download(preferred, &own_dir, &mut progress) {
            if installed.is_empty() {
                line(report("failed", None, Some(format!("{error:#}"))));
                return Ok(());
            }
            crate::capture::engine::runtime::apparent_log(format!(
                "Preferred local speech model unavailable: {error:#}"
            ));
        }
    }
    line(report("installed", Some(1.0), None));
    Ok(())
}
