//! Private native-call adapter. The TypeScript executor owns the lock, fresh
//! read, scoped patch application and durable publication; this adapter never
//! opens or writes the config itself and never acquires a queue lock.
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    os::unix::ffi::OsStrExt,
    path::Path,
    process::{Child, Command, Stdio},
};

const MAX_FRAME: u64 = 32 * 1024 * 1024;
struct Actor(Child);
impl Drop for Actor {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn wire_error(code: &str) -> anyhow::Error {
    match code {
        "cancelled" => anyhow::anyhow!("cancelled"),
        "lock-timeout" => anyhow::anyhow!("Config lock wait timed out"),
        _ => std::io::Error::other("Config transaction failed").into(),
    }
}
fn send(writer: &mut impl Write, value: &Value) -> Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")?;
    writer.flush()?;
    Ok(())
}
fn diff(before: &Value, after: &Value, path: &mut Vec<String>, patches: &mut Vec<Value>) {
    if before == after {
        return;
    }
    if let (Some(before), Some(after)) = (before.as_object(), after.as_object()) {
        for key in before
            .keys()
            .chain(after.keys())
            .collect::<std::collections::BTreeSet<_>>()
        {
            path.push(key.clone());
            match (before.get(key), after.get(key)) {
                (Some(old), Some(new)) => diff(old, new, path, patches),
                (_, Some(value)) => patches.push(json!({"path":path,"present":true,"value":value})),
                (Some(_), None) => patches.push(json!({"path":path,"present":false})),
                _ => (),
            }
            path.pop();
        }
    } else {
        patches.push(json!({"path":path,"present":true,"value":after}));
    }
}

pub(super) fn update(
    path: &Path,
    allowed: Option<&dyn Fn() -> bool>,
    edit: impl FnOnce(&mut Value) -> Result<()>,
) -> Result<()> {
    #[cfg(test)]
    super::config_write_hook("before_lock", path);
    let resources = crate::shared::node_runtime::config_executor()?;
    let child = Command::new(resources.executable)
        .arg(resources.entry)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("Could not start settings transaction runtime")?;
    let mut actor = Actor(child);
    let mut input = actor.0.stdin.take().context("Missing transaction input")?;
    let output = actor
        .0
        .stdout
        .take()
        .context("Missing transaction output")?;
    let mut output = BufReader::new(output);
    let mut editor = Some(edit);
    let mut edit_error = None;
    let mut publication_admission = false;
    let mut preparing_publication = false;
    let mut confirmed = false;
    let result = (|| -> Result<()> {
        send(
            &mut input,
            &json!({"v":1,"op":"begin","path":path.as_os_str().as_bytes(),"guarded":allowed.is_some()}),
        )?;
        loop {
            let mut line = String::new();
            let size = output.by_ref().take(MAX_FRAME + 1).read_line(&mut line)?;
            ensure!(
                size > 0 && size as u64 <= MAX_FRAME && line.ends_with('\n'),
                "Settings transaction interrupted"
            );
            let message: Value =
                serde_json::from_str(&line).context("Invalid settings transaction response")?;
            ensure!(
                message["v"] == 1,
                "Unsupported settings transaction version"
            );
            match message["event"].as_str() {
                Some("admit") => {
                    let admit = edit_error.is_none() && allowed.is_none_or(|check| check());
                    if preparing_publication && admit {
                        publication_admission = true;
                    }
                    send(&mut input, &json!({"v":1,"op":"admit","allowed":admit}))?;
                }
                Some("checkpoint") => {
                    let stage = message["stage"]
                        .as_str()
                        .context("Invalid transaction checkpoint")?;
                    let mut proceed = true;
                    match stage {
                        "snapshot" => {
                            #[cfg(test)]
                            super::config_write_hook("snapshot", path);
                        }
                        "beforePublish" => {
                            preparing_publication = true;
                            #[cfg(test)]
                            super::config_write_hook("before_publish", path);
                        }
                        "beforeDirectorySync" => {
                            publication_admission = true;
                            #[cfg(test)]
                            {
                                super::config_write_hook("before_directory_sync", path);
                                proceed = !super::CONFIG_DIRECTORY_SYNC_FAILURE
                                    .with(|failure| failure.replace(false));
                            }
                        }
                        _ => bail!("Invalid transaction checkpoint"),
                    }
                    send(
                        &mut input,
                        &json!({"v":1,"op":"checkpoint","continue":proceed}),
                    )?;
                }
                Some("snapshot") => {
                    let raw = message["json"]
                        .as_str()
                        .context("Invalid private transaction snapshot")?;
                    let before: Value = serde_json::from_str(raw).context("Invalid config")?;
                    ensure!(before.is_object(), "Config must be an object");
                    let mut after = before.clone();
                    let edit = editor.take().context("Repeated transaction snapshot")?;
                    match edit(&mut after) {
                        Ok(()) => {
                            ensure!(after.is_object(), "Config must remain an object");
                            let mut patches = Vec::new();
                            diff(&before, &after, &mut Vec::new(), &mut patches);
                            send(
                                &mut input,
                                &json!({"v":1,"op":"patch","json":serde_json::to_string(&patches)?}),
                            )?;
                        }
                        Err(error) => {
                            edit_error = Some(error);
                            send(&mut input, &json!({"v":1,"op":"abort"}))?;
                        }
                    }
                }
                Some("result") => {
                    let ok = message["ok"]
                        .as_bool()
                        .context("Invalid transaction result")?;
                    let published = message["published"]
                        .as_bool()
                        .context("Invalid transaction outcome")?;
                    if ok {
                        ensure!(
                            published && editor.is_none() && edit_error.is_none(),
                            "Unverified transaction commit"
                        );
                        confirmed = true;
                        return Ok(());
                    }
                    let error = edit_error.take().unwrap_or_else(|| {
                        wire_error(message["code"].as_str().unwrap_or("invalid-result"))
                    });
                    // Explicit pre-publication failure is authoritative. A lost
                    // receipt after publication admission is conservatively unknown.
                    publication_admission = published;
                    return Err(error);
                }
                _ => bail!("Invalid transaction response"),
            }
        }
    })();
    drop(input);
    if confirmed {
        let exited = actor.0.wait().context("Settings transaction exited after commit");
        match exited {
            Ok(status) if status.success() => result,
            _ => Err(wire_error("interrupted")).context(super::ConfigPublicationUncertain),
        }
    } else if publication_admission {
        result.context(super::ConfigPublicationUncertain)
    } else {
        result
    }
}
