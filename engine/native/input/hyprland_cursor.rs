use super::Monitor;

#[derive(serde::Deserialize)]
struct CursorPos {
    x: f64,
    y: f64,
}

pub(super) fn to_x_space(
    point: [f64; 2],
    layout: &[Monitor],
    x_monitors: &[(String, [f64; 4])],
) -> Option<(f64, f64)> {
    let monitor = layout.iter().find(|m| {
        let (width, height) = m.layout_size();
        point[0] >= m.x && point[0] < m.x + width && point[1] >= m.y && point[1] < m.y + height
    })?;
    let (_, rect) = x_monitors.iter().find(|(name, _)| *name == monitor.name)?;
    let factor = rect[2] / monitor.layout_size().0;
    Some((
        rect[0] + (point[0] - monitor.x) * factor,
        rect[1] + (point[1] - monitor.y) * factor,
    ))
}

pub(super) fn read(
    request: impl Fn(&str) -> anyhow::Result<String>,
    x_monitors: &[(String, [f64; 4])],
) -> Option<(f64, f64)> {
    if let Ok(reply) = request("[[BATCH]] j/cursorpos;j/monitors")
        && let Some((cursor, layout)) = reply.split_once("\n\n\n")
        && let (Ok(cursor), Ok(layout)) = (
            serde_json::from_str::<CursorPos>(cursor),
            serde_json::from_str::<Vec<Monitor>>(layout),
        )
    {
        return to_x_space([cursor.x, cursor.y], &layout, x_monitors);
    }
    let cursor: CursorPos = serde_json::from_str(&request("j/cursorpos").ok()?).ok()?;
    let layout: Vec<Monitor> = serde_json::from_str(&request("j/monitors").ok()?).ok()?;
    to_x_space([cursor.x, cursor.y], &layout, x_monitors)
}
