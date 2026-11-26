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

impl Client {
    pub fn style_source(&self, bundle: &Path) -> Option<String> {
        if let Ok(bytes) = read_private(&bundle.join(".connect-style.json"), 256) {
            let receipt: Value = serde_json::from_slice(&bytes).ok()?;
            return receipt["captureId"].as_str().filter(|id| valid_id(id)).map(str::to_owned);
        }
        if !self.provider.experiment(SPEAKING_STYLE) || !self.enabled() {
            return None;
        }
        let path = bundle.canonicalize().ok()?;
        let job = self.jobs().ok()?.into_iter().find(|job| {
            job.bundle == path && job.speaking_style && job.encrypted && self.active(job)
        })?;
        Some(job.id)
    }

    pub fn visit_style_transcripts(&self, id: &str, profile: Option<&str>, local: Option<&Path>, mut visit: impl FnMut(&str, usize) -> Result<bool>) -> Result<()> {
        ensure!(valid_id(id), "Expected a Connect capture ID");
        let base = format!("/v1/captures/{id}");
        let reader = match profile {
            Some("default") => self.clone(),
            Some(name) => self.named_reader(name)?,
            None => self.resolve_reader(&base, 0, Instant::now())?
                .map(|(client, _, _)| client).unwrap_or_else(|| self.clone()),
        };
        let credential = reader.read_credential()?;
        let current = || reader.read_credential().is_ok_and(|c| c.generation == credential.generation && c.server == credential.server);
        let response = reader.json_request(&credential.server, Some(&credential), "GET",
            &format!("{base}/style-history"), None, Duration::from_secs(15), &current)?;
        let budget = response["tokenBudget"].as_u64().filter(|n| (1..=1024).contains(n))
            .context("Invalid Connect transcript budget")? as usize;
        let ids: Vec<String> = serde_json::from_value(response["ids"].clone())?;
        ensure!(ids.len() <= 12 && ids.iter().all(|other| valid_id(other) && other != id), "Invalid Connect history");
        let read = |source: &str| -> Result<Value> {
            ensure!(current(), "Connect reader changed");
            let scratch = Scratch::new(&reader.state)?;
            let out = scratch.0.join("transcript");
            reader.fetch_inner(source, &out, 0, Some(&["apparent.json".into()]), false)?;
            ensure!(current(), "Connect reader changed");
            let metadata = out.join("apparent.json");
            if source == id && let Some(path) = local {
                ensure!(digest_file(&metadata)? == digest_file(&path.join("apparent.json"))?, "Local recording does not match this Connect capture");
            }
            Ok(serde_json::from_reader(File::open(metadata)?)?)
        };
        if ids.is_empty() { return Ok(()); }
        let anchor = read(id)?;
        let current_id = anchor["id"].as_str().context("Missing recording ID")?;
        for candidate in ids {
            let manifest = match read(&candidate) {
                Ok(value) => value,
                Err(error) if matches!(error.to_string().as_str(), "Hosted API: not_found" | "encryption_decrypt_failed" | "encryption_sender_revoked_or_unapproved") => continue,
                Err(error) => return Err(error),
            };
            let recording = manifest["id"].as_str().context("Missing recording ID")?;
            if recording != current_id && let Some(text) = manifest["transcript"]["text"].as_str() && visit(text, budget)? {
                break;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{Fixture, Server};

    #[test]
    fn hosted_activity_real_typescript_and_authenticated_transport() {
        let f=Fixture::new();
        let server=Server::new("upload");
        f.authorize(&server.url);
        let before=fs::read(&f.client.config).unwrap();
        f.client.recording_activity(true,f.client.recording_account()).unwrap();
        assert_eq!(server.state.lock().unwrap().requests,0,"practice must never send");
        f.client.recording_activity(false,f.client.recording_account()).unwrap();
        assert_eq!(server.state.lock().unwrap().request_routes,["POST /v1/activity/recording-started"]);
        fs::remove_file(f.client.state.join("upload.credential")).unwrap();
        fs::remove_file(f.client.state.join("read.credential")).unwrap();
        f.client.recording_activity(false,f.client.recording_account()).unwrap();
        assert_eq!(server.state.lock().unwrap().requests,1,"signed-out must never send");
        assert_eq!(fs::read(&f.client.config).unwrap(),before,"activity must never enable upload/config permissions");
    }

    #[test]
    fn hosted_activity_pins_account_before_background_worker() {
        let f=Fixture::new();let server=Server::new("upload");
        let signed_out=f.client.recording_account();assert!(signed_out.is_none());
        f.authorize(&server.url);
        f.client.recording_activity(false,signed_out).unwrap();
        assert_eq!(server.state.lock().unwrap().requests,0,"late sign-in cannot claim an earlier start");
        let old=f.client.recording_account();assert!(old.is_some());
        let mut replacement=f.client.credential("upload",&server.url).unwrap();
        replacement.generation="b".repeat(32);
        atomic_json(&f.client.state.join("upload.credential"),&replacement).unwrap();
        assert!(f.client.recording_activity(false,old).is_err());
        assert_eq!(server.state.lock().unwrap().requests,0,"account replacement revokes the pinned start");
        let current=f.client.recording_account();
        f.client.settings_disable(true).unwrap();
        let before=server.state.lock().unwrap().requests;
        assert!(f.client.recording_activity(false,current).is_err());
        assert_eq!(server.state.lock().unwrap().requests,before,"disconnect revokes an already observed start");
    }
}
