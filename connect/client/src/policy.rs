//! Bounded private stdio/runtime mechanics shared by Connect TypeScript workflows.
use super::*;

pub(super) fn shares_typescript_runtime() -> Result<(PathBuf, PathBuf, bool)> {
    connect_typescript_runtime("shares")
}

pub(super) fn connect_typescript_runtime(name: &str) -> Result<(PathBuf, PathBuf, bool)> {
    let installed = std::env::current_exe()?
        .parent()
        .context("Missing application directory")?
        .to_path_buf();
    #[cfg(target_os = "macos")]
    let (runtime, module) = (
        installed.join("../Resources/settings/runtime/Electron.app/Contents/MacOS/Electron"),
        installed.join(format!(
            "../Resources/settings/app/connect-client/dist/{name}.js"
        )),
    );
    #[cfg(target_os = "linux")]
    let (runtime, module) = (
        installed.join("../share/apparent/settings/runtime/electron"),
        installed.join(format!(
            "../share/apparent/settings/app/connect-client/dist/{name}.js"
        )),
    );
    if runtime.is_file() {
        ensure!(
            module.is_file(),
            "Packaged Connect shares TypeScript module is missing"
        );
        return Ok((runtime, module, true));
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("typescript");
    #[cfg(not(test))]
    let module = development.join(format!("dist/{name}.js"));
    #[cfg(test)]
    let module = if development.join(format!("dist/{name}.js")).is_file() {
        development.join(format!("dist/{name}.js"))
    } else {
        development.join(format!("src/{name}.ts"))
    };
    #[cfg(target_os = "macos")]
    let runtime = development.join("../../../capture/desktop/ui/frontend/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
    #[cfg(target_os = "linux")]
    let runtime = development
        .join("../../../capture/desktop/ui/frontend/node_modules/electron/dist/electron");
    if runtime.is_file() && module.is_file() {
        return Ok((runtime, module, true));
    }
    ensure!(
        module.is_file(),
        "Connect shares TypeScript package is missing; build/stage the Connect client"
    );
    let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|path| path.join("node"))
        .find(|path| path.is_file())
        .context("Electron Node runtime or supported Node.js runtime is missing")?;
    Ok((node, module, false))
}

// Native pipe mechanics only: absolute frame deadline and pre-allocation bound.
pub(super) fn policy_frame(output: &mut std::process::ChildStdout) -> Result<String> {
    policy_frame_bounded(output, Duration::from_secs(30), 64 * 1024 * 1024 + 1024)
}
pub(super) fn policy_frame_bounded(
    output: &mut std::process::ChildStdout,
    timeout: Duration,
    limit: usize,
) -> Result<String> {
    let deadline = Instant::now() + timeout;
    let mut bytes = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(!remaining.is_zero(), "Shares policy response timed out");
        let mut fd = libc::pollfd {
            fd: output.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let ready =
            unsafe { libc::poll(&mut fd, 1, remaining.as_millis().min(30_000).max(1) as i32) };
        if ready < 0 && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
            continue;
        }
        ensure!(ready > 0, "Shares policy response timed out");
        let mut chunk = [0u8; 8192];
        let count = output.read(&mut chunk)?;
        ensure!(count > 0, "Shares policy exited without a result");
        ensure!(
            bytes.len() + count <= limit,
            "Oversized shares policy frame"
        );
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(end) = chunk[..count].iter().position(|b| *b == b'\n') {
            ensure!(end == count - 1, "Compound shares policy frame");
            return String::from_utf8(bytes).context("Invalid shares policy encoding");
        }
    }
}
pub(super) fn policy_write(input: &mut std::process::ChildStdin, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    ensure!(
        bytes.len() <= 2_000_032,
        "Oversized shares transport response"
    );
    let flags = unsafe { libc::fcntl(input.as_raw_fd(), libc::F_GETFL) };
    ensure!(
        flags >= 0
            && unsafe { libc::fcntl(input.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                >= 0,
        "Shares pipe setup failed"
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut offset = 0;
    while offset < bytes.len() {
        ensure!(Instant::now() < deadline, "Shares policy write timed out");
        match input.write(&bytes[offset..]) {
            Ok(0) => bail!("Shares policy input closed"),
            Ok(count) => offset += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => (),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                let mut fd = libc::pollfd {
                    fd: input.as_raw_fd(),
                    events: libc::POLLOUT,
                    revents: 0,
                };
                unsafe {
                    libc::poll(&mut fd, 1, 20);
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(super) fn policy_exit(child: &mut std::process::Child) -> Result<std::process::ExitStatus> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        ensure!(Instant::now() < deadline, "Shares policy exit timed out");
        std::thread::sleep(Duration::from_millis(10));
    }
}

pub(super) struct PolicyChild(pub(super) std::process::Child);
impl std::ops::Deref for PolicyChild {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for PolicyChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for PolicyChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

struct Reader {
    client: Client,
    credential: Credential,
}

#[derive(Deserialize)]
#[serde(tag = "$")]
enum ReaderRoute {
    Use { index: usize },
    Report { index: usize },
    Retry,
    Unavailable,
}

impl Client {
    pub(super) fn resolve_reader(
        &self,
        base: &str,
        wait: u64,
        deadline: Instant,
    ) -> Result<Option<(Client, Credential, Value)>> {
        let profiles = self.reader_profiles()?;
        if profiles.is_empty() {
            return Ok(None);
        }
        let configured = self.settings().server;
        let server = if configured.is_empty() {
            settings::DEFAULT_SERVER
        } else {
            configured.as_str()
        };
        let server = server_url(server)?;
        let mut readers = Vec::new();
        for (_, client) in profiles {
            if let Ok(credential) = client.read_credential()
                && credential.server == server
            {
                readers.push(Reader { client, credential });
            }
        }
        if readers.is_empty() {
            return Ok(None);
        }
        if let Ok(credential) = self.credential("read", &server) {
            readers.insert(
                0,
                Reader {
                    client: self.clone(),
                    credential,
                },
            );
        }
        let lookup_deadline = if wait == 0 {
            Instant::now() + Duration::from_secs(30)
        } else {
            deadline
        };
        loop {
            let mut probes = Vec::new();
            for reader in &readers {
                let timeout = lookup_deadline.saturating_duration_since(Instant::now());
                if timeout.is_zero() {
                    break;
                }
                probes.push(reader.client.json_request(
                    &reader.credential.server,
                    Some(&reader.credential),
                    "GET",
                    base,
                    None,
                    timeout.min(Duration::from_secs(5)),
                    &|| true,
                ));
            }
            let outcomes: Vec<_> = probes
                .iter()
                .map(|probe| match probe {
                    Ok(_) => "found",
                    Err(error) if error.to_string() == "Hosted API: not_found" => "missing",
                    Err(_) => "failed",
                })
                .collect();
            let remaining = deadline.saturating_duration_since(Instant::now());
            let route: ReaderRoute = serde_json::from_value(Self::handoff_policy(json!({
                "operation": "readerRoute", "outcomes": outcomes, "canWait": !remaining.is_zero()
            }))?)?;
            match route {
                ReaderRoute::Use { index } => {
                    let reader = readers.get(index).context("Invalid Connect reader route")?;
                    let manifest = probes
                        .into_iter()
                        .nth(index)
                        .context("Invalid Connect reader result")??;
                    return Ok(Some((
                        reader.client.clone(),
                        reader.credential.clone(),
                        manifest,
                    )));
                }
                ReaderRoute::Report { index } => {
                    return Err(probes
                        .into_iter()
                        .nth(index)
                        .and_then(Result::err)
                        .context("Invalid Connect reader failure")?);
                }
                ReaderRoute::Unavailable => bail!("Hosted API: not_found"),
                ReaderRoute::Retry => {
                    std::thread::sleep(Duration::from_millis(500).min(remaining));
                    if Instant::now() >= deadline {
                        bail!("Hosted API: not_found");
                    }
                }
            }
        }
    }
}

impl Client {
    pub(super) fn handoff_policy(request: Value) -> Result<Value> {
        Self::run_public_policy("handoff", request)
    }
    pub fn account_presentation(facts: Value) -> Result<Value> {
        Self::run_public_policy("account/cli", facts)
    }
    fn run_public_policy(name: &str, request: Value) -> Result<Value> {
        let (runtime, module, electron) = connect_typescript_runtime(name)?;
        let mut command = Command::new(runtime);
        if electron { command.env("ELECTRON_RUN_AS_NODE", "1"); }
        else if module.extension().is_some_and(|extension| extension == "ts") {
            command.arg("--experimental-strip-types");
        }
        let mut child = PolicyChild(command.arg(module)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?);
        let mut input = child.stdin.take().context("Missing Connect policy input")?;
        let mut output = child.stdout.take().context("Missing Connect policy output")?;
        policy_write(&mut input, &request)?;
        drop(input);
        let line = policy_frame_bounded(&mut output, Duration::from_secs(3), 16_384)?;
        ensure!(policy_exit(&mut child)?.success(), "Connect policy failed");
        Ok(serde_json::from_str(&line)?)
    }
    pub fn alternatives() -> Result<String> {
        Self::handoff_policy(json!({"operation":"alternatives"}))?
            .as_str().map(str::to_owned).context("Invalid Connect alternatives")
    }
}
