//! Composition adapter for Record's admission policy. Native capture never waits
//! for this process: its closure runs on the inference worker after PCM starts.
pub(crate) fn admission() -> Box<dyn FnOnce() -> anyhow::Result<bool> + Send> {
    Box::new(|| {
        use std::io::{Read, Write};
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};
        let resources = super::electron::resolve()?;
        let mut child = Command::new(resources.executable)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(resources.root.join("electron/notes/record-transcription.cjs"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
        let outcome = (|| {
            let mut input = child.stdin.take().ok_or_else(|| anyhow::anyhow!("Missing admission input"))?;
            serde_json::to_writer(&mut input, &serde_json::json!({"enabled":true,"platform":std::env::consts::OS}))?;
            input.write_all(b"\n")?; drop(input);
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                if let Some(status) = child.try_wait()? {anyhow::ensure!(status.success(), "Admission unavailable"); break;}
                anyhow::ensure!(Instant::now() < deadline, "Admission timed out");
                std::thread::sleep(Duration::from_millis(10));
            }
            let mut output = String::new();
            child.stdout.take().ok_or_else(|| anyhow::anyhow!("Missing admission output"))?.take(2049).read_to_string(&mut output)?;
            anyhow::ensure!(output.len() <= 2048, "Oversized admission");
            let value: serde_json::Value = serde_json::from_str(&output)?;
            anyhow::ensure!(value["version"] == 1, "Invalid admission");
            Ok(value["streaming"].as_bool().unwrap_or(false))
        })();
        let _ = child.kill(); let _ = child.wait();
        outcome
    })
}
