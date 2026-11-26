use super::*;

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn hermes_receiver_setup_preserves_explicit_activation_boundaries() {
    let parsed = Cli::try_parse_from([
        "apparent",
        "setup",
        "hermes",
        "--receiver",
        "--profile",
        "/synthetic/profile",
        "--enable",
        "--verify-runtime",
        "--hermes-executable",
        "/synthetic/hermes",
    ])
    .unwrap();
    assert!(matches!(
        parsed.command,
        Some(Command::Setup {
            command: SetupCommand::Hermes {
                receiver: true,
                enable: true,
                verify_runtime: true,
                ..
            }
        })
    ));
    assert!(Cli::try_parse_from(["apparent", "setup", "hermes", "--receiver"]).is_err());
    assert!(
        Cli::try_parse_from([
            "apparent",
            "setup",
            "hermes",
            "--receiver",
            "--profile",
            "/synthetic/profile",
            "--check",
            "--enable"
        ])
        .is_err()
    );
    assert!(
        Cli::try_parse_from([
            "apparent",
            "setup",
            "hermes",
            "--receiver",
            "--profile",
            "/synthetic/profile",
            "--check",
            "--verify-runtime"
        ])
        .is_err()
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn trusted_hermes_record_and_background_launch_are_separate_cli_contracts() {
    assert!(matches!(
        Cli::try_parse_from([
            "apparent",
            "hermes",
            "record",
            "0123456789abcdef0123456789abcdef/45000"
        ])
        .unwrap()
        .command,
        Some(Command::Hermes {
            command: HermesCommand::Record { .. }
        })
    ));
    assert!(matches!(
        Cli::try_parse_from(["apparent", "launch", "--background"])
            .unwrap()
            .command,
        Some(Command::Launch {
            background: true,
            url: None
        })
    ));
    assert!(
        Cli::try_parse_from(["apparent", "launch", "--background", "apparent://open"]).is_err()
    );
}

#[test]
fn passive_screen_permission_command_is_distinct_from_capture_probe() {
    assert!(matches!(
        Cli::try_parse_from(["apparent", "screen-permission-status"])
            .unwrap()
            .command,
        Some(Command::ScreenPermissionStatus)
    ));
    assert!(Cli::try_parse_from(["apparent", "screen-permission-status", "--watch", "1"]).is_err());
    let help = Cli::try_parse_from(["apparent", "--help"])
        .err()
        .unwrap()
        .to_string();
    assert!(!help.contains("screen-permission-status"));
}

#[test]
fn copy_confirmation_does_not_imply_visuals_reached_the_agent() {
    let confirmation = copy_confirmation(std::path::Path::new("/captures/example.apparent"));
    assert!(confirmation.contains("contact-sheet.png"), "{confirmation}");
    assert!(confirmation.contains("Paste"), "{confirmation}");
    assert!(confirmation.contains("check the draft"), "{confirmation}");
}

#[test]
fn export_cli_requires_explicit_audio_choices_to_be_unambiguous() {
    for args in [
        vec!["apparent", "export", "capture.apparent", "--no-audio"],
        vec![
            "apparent",
            "export",
            "capture.apparent",
            "--narration",
            "cues.json",
        ],
    ] {
        assert!(Cli::try_parse_from(args).is_ok());
    }
    for args in [
        vec!["apparent", "export", "--narration"],
        vec![
            "apparent",
            "export",
            "--no-audio",
            "--narration",
            "cues.json",
        ],
        vec!["apparent", "export", "--no-audio=false"],
    ] {
        assert!(Cli::try_parse_from(args).is_err());
    }
}

#[test]
fn hosted_cli_requires_explicit_model_and_voice() {
    assert!(
        Cli::try_parse_from([
            "apparent",
            "export",
            "source.apparent",
            "--narration",
            "cues.json",
            "--openrouter-tts",
            "speechify/simba-3.5",
            "--openrouter-voice",
            "alec",
        ])
        .is_ok()
    );
    assert!(
        Cli::try_parse_from([
            "apparent",
            "export",
            "source.apparent",
            "--narration",
            "cues.json",
            "--openrouter-tts",
            "speechify/simba-3.5",
        ])
        .is_err()
    );
    assert!(
        Cli::try_parse_from([
            "apparent",
            "reprocess",
            "source.apparent",
            "--out",
            "new.apparent",
            "--openrouter-stt",
            "microsoft/mai-transcribe-2",
            "--bench",
            "2",
        ])
        .is_err()
    );
    assert!(Cli::try_parse_from(["apparent", "openrouter-key", "--stdin", "--remove",]).is_err());
}

#[test]
fn export_cli_speedup_defaults_on_and_can_be_disabled() {
    for (args, expected) in [
        (vec!["apparent", "export", "capture.apparent"], false),
        (
            vec!["apparent", "export", "capture.apparent", "--no-speedup"],
            true,
        ),
    ] {
        let cli = Cli::try_parse_from(args).unwrap();
        let Some(Command::Export { no_speedup, .. }) = cli.command else {
            panic!("export");
        };
        assert_eq!(no_speedup, expected);
    }
}

#[test]
fn export_cli_zooms_by_default_and_no_zoom_opts_out() {
    for (args, expected) in [
        (vec!["apparent", "export", "capture.apparent"], true),
        (
            vec!["apparent", "export", "capture.apparent", "--no-zoom"],
            false,
        ),
    ] {
        let cli = Cli::try_parse_from(args).unwrap();
        let Some(Command::Export { zoom, crop, .. }) = cli.command else {
            panic!("expected export command");
        };
        assert_eq!(zoom, expected);
        assert_eq!(crop, export::crop::CropArg::Full);
    }
    assert!(Cli::try_parse_from(["apparent", "export", "capture.apparent", "--zoom"]).is_err());
    use clap::CommandFactory;
    let mut command = Cli::command();
    let help = command
        .find_subcommand_mut("export")
        .unwrap()
        .render_long_help()
        .to_string();
    assert!(help.contains("--no-zoom"));
    assert!(
        !help.contains("--zoom"),
        "retired flag must not appear in help: {help}"
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn trace_cli_uses_canonical_names_without_paths_and_rejects_app_launch() {
    for args in [
        ["apparent", "--trace", "example", "inspect", "/private/synthetic"],
        ["apparent", "inspect", "/private/synthetic", "--trace", "example"],
    ] {
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.trace.as_deref(), Some("example"));
        assert_eq!(trace_cli::operation(cli.command.as_ref()), Some("inspect"));
    }

    let cli = Cli::try_parse_from(["apparent", "--trace", "example", "app"]).unwrap();
    assert!(trace_cli::operation(cli.command.as_ref()).is_none());
    assert!(run_cli(cli).unwrap_err().to_string().contains("does not support workflow tracing"));
}
