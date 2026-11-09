//! Native observations only: no lesson stages, progression or presentation decisions.
use serde::Serialize;
use serde_json::{Value, json};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capture {
    pub generation: String,
    pub capture_id: String,
    pub request_id: Option<String>,
}
impl Capture {
    pub fn new(generation: u64, capture_id: &str, request_id: Option<&str>) -> Self {
        Self { generation: generation.to_string(), capture_id: capture_id.into(), request_id: request_id.map(str::to_owned) }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Observation {
    pub attempt: String,
    pub sequence: u64,
    pub capture: Option<Capture>,
    pub phase: &'static str,
    pub board_visible: bool,
    pub board_ink: bool,
    pub screen_ink: usize,
    pub note_saved: bool,
}

#[derive(Debug)]
pub(crate) struct Facts {
    scope: Value,
    attempt: u64,
    pub observation: Option<Observation>,
    pub completion: Option<Value>,
    pub opened_bundle: Option<Value>,
    opened_sequence: u64,
}
impl Facts {
    pub fn new(session: u64, transport: u64) -> Self {
        Self { scope: json!({"session":session.to_string(),"transport":transport.to_string()}), attempt: 1,
            observation: None, completion: None, opened_bundle: None, opened_sequence: 0 }
    }
    pub fn attempt(&self) -> String { self.attempt.to_string() }
    pub fn scope(&self) -> &Value { &self.scope }
    pub fn reset(&mut self) {
        self.attempt += 1;
        self.observation = None;
        self.completion = None;
        self.opened_bundle = None;
    }
    pub fn begin(&mut self, phase: &'static str) {
        let selecting = self.observation.as_ref().is_some_and(|o| o.phase == "selecting");
        if phase != "recording" || !selecting { self.attempt += 1; }
        self.observation = Some(Observation { attempt: self.attempt(), sequence: 0, capture: None, phase,
            board_visible: false, board_ink: false, screen_ink: 0, note_saved: false });
        self.completion = None;
        self.opened_bundle = None;
    }
    pub fn identity(&mut self, capture: Capture) {
        if let Some(o) = self.observation.as_mut() {
            if o.capture.is_none() { o.capture = Some(capture); o.sequence += 1; }
        }
    }
    pub fn observe(&mut self, board: bool, screen: usize, processing: bool) {
        if let Some(o) = self.observation.as_mut() {
            if self.completion.is_some() || o.phase == "cancelled" { return; }
            let phase = if processing { "processing" } else { o.phase };
            if (o.board_ink, o.screen_ink, o.phase) != (board, screen, phase) {
                o.board_ink = board; o.screen_ink = screen; o.phase = phase; o.sequence += 1;
            }
        }
    }
    pub fn board(&mut self, visible: bool) {
        if let Some(o) = self.observation.as_mut() {
            if o.board_visible != visible { o.board_visible = visible; o.sequence += 1; }
        }
    }
    pub fn note(&mut self, saved: bool) {
        if let Some(o) = self.observation.as_mut() {
            if saved && !o.note_saved { o.note_saved = true; o.sequence += 1; }
        }
    }
    pub fn cancel(&mut self) {
        if self.completion.is_none() {
            if let Some(o) = self.observation.as_mut() { o.phase = "cancelled"; o.sequence += 1; }
        }
    }
    pub fn complete(&mut self, capture: Capture, bundle: Option<&Path>, clipboard: Option<bool>) {
        if self.completion.is_some() || !self.matches(&capture) { return; }
        self.completion = Some(json!({"capture":capture,"current":true,
            "outcome":match bundle { Some(path) => json!({"kind":"saved","bundlePath":path}), None => json!({"kind":"failed","message":"Capture failed"}) },
            "clipboard":match clipboard { Some(true) => "copied", Some(false) => "failed", None => "notRequested" }}));
    }
    pub fn opened(&mut self, path: &Path) {
        if self.completion.as_ref().and_then(|v| v["outcome"]["bundlePath"].as_str()) != path.to_str() { return; }
        self.opened_sequence += 1;
        self.opened_bundle = Some(json!({"sequence":self.opened_sequence,"bundlePath":path}));
    }
    pub fn matches(&self, capture: &Capture) -> bool {
        self.observation.as_ref().and_then(|o|o.capture.as_ref()) == Some(capture)
    }
    pub fn view(&self) -> Value {
        json!({"version":1,"scope":self.scope,"attempt":self.attempt(),"observation":self.observation,
            "completion":self.completion,"openedBundle":self.opened_bundle})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observations_retain_receipts_without_interpreting_lesson_stages() {
        let capture = Capture::new(7,"capture-a",Some("request-a"));
        let mut facts = Facts::new(1,2); facts.begin("recording"); facts.identity(capture.clone());
        facts.board(true); facts.observe(true,3,false); facts.note(true);
        facts.complete(capture.clone(),Some(Path::new("/synthetic/a.apparent")),Some(true));
        let receipt = facts.completion.clone();
        facts.complete(capture,None,Some(false)); facts.cancel();
        assert_eq!(facts.completion,receipt);
        assert_eq!(facts.view()["completion"]["clipboard"],"copied");
        assert_eq!(facts.view()["observation"]["noteSaved"],true);
        assert!(facts.view().get("stage").is_none());
        facts.opened(Path::new("/other.apparent")); assert!(facts.opened_bundle.is_none());
        facts.opened(Path::new("/synthetic/a.apparent")); let first=facts.view()["openedBundle"]["sequence"].as_u64().unwrap();
        facts.opened(Path::new("/synthetic/a.apparent")); assert!(facts.view()["openedBundle"]["sequence"].as_u64().unwrap()>first);
    }
    #[test]
    fn old_capture_receipts_cannot_replace_a_new_native_attempt() {
        let mut facts=Facts::new(1,2); facts.begin("recording"); facts.identity(Capture::new(7,"a",None));
        facts.reset(); facts.begin("recording"); facts.identity(Capture::new(8,"b",None));
        facts.complete(Capture::new(7,"a",None),Some(Path::new("/a.apparent")),Some(true));
        assert!(facts.completion.is_none());
        facts.complete(Capture::new(8,"b",None),None,Some(true));
        assert_eq!(facts.view()["completion"]["outcome"]["kind"],"failed");
        assert!(facts.view()["completion"]["outcome"].get("bundlePath").is_none());
    }
}
