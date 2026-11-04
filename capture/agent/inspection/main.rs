use std::path::PathBuf;
use clap::Parser;

/// Read a local .apparent bundle. Remote IDs require apparent connect/fetch.
#[derive(Parser)]
struct Args {
    #[arg(default_value = "latest")]
    bundle: PathBuf,
    #[arg(long)]
    json: bool,
    #[arg(long)]
    marks: bool,
    #[arg(long = "experiment")]
    experiments: Vec<String>,
}
fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    let config_path = dirs::home_dir().unwrap_or_default().join(".config/apparent/config.json");
    let config: serde_json::Value = std::fs::read(config_path).ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    let captures = std::env::var_os("APPARENT_CAPTURES_DIR").map(PathBuf::from)
        .or_else(|| config["capturesDir"].as_str().and_then(|s| {
            let s = s.trim();
            let path = if s == "~" || s.starts_with("~/") {
                dirs::home_dir()?.join(s.trim_start_matches('~').trim_start_matches('/'))
            } else { PathBuf::from(s.trim()) };
            path.is_absolute().then_some(path)
        }))
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                dirs::home_dir().unwrap_or_default().join("Library/Application Support/apparent/captures")
            } else {
                dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("apparent/captures")
            }
        });
    let agent_context = args.experiments.iter().any(|s| s == "agentContext")
        || config["experiments"]["agentContext"].as_bool() == Some(true);
    let (dir, bundle) = apparent_inspect::reader::load_bundle(&args.bundle, &captures)?;
    let output = apparent_inspect::inspect(&dir, &bundle, args.json, args.marks, agent_context)?;
    print!("{output}");
    Ok(())
}
