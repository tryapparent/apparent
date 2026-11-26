#[cfg(any(target_os = "macos", target_os = "linux"))]
use anyhow::Context;
use anyhow::Result;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use clap::Subcommand;

#[cfg(any(target_os = "macos", target_os = "linux"))]
use super::CaptureCommand;
use super::{Cli, Command, dispatch};

impl Cli {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(in crate::composition) fn reads_capture(&self) -> bool {
        matches!(
            self.command,
            Some(
                Command::Inspect(_)
                    | Command::Fetch(_)
                    | Command::Frames { .. }
                    | Command::Zoom { .. }
            )
        )
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[derive(Subcommand)]
pub(super) enum TraceCommand {
    #[command(about = "Start a new private trace and print its ID")]
    Start,
    #[command(about = "Print the trace's timing and outcome records as JSON")]
    Report {
        #[arg(value_name = "TRACE_ID")]
        id: String,
    },
    #[command(about = "Close a trace to new attempts")]
    End {
        #[arg(value_name = "TRACE_ID")]
        id: String,
    },
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn operation(command: Option<&Command>) -> Option<&'static str> {
    use super::super::agent_range::VideoCommand;
    Some(match command? {
        Command::Capture { command } => match command {
            CaptureCommand::State => "capture state",
            CaptureCommand::Start { .. } => "capture start",
            CaptureCommand::Stop { .. } => "capture stop",
            CaptureCommand::Cancel { .. } => "capture cancel",
            CaptureCommand::Inspect { .. } => "capture inspect",
            CaptureCommand::Handoff { .. } => "capture handoff",
        },
        Command::Video { command } => match command {
            VideoCommand::Narrator => "video narrator",
            VideoCommand::Inspect { .. } => "video inspect",
            VideoCommand::Render { .. } => "video render",
        },
        Command::Demo { .. } => "demo",
        Command::Import { .. } => "import",
        Command::Inspect(_) => "inspect",
        Command::Frames { .. } => "frames",
        Command::Zoom { .. } => "zoom",
        Command::Export { .. } => "export",
        _ => return None,
    })
}

pub(in crate::composition) fn run_cli(cli: Cli) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if let Some(id) = &cli.trace {
        let operation = operation(cli.command.as_ref())
            .context("This command does not support workflow tracing; see apparent trace --help")?;
        let pending = crate::workflow_trace::Store::local().begin(id, operation)?;
        let result = dispatch_optional(cli.command);
        if pending.finish(result.is_ok()).is_err() {
            eprintln!("Warning: could not save the workflow trace outcome");
        }
        return result;
    }
    dispatch_optional(cli.command)
}

fn dispatch_optional(command: Option<Command>) -> Result<()> {
    let command = match command {
        Some(command) => command,
        None if cfg!(any(target_os = "macos", target_os = "linux"))
            && std::io::IsTerminal::is_terminal(&std::io::stdin()) =>
        {
            <Cli as clap::CommandFactory>::command().print_help()?;
            return Ok(());
        }
        None => Command::App {
            record: false,
            iphone: false,
        },
    };
    dispatch(command)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn manage(command: TraceCommand) -> Result<()> {
    let store = crate::workflow_trace::Store::local();
    match command {
        TraceCommand::Start => {
            println!("{}", store.start()?);
            Ok(())
        }
        TraceCommand::Report { id } => store.report(&id),
        TraceCommand::End { id } => store.end(&id),
    }
}
