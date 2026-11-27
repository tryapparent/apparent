use crate::composition::worker;
use std::{process::Command, time::Duration};

pub(crate) fn circle_label<const READ_TEXT: bool>(
    crop: &crate::shared::model::RgbaFrame,
    points: &[[f32; 2]],
) -> Option<String> {
    use std::io::{Seek, SeekFrom, Write};
    let header = serde_json::to_vec(
        &serde_json::json!({ "width": crop.width, "height": crop.height, "points": points, "readText": READ_TEXT }),
    )
    .ok()?;
    let mut input = worker::private_input(&[]).ok()?;
    input.write_all(&(header.len() as u32).to_le_bytes()).ok()?;
    input.write_all(&header).ok()?;
    input.write_all(&crop.rgba).ok()?;
    input.seek(SeekFrom::Start(0)).ok()?;
    let (node, script) =
        worker::policy_assets("Circle recognition", "record-media", "circle/worker.js").ok()?;
    let output = worker::run_with_input(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(script),
        input,
        Duration::from_secs(5),
        2048,
    )
    .ok()?;
    let label: String = serde_json::from_slice(&output).ok()?;
    (!label.is_empty() && label.len() <= 512 && !label.chars().any(char::is_control))
        .then_some(label)
}
