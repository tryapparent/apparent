//! Native credential/transport adapter for the TypeScript activity decision.
use super::*;
use std::sync::atomic::{AtomicBool,Ordering};
static IN_FLIGHT:AtomicBool=AtomicBool::new(false);
struct Admission;
impl Drop for Admission {fn drop(&mut self){IN_FLIGHT.store(false,Ordering::Release);}}
pub(super) type RecordingAccount=Option<(String,Credential,Option<String>)>;
impl Client {
    pub(super) fn recording_account(&self)->RecordingAccount {
        let server=self.settings().server;
        let credential=self.credential("upload",&server).or_else(|_|self.credential("read",&server)).ok()?;
        if !credential.usable()||self.revocation_pending(){return None;}
        Some((server,credential,self.cancellation().ok()?))
    }
    /// Pin the observed account before detaching. No later sign-in can claim an
    /// earlier start; disconnect/account replacement revokes this admission.
    pub fn observe_recording_start(&self, practice:bool) {
        if IN_FLIGHT.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return;}
        let account=self.recording_account();
        let client=self.clone();
        if std::thread::Builder::new().name("apparent-activity".into()).spawn(move||{
            let _admission=Admission;
            let _=client.recording_activity(practice,account);
        }).is_err(){IN_FLIGHT.store(false,Ordering::Release);}
    }
    pub(super) fn recording_activity(&self,practice:bool,account:RecordingAccount)->Result<()> {
        let (runtime,module,electron)=connect_typescript_runtime("activity/index")?;
        let mut command=Command::new(runtime);
        if electron{command.env("ELECTRON_RUN_AS_NODE","1");}
        else if module.extension().is_some_and(|s|s=="ts"){command.arg("--experimental-strip-types");}
        let mut child=PolicyChild(command.arg(module).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?);
        let mut input=child.stdin.take().context("Activity input unavailable")?;
        let mut output=child.stdout.take().context("Activity output unavailable")?;
        policy_write(&mut input,&json!({"recording":true,"practice":practice,"connected":account.is_some()}))?;
        drop(input);
        let line=policy_frame_bounded(&mut output,Duration::from_secs(3),128)?;
        let decision:Value=serde_json::from_str(&line)?;
        ensure!(policy_exit(&mut child)?.success(),"Activity policy unavailable");
        if decision==json!({"operation":"skip"}){return Ok(());}
        ensure!(decision==json!({"operation":"recording-started"}),"Invalid activity capability");
        let (server,credential,cancellation)=account.context("Account required")?;
        let allowed=||!self.revocation_pending()&&self.settings().server==server
            &&self.cancellation().is_ok_and(|epoch|epoch==cancellation)
            &&self.credential(&credential.scope,&server).is_ok_and(|current|current.generation==credential.generation);
        self.json_request(&server,Some(&credential),"POST","/v1/activity/recording-started",Some(json!({})),Duration::from_secs(3),&allowed)?;
        Ok(())
    }
}

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
