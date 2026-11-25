pub fn pin_pill_for_process(
    xid: u32,
    pid: u32,
    take_focus: impl FnOnce() -> bool,
    still_current: impl Fn() -> bool,
) -> Result<()> {
    let compositor = syntax()?;
    if let Some(command) = pill_pin_command(&request("j/clients")?, pid, xid, compositor)?
        && still_current()
    {
        run(&command)?;
    }
    if compositor == Syntax::Lua && still_current() && take_focus() {
        let title = pill_title(xid);
        if let Err(error) = run(&format!(
            "eval local windows = hl.get_windows({{ title = '{title}', mapped = true }}); \
             local w = windows[1]; if #windows == 1 and w.pid == {pid} and w.xwayland \
             then hl.dispatch(hl.dsp.focus({{ window = w }})) end"
        )) {
            crate::capture::engine::runtime::apparent_log(format!("Pill focus acquisition failed: {error:#}"));
        }
    }
    Ok(())
}
