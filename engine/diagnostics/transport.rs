use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};

pub(crate) fn native_payload(
    mut payload: Value,
    diagnostics: Value,
    id: &str,
    metadata: Value,
) -> Value {
    payload["uuid"] = json!(id);
    payload["distinct_id"] = json!(id);
    for name in [
        "build",
        "commit_sha",
        "$app_version",
        "package_version",
        "release_version",
        "channel",
        "environment",
        "build_modified",
    ] {
        payload["properties"][name] = metadata[name].clone();
    }
    payload["properties"]
        .as_object_mut()
        .unwrap()
        .remove("$release_id");
    if metadata["$release_id"]
        .as_str()
        .is_some_and(|id| !id.is_empty())
    {
        payload["properties"]["$release_id"] = metadata["$release_id"].clone();
    }
    payload["properties"]["diagnostics_schema_version"] = json!(9);
    payload["properties"]["$exception_fingerprint"] = json!(format!(
        "desktop:native_process_exit:{}:{}:{}",
        diagnostics["signal"],
        diagnostics["exit_code"],
        diagnostics["last_stage"].as_str().unwrap_or("unknown")
    ));
    payload["properties"]["native_exit"] = diagnostics;
    payload["properties"]["$exception_list"][0]["mechanism"]["handled"] = json!(false);
    payload
}

pub(crate) fn send(endpoint: &str, body: &Value) -> std::io::Result<bool> {
    send_json(endpoint, body, None)
}

pub(crate) fn send_json(endpoint: &str, body: &Value, authorization: Option<&str>) -> std::io::Result<bool> {
    let mut command = Command::new("curl");
    command.arg("--disable");
    if let Some(value) = authorization {
        command.args(["--header", value]);
    }
    let mut child = command
        .args([
            "--silent",
            "--fail",
            "--noproxy",
            "*",
            "--max-time",
            "2",
            "--connect-timeout",
            "1",
            "--max-redirs",
            "0",
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json",
            "--data-binary",
            "@-",
            "--output",
            "/dev/null",
            "--url",
            endpoint,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let result = child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(body)?);
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait()?;
    result?;
    Ok(status.success())
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
