pub mod model;
pub mod context;
pub mod semantics;
pub mod reader;

/// Format the existing inspect surface without changing the bundle or fetching media.
pub fn inspect(dir: &std::path::Path, bundle: &model::ApparentBundle, json: bool, marks: bool, agent_context: bool) -> anyhow::Result<String> {
    if dir.join(".evidence-only.json").exists() {
        eprintln!("Evidence snapshot: video/audio not downloaded. Use apparent fetch <id> --media --out <new-directory> for the complete recording.");
    }
    if marks {
        let entries = context::mark_entries(bundle);
        if json {
            let list: Vec<_> = entries.iter().map(|e| e.json()).collect();
            Ok(format!("{}\n", serde_json::to_string_pretty(&list)?))
        } else if entries.is_empty() { Ok("No marks\n".into()) }
        else { Ok(entries.iter().map(|e| format!("{}\n", e.line())).collect()) }
    } else if json { Ok(format!("{}\n", serde_json::to_string_pretty(bundle)?)) }
    else { Ok(semantics::summary_markdown_with(bundle, dir, agent_context)) }
}

pub mod recognition;
