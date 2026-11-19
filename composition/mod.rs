pub(crate) use crate::permission_admission::repair as permission_repair;
pub(crate) mod cli;

pub(crate) fn run() -> anyhow::Result<()> {
    use crate::capture::desktop;
    use clap::Parser;

    #[cfg(target_os = "linux")]
    desktop::linux::prepare_process();
    if std::env::var_os("APPARENT_BENCH_START").is_some() {
        desktop::run_start_benchmark();
        return Ok(());
    }
    let cli = cli::Cli::parse();
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let reading_capture = cli.reads_capture();
    let result = cli::run_cli(cli);
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if reading_capture && let Err(error) = &result {
        eprintln!("Error: {error:?}\n\nUnexpected error? Run `apparent feedback --help` to draft a report.");
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
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod worker;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod feedback {
    use std::{path::PathBuf, process::Command, time::Duration};

    use anyhow::{Context, Result, bail};
    use clap::{Args, ValueEnum};
    use serde_json::{Value, json};
    pub(crate) use crate::permission_admission::PermissionIntent;

    use super::worker;

    #[derive(Clone, Copy, ValueEnum)]
    enum Kind {
        Feedback,
        Bug,
    }

    #[derive(Args)]
    #[command(
        after_help = "Send in one call with --submit. When sending on someone's\nbehalf, show them the exact title and body and get approval.\n\nOptional local preview:\n  apparent feedback --kind bug --title 'Zoom rejects 1:05' \\\n    --body 'Expected 65 seconds. Zoom rejected the timestamp.'\n\nInclude what you tried, what you expected, and what happened.\nOmit private paths, capture contents, and credentials."
    )]
    pub(crate) struct FeedbackArgs {
        #[arg(long, value_enum, default_value = "feedback", help = "Report category")]
        kind: Kind,
        #[arg(long, help = "Short report title")]
        title: String,
        #[arg(long, help = "Report text. Omit credentials and private content")]
        body: String,
        #[arg(
            long,
            help = "Send to Apparent's PostHog project. The default is a local JSON preview"
        )]
        submit: bool,
    }

    pub(crate) fn command(args: FeedbackArgs) -> Result<()> {
        let source = concat!(
            include_str!("../agent/feedback/report.ts"),
            "\nconsole.log(JSON.stringify(await main()));\n"
        );
        let input = json!({
            "kind": match args.kind { Kind::Feedback => "feedback", Kind::Bug => "bug" },
            "title": args.title,
            "body": args.body,
            "submit": args.submit,
            "token": option_env!("APPARENT_POSTHOG_TOKEN"),
            "build": env!("APPARENT_VERSION_LABEL"),
            "environment": env!("APPARENT_REPORTING_ENVIRONMENT"),
        });
        let node = worker::bundled_node()?.unwrap_or_else(|| PathBuf::from("node"));
        let input = worker::private_input(&serde_json::to_vec(&input)?)?;
        let reply = worker::run_with_input(
            Command::new(node)
                .env("ELECTRON_RUN_AS_NODE", "1")
                .env_remove("NODE_OPTIONS")
                .args(["--input-type=module-typescript", "--eval", source]),
            input,
            Duration::from_secs(10),
            64 * 1024,
        )
        .context(
            "Could not complete feedback command; it requires the bundled runtime or Node.js 22.23+",
        )?;
        let reply: Value =
            serde_json::from_slice(&reply).context("Invalid feedback worker response")?;
        if let Some(error) = reply["error"].as_str() {
            bail!("{error}");
        }
        println!("{reply}");
        Ok(())
    }
}

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

pub(crate) mod settings_permissions {
    use crate::permission_admission::{Row, project_rows};
    use crate::permission_facts::{Grants, Permission};

    use crate::shared::handoff::{Config, load_config_from};
    use serde_json::{Value, json};
    pub(crate) use crate::permission_admission::PermissionIntent;
    use std::collections::BTreeSet;
    use std::path::Path;
    use std::time::{Duration, Instant};

    #[derive(Default)]
    pub(crate) struct PermissionsPresenter {
        pending: Option<(u32, PermissionIntent, Instant)>,
        reopen: Option<u32>,
        effects: crate::permission_native::Effects,
    }

    pub(crate) enum Outcome {
        Reply(u32, Option<&'static str>),
        Reopen,
    }

    impl PermissionsPresenter {
        pub(crate) fn take_reopen_request(&mut self) -> Option<u32> {
            self.reopen.take()
        }

        pub(crate) fn waiting(&self) -> bool {
            self.pending.is_some()
        }

        pub(crate) fn begin(
            &mut self,
            request: u32,
            intent: PermissionIntent,
        ) -> Result<(), &'static str> {
            if self.waiting() {
                return Err("busy");
            }
            self.pending = Some((request, intent, Instant::now()));
            Ok(())
        }

        pub(crate) fn expire(&mut self) -> Option<u32> {
            let (request, _, since) = self.pending?;
            if since.elapsed() < Duration::from_secs(3) {
                return None;
            }
            self.pending = None;
            Some(request)
        }

        pub(crate) fn observe(
            &mut self,
            grants: &Grants,
            requested: &mut BTreeSet<Permission>,
            config_path: &Path,
        ) -> Option<Outcome> {
            if let Some(request) = self.expire() {
                return Some(Outcome::Reply(request, Some("unavailable")));
            }
            if !grants.is_current() {
                return None;
            }
            self.effects.observe(grants);
            let (request, intent, since) = self.pending?;
            if grants.observed_at? < since {
                return None;
            }
            if matches!(intent, PermissionIntent::Recheck) {
                self.pending = None;
                return Some(Outcome::Reply(request, None));
            }
            let config = load_config_from(config_path);
            let selected = rows(Some(grants), requested, &config).find(|row| match intent {
                PermissionIntent::Reopen => row.relaunch,
                PermissionIntent::Repair { permission, repair } =>
                    row.permission == permission && repair.matches(row.repair),
                PermissionIntent::Recheck => false,
            });
            if let Some(request) = self.expire() {
                return Some(Outcome::Reply(request, Some("unavailable")));
            }
            if !grants.is_current() { return None; }
            self.pending = None;
            let Some(row) = selected else { return Some(Outcome::Reply(request, Some("changed"))); };
            if matches!(intent, PermissionIntent::Reopen) {
                self.reopen = Some(request);
                return Some(Outcome::Reopen);
            }
            let error = match self.effects.perform(row.permission, row.repair) {
                Ok(()) => {
                    requested.insert(row.permission);
                    None
                }
                Err(error) => {
                    crate::capture::engine::runtime::apparent_log(format!("Permissions: {error:#}"));
                    Some("failed")
                }
            };
            Some(Outcome::Reply(request, error))
        }

    }

    pub(crate) use crate::permission_native::{platform, restart};

    fn rows<'a>(
        grants: Option<&'a Grants>,
        requested: &'a BTreeSet<Permission>,
        config: &'a Config,
    ) -> impl Iterator<Item = Row> + 'a {
        project_rows(
            platform(),
            grants,
            requested,
            config.microphone_enabled.unwrap_or(true),
            config,
            false,
        )
    }

    pub(crate) fn state(
        grants: Option<&Grants>,
        requested: &BTreeSet<Permission>,
        config_path: &Path,
    ) -> Value {
        let config = load_config_from(config_path);
        let rows: Vec<_> = rows(grants, requested, &config).collect();
        json!({"type": "permission-state", "state": {"platform": platform(), "rows": rows}})
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn recheck_requires_an_observation_started_after_the_request() {
            let mut presenter = PermissionsPresenter::default();
            let mut grants = Grants {
                observed_at: Some(Instant::now()),
                ..Grants::default()
            };
            let mut requested = BTreeSet::new();
            let path = Path::new("");
            presenter.begin(1, PermissionIntent::Recheck).unwrap();
            assert!(presenter.observe(&grants, &mut requested, path).is_none());
            grants.observed_at = Some(Instant::now());
            assert!(matches!(
                presenter.observe(&grants, &mut requested, path),
                Some(Outcome::Reply(1, None))
            ));
        }

        #[test]
        fn a_late_observation_cannot_take_an_expired_action() {
            let mut presenter = PermissionsPresenter {
                pending: Some((
                    1,
                    PermissionIntent::Reopen,
                    Instant::now() - Duration::from_secs(4),
                )),
                ..PermissionsPresenter::default()
            };
            let grants = Grants {
                observed_at: Some(Instant::now()),
                ..Grants::default()
            };
            assert!(matches!(
                presenter.observe(&grants, &mut BTreeSet::new(), Path::new("")),
                Some(Outcome::Reply(1, Some("unavailable")))
            ));
            assert!(!presenter.waiting());
        }
    }


}
