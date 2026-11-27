pub(crate) use crate::permission_admission::repair as permission_repair;
pub(crate) mod cli;
#[cfg(target_os = "linux")]
#[path = "../engine/native/desktop/record_start_error.rs"]
pub(crate) mod record_error;

mod preferences {
    use anyhow::{Context, Result, ensure};
    use clap::{Args, Subcommand};
    use serde_json::{Value, json};

    use crate::shared::handoff::{
        default_config_path, preference_state, preferences, read_preferences, write_preference,
    };

    #[derive(Args)]
    pub(super) struct Settings {
        #[arg(long, global = true)]
        json: bool,
        #[arg(long, global = true)]
        confirm_cleanup: bool,
        #[command(subcommand)]
        command: Command,
    }

    #[derive(Subcommand)]
    enum Command {
        List { pane: Option<String> },
        Get { id: String },
        Set { id: String, value: String },
        Reset { id: String },
    }

    fn available(entry: &Value) -> bool {
        #[cfg(target_os = "linux")]
        let wayland = crate::capture::desktop::linux::wayland_session();
        #[cfg(not(target_os = "linux"))]
        let wayland = false;
        entry["platforms"].as_array().is_none_or(|platforms| {
            platforms.iter().any(|platform| {
                platform == std::env::consts::OS || (wayland && platform == "wayland")
            })
        })
    }

    fn state(entry: &Value, config: &Value) -> Value {
        use crate::capture::engine::runtime::recording::recorder::selection;
        use crate::permission_admission::ScreenSelection;

        let id = entry["id"].as_str().unwrap();
        let (saved, mut source) = preference_state(config, id);
        let available = available(entry);
        let requested = saved.as_ref().unwrap_or(&entry["default"]);
        let mut system_status = None;
        let effective = match (available, id) {
            (false, _) => Value::Null,
            (true, "storage.maximumMb") => json!(super::retention::storage_limit(config)),
            (true, "storage.mediaDays") => json!(crate::capture::engine::bundle::retention::Policy::from_config(config).media_days),
            (true, "storage.bundleDays") => json!(crate::capture::engine::bundle::retention::Policy::from_config(config).bundle_days),
            (true, selection::PREFERENCE) => {
                json!(selection::selection_for_saved(saved.as_ref().and_then(Value::as_bool)) == ScreenSelection::FullDisplay)
            }
            (true, "storage.capturesDir") => {
                let (path, origin) = crate::shared::handoff::capture_location::effective_path_for_cli(config);
                if origin == "environment" { source = "system-override"; }
                json!(path)
            }
            (true, "labs.recordingPerformance") => json!(crate::capture::desktop::workflow::performance::generation(config).is_some()),
            (true, "general.errorReporting") if source == "invalid" ||
                config.get("errorReportingGeneration").is_some_and(|value| value.as_str().is_none_or(|value| value.len() > 128)) => Value::Bool(false),
            (true, "general.recordShortcut" | "general.pasteShortcut") => {
                let (value, overridden) = crate::capture::desktop::settings::shortcut_state_for_cli(config, id);
                if overridden { source = "system-override"; }
                value
            }
            (true, "general.launchAtLogin") => {
                use crate::capture::desktop::settings::{LoginItem, login_item};
                let (status, actual) = match login_item() {
                    LoginItem::On => ("registered", Some(true)),
                    LoginItem::Off => ("off", Some(false)),
                    LoginItem::NeedsApproval => ("approval-required", Some(false)),
                    LoginItem::Unavailable => ("unavailable", None),
                };
                system_status = Some(status);
                json!(actual)
            }
            (true, "labs.agentContext") if requested == true => {
                let access = crate::capture::desktop::settings::desktop_access(false);
                system_status = Some(access);
                requested.clone()
            }
            _ => requested.clone(),
        };
        let mut result = entry.clone();
        result.as_object_mut().unwrap().remove("legacy");
        if id == selection::PREFERENCE && available {
            result["default"] = json!(selection::selection_for_saved(None) == ScreenSelection::FullDisplay);
        }
        result["present"] = json!(saved.is_some() || source == "invalid");
        result["saved"] = saved.map_or(Value::Null, |value| {
            if entry["effect"] == "shortcut" {
                crate::capture::desktop::settings::shortcut_public_value(value)
            } else {
                crate::recording_preferences::public_value(id, value)
            }
        });
        result["effective"] = crate::recording_preferences::public_value(id, effective);
        result["source"] = json!(source);
        result["available"] = json!(available);
        if let Some(status) = system_status { result["systemStatus"] = json!(status); }
        result
    }

    pub(super) fn run(args: Settings) -> Result<()> {
        let path = default_config_path();
        let catalog = preferences();
        let find = |id: &str| catalog.iter().find(|entry| entry["id"] == id).context("Unknown preference");
        let result = match args.command {
            Command::List { pane } => {
                let config = read_preferences(&path)?;
                let matched: Vec<_> = catalog.iter().filter(|entry| {
                    pane.as_deref().is_none_or(|pane| {
                        entry["pane"].as_str().or_else(|| entry["id"].as_str()?.split_once('.').map(|(group, _)| group)) == Some(pane)
                    })
                }).map(|entry| state(entry, &config)).collect();
                ensure!(pane.is_none() || !matched.is_empty(), "Unknown pane");
                json!(matched)
            }
            Command::Get { id } => state(find(&id)?, &read_preferences(&path)?),
            Command::Set { ref id, .. } | Command::Reset { ref id } => {
                let entry = find(id)?;
                ensure!(available(entry), "Unsupported platform");
                let value = match &args.command {
                    Command::Set { value, .. } => Some(serde_json::from_str(value).context("Expected JSON value")?),
                    _ => None,
                };
                match entry["effect"].as_str() {
                    None | Some("agentContext" | "loginItem") => write_preference(&path, id, value)?,
                    Some("recordingPerformance") => crate::capture::desktop::workflow::performance::set_preference(&path, value)?,
                    Some("pushToTalk") => {
                        #[cfg(target_os = "linux")]
                        ensure!(value != Some(Value::Bool(true)) || crate::capture::desktop::settings::shortcut::push_to_talk_supported(), "Push to talk requires the app-managed Record shortcut");
                        write_preference(&path, id, value)?;
                    }
                    Some("errorReporting") => {
                        let on = value.as_ref().map(|value| value.as_bool().context("Expected boolean")).transpose()?;
                        crate::capture::desktop::workflow::error_reporting::set_preference(&path, on)?;
                    }
                    Some("recording") => crate::recording_preferences::set_from_cli(&path, id, value)?,
                    Some("shortcut") => crate::capture::desktop::settings::set_shortcut_for_cli(&path, id, value)?,
                    Some("captureLocation") => {
                        let folder = value.as_ref().map(|value| value.as_str().context("Expected folder path")).transpose()?;
                        crate::shared::handoff::capture_location::set_in(&path, folder, None, || true).map_err(anyhow::Error::msg)?;
                    }
                    Some("retention") => {
                        ensure!(args.confirm_cleanup, "Pass --confirm-cleanup");
                        super::retention::set_preference(&path, id, value)?;
                    }
                    Some(_) => anyhow::bail!("Unsupported effect"),
                }
                state(entry, &read_preferences(&path)?)
            }
        };
        println!("{}", if args.json { result.to_string() } else { format!("{result:#}") });
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
const FEEDBACK_HINT: &str = "Confusing behavior or workaround? Draft a note with `apparent feedback --help`.";

pub(crate) fn run() -> anyhow::Result<()> {
    use crate::capture::desktop;
    use clap::Parser;

    #[cfg(target_os = "linux")]
    desktop::linux::prepare_process();
    if std::env::var_os("APPARENT_BENCH_START").is_some() {
        desktop::run_start_benchmark();
        return Ok(());
    }
    let cli = cli::Cli::try_parse().unwrap_or_else(|error| {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if error.use_stderr() {
            let _ = error.print();
            eprintln!("\n{FEEDBACK_HINT}");
            std::process::exit(error.exit_code());
        }
        error.exit()
    });
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let reading_capture = cli.reads_capture();
    let result = cli::run_cli(cli);
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if reading_capture && let Err(error) = &result {
        eprintln!("Error: {error:?}\n\n{FEEDBACK_HINT}");
        std::process::exit(1);
    }
    result
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod hermes {
    use crate::capture::desktop::workflow::launch_url::open_hermes_trusted;
    use anyhow::Result;
    use clap::Subcommand;

    #[derive(Subcommand)]
    pub(super) enum HermesCommand {
        #[command(about = "Read first-run setup status without opening Apparent")]
        Status,
        #[command(
            about = "Start one token-bound local recording and return its signed result to Hermes"
        )]
        Record { destination: String },
    }

    pub(super) fn run(command: HermesCommand) -> Result<()> {
        match command {
            HermesCommand::Status => {
                println!("{}", serde_json::json!({ "schema": 1, "status": "ready" }));
                Ok(())
            }
            HermesCommand::Record { destination } => open_hermes_trusted(&destination),
        }
    }
}
pub(crate) mod command_line;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod agent_range;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod assembly;
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "../engine/recording/media/policy.rs"]
mod record_policy;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod issues;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod media_probe;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod retention;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod movie_frames;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod screen_frames;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod transcript;
pub(crate) use assembly::{frame_labels, transcript_handoff};
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod worker;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) use issues::feedback;

#[cfg(test)]
mod cli_contracts {
    use super::cli::Cli;
    use clap::Parser;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn hosted_connect_is_canonical_in_help_and_usage() {
        let help = Cli::try_parse_from(["apparent", "--help"])
            .err()
            .unwrap()
            .to_string();
        assert!(
            help.lines()
                .any(|line| line.trim_start().starts_with("connect ")),
            "{help}"
        );
        assert!(
            !help
                .lines()
                .any(|line| line.trim_start().starts_with("cloud ")),
            "{help}"
        );
        for name in ["connect", "cloud"] {
            for tail in [
                vec!["--help"],
                vec!["login", "--help"],
                vec!["upload", "--help"],
                vec!["retry", "--help"],
            ] {
                let mut args = vec!["apparent", name];
                args.extend(tail);
                let error = Cli::try_parse_from(args).err().unwrap();
                assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
                assert!(!error.use_stderr());
                let text = error.to_string();
                assert!(text.contains("apparent connect"), "{text}");
                assert!(!text.contains("apparent cloud"), "{text}");
            }
            let error = Cli::try_parse_from(["apparent", name, "login"])
                .err()
                .unwrap()
                .to_string();
            assert!(
                error.contains("apparent connect login --server <SERVER>"),
                "{error}"
            );
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn hosted_connect_and_cloud_parse_identical_commands_and_flags() {
        use clap::CommandFactory;
        for tail in [
            vec!["login", "--server", "https://hosted.tryapparent.com"],
            vec![
                "login",
                "--server",
                "https://hosted.tryapparent.com",
                "--scope",
                "read",
                "--no-browser",
            ],
            vec![
                "login",
                "--server",
                "https://hosted.tryapparent.com",
                "--scope",
                "upload",
                "--consent-upload",
                "--no-browser",
            ],
            vec!["status"],
            vec!["status", "--account"],
            vec!["logout"],
            vec!["disable"],
            vec!["retry"],
            vec!["retry", "--id", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            vec!["upload", "./synthetic capture.apparent"],
            vec!["shares", "list"],
            vec!["shares", "revoke", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        ] {
            let parse = |name| {
                let mut args = vec!["apparent", name];
                args.extend(tail.iter().copied());
                Cli::try_parse_from(&args).unwrap();
                let matches = Cli::command().try_get_matches_from(args).unwrap();
                assert_eq!(matches.subcommand_name(), Some("connect"));
                matches.subcommand().unwrap().1.clone()
            };
            assert_eq!(parse("connect"), parse("cloud"), "{tail:?}");
        }
        for name in ["connect", "cloud"] {
            for tail in [
                vec!["login"],
                vec![
                    "login",
                    "--server",
                    "https://hosted.tryapparent.com",
                    "--scope",
                    "admin",
                ],
                vec!["status", "--consent-upload"],
                vec!["upload"],
            ] {
                let mut args = vec!["apparent", name];
                args.extend(tail);
                assert!(Cli::try_parse_from(args).is_err());
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn capture_owned_start_and_wait_parser() {
        for args in [
            vec!["apparent", "capture", "start", "--wait", "--timeout", "30"],
            vec![
                "apparent",
                "capture",
                "stop",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "--wait",
                "--timeout",
                "60",
            ],
            vec![
                "apparent",
                "capture",
                "inspect",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ],
        ] {
            assert!(Cli::try_parse_from(&args).is_ok(), "{args:?}");
        }
        for timeout in ["0", "3601", "bad"] {
            assert!(
                Cli::try_parse_from(["apparent", "capture", "start", "--timeout", timeout])
                    .is_err()
            );
            assert!(
                Cli::try_parse_from([
                    "apparent",
                    "capture",
                    "stop",
                    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "--timeout",
                    timeout
                ])
                .is_err()
            );
        }
        for command in ["start", "stop", "inspect"] {
            let error = Cli::try_parse_from(["apparent", "capture", command, "--help"])
                .err()
                .unwrap();
            assert_eq!(error.kind(), clap::error::ErrorKind::DisplayHelp);
            assert!(!error.use_stderr());
        }
    }

    #[test]
    fn cli_identifies_as_apparent() {
        assert_eq!(
            <Cli as clap::CommandFactory>::command().get_name(),
            "apparent"
        );
    }

    #[test]
    fn timed_record_help_discloses_missing_interaction_telemetry() {
        use clap::CommandFactory;
        let mut command = Cli::command();
        let mut help = Vec::new();
        command
            .find_subcommand_mut("record")
            .unwrap()
            .write_long_help(&mut help)
            .unwrap();
        let help = String::from_utf8(help).unwrap();
        assert!(
            help.contains("does not collect clicks or Shift ink"),
            "{help}"
        );
        assert!(help.contains("app's recording shortcut"), "{help}");
    }
}

pub(crate) fn observe_permissions() -> Option<crate::permission_facts::Grants> {
    use crate::capture::desktop::helper;
    crate::permission_facts::observe(
        helper::permissions,
        #[cfg(target_os = "macos")]
        helper::screen_permission,
    )
}

#[path = "../engine/permissions/settings.rs"]
pub(crate) mod settings_permissions;

#[cfg(target_os = "linux")]
pub(crate) use retention::check_preference_compatibility;
