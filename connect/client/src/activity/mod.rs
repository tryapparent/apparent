//! Native credential/transport adapter for the TypeScript activity decision.
use super::super::*;
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
