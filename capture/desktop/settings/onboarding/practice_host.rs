//! Native identity/resource adapter; lesson transitions live only in trusted TypeScript.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::VecDeque;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="kebab-case")]
pub enum Stage { #[default] Start, Screen, Whiteboard, BoardInk, Note, ScreenInk, Stop, Preparing, Copied, Paste, Locate, Complete, Retry, CopyFailed }
#[derive(Debug, Default)]
pub struct Practice {
    pub stage: Stage,
    pub latest: bool,
    pub locating: bool,
    pub desktop_stage: bool,
    pub attempt: u64,
    sequence: u64,
    pub pending: VecDeque<Value>,
    pub visibility: Option<bool>,
    pub close_board: Option<String>,
    #[cfg(test)]
    history: Vec<Value>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Disposition {
    #[serde(rename="type")] kind: String,
    version: u8,
    source: String, transport: String, attempt: String, capture: String,
    sequence: String, intent: Option<String>, board: Option<String>,
    stage: Stage, latest: bool, locating: bool, desktop_stage: bool,
    close_board: bool, accepted: bool,
}
impl Practice {
    pub fn batch(&mut self, source:u64, transport:u64, board:Option<String>, events:Vec<Value>, intent:bool)->Value {
        self.sequence+=1;
        let sequence=self.sequence.to_string();
        let batch=json!({"type":"practice-batch","version":1,"source":source.to_string(),"transport":transport.to_string(),
            "attempt":self.attempt.to_string(),"capture":self.attempt.to_string(),"sequence":sequence,
            "intent":if intent {Some(sequence)}else{None},"board":board,"events":events});
        self.pending.push_back(batch.clone());
        #[cfg(test)] self.history.push(batch.clone());
        batch
    }
    fn disposition(&self, value:Value)->Result<Disposition,()> {
        let d:Disposition=serde_json::from_value(value).map_err(|_|())?;
        let b=self.pending.front().ok_or(())?;
        if d.kind!="practice-disposition"||d.version!=1||
            [&d.source,&d.transport,&d.attempt,&d.capture,&d.sequence].into_iter().zip(["source","transport","attempt","capture","sequence"])
                .any(|(v,k)|b[k].as_str()!=Some(v.as_str())) || b["intent"]!=json!(d.intent)||b["board"]!=json!(d.board) {return Err(());}
        Ok(d)
    }
    pub fn acknowledgement(&self, value:&Value)->Result<String,()> {
        Ok(self.disposition(value.clone())?.sequence)
    }
    pub fn admit(&mut self, value:Value)->Result<(bool, String),()> {
        let d=self.disposition(value)?;
        let finish=d.accepted && self.pending.front().unwrap()["events"].as_array().is_some_and(|events|events.iter().any(|e|e["action"]=="practice-finish"));
        self.pending.pop_front();
        if d.attempt==self.attempt.to_string() {
            self.stage=d.stage;self.latest=d.latest;self.locating=d.locating;self.desktop_stage=d.desktop_stage;
            if d.close_board {self.close_board=d.board;}
            Ok((finish,d.sequence))
        } else {Ok((false,d.sequence))}
    }
    #[cfg(test)]
    pub fn test_reply(&self)->Value {
        use std::{io::Write,process::{Command,Stdio}};
        let mut child=Command::new("node").arg("--experimental-strip-types")
            .arg(concat!(env!("CARGO_MANIFEST_DIR"),"/capture/desktop/ui/frontend/tests/onboarding/practice/practice-native.ts"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(&serde_json::to_vec(&self.history).unwrap()).unwrap();
        let output=child.wait_with_output().unwrap();
        assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
        serde_json::from_slice(&output.stdout).unwrap()
    }
}
