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
pub(crate) struct Stroke {
    index: usize,
    points: usize,
    laser: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(crate) struct ScreenInk {
    total: usize,
    recent: Vec<Stroke>,
}
impl ScreenInk {
    /// Callers provide newest first. Bound transport size without qualifying ink.
    pub fn new(total: usize, recent: impl Iterator<Item = (usize, usize, bool)>) -> Self {
        Self { total, recent: recent.take(64).map(|(index, points, laser)| Stroke { index, points, laser }).collect() }
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
    pub board_points: usize,
    pub screen_ink: ScreenInk,
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
            board_visible: false, board_points: 0, screen_ink: ScreenInk::default(), note_saved: false });
        self.completion = None;
        self.opened_bundle = None;
    }
    pub fn identity(&mut self, capture: Capture) {
        if let Some(o) = self.observation.as_mut() {
            if o.capture.is_none() { o.capture = Some(capture); o.sequence += 1; }
        }
    }
    pub fn observe(&mut self, board: usize, screen: ScreenInk, processing: bool) {
        if let Some(o) = self.observation.as_mut() {
            if self.completion.is_some() || o.phase == "cancelled" { return; }
            let phase = if processing { "processing" } else { o.phase };
            if o.board_points != board || o.screen_ink != screen || o.phase != phase {
                o.board_points = board; o.screen_ink = screen; o.phase = phase; o.sequence += 1;
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
        json!({"version":2,"scope":self.scope,"attempt":self.attempt(),"observation":self.observation,
            "completion":self.completion,"openedBundle":self.opened_bundle})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "provider integration: requires generated onboarding policy and the locked Electron runtime"]
    fn onboarding_electron_rust_roundtrip() {
        use std::{io::{Read, Write}, os::unix::{net::UnixStream, io::OwnedFd}, process::{Command, Stdio}, time::Duration};
        // The process/pipe deadline and Drop guard also cover assertion failures.
        struct Child(std::process::Child);
        impl Drop for Child { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
        let frontend = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
        let runtime = frontend.join(if cfg!(target_os = "macos") {
            "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
        } else { "node_modules/electron/dist/electron" });
        let policy = frontend.join("dist/assets/onboarding-workflow.cjs");
        assert!(runtime.is_file() && policy.is_file(), "Run the locked native prerequisites before this provider test");
        let capture = Capture::new(9_007_199_254_740_993,"native-capture",Some("native-request"));
        let mut facts = Facts::new(3,4);
        let mut inputs = Vec::new();
        facts.begin("recording"); facts.identity(capture.clone()); facts.board(true);
        facts.observe(3,ScreenInk::default(),false); inputs.push(facts.view());
        facts.observe(4,ScreenInk::default(),false); inputs.push(facts.view());
        facts.board(false); facts.note(true); inputs.push(facts.view());
        facts.observe(4,ScreenInk::new(1,[(1,6,false)].into_iter()),false); inputs.push(facts.view());
        facts.observe(4,ScreenInk::new(2,[(2,10,true),(1,6,false)].into_iter()),false); inputs.push(facts.view());
        facts.observe(4,ScreenInk::new(3,[(3,10,false),(2,10,true),(1,6,false)].into_iter()),false); inputs.push(facts.view());
        facts.complete(capture.clone(),Some(Path::new("/synthetic/native.apparent")),Some(true)); inputs.push(facts.view());
        let absent = std::env::temp_dir().join(format!("apparent-dev-onboarding-provider-{}.json",crate::shared::ids::make_bundle_id()));
        let progress = super::super::read(&absent).unwrap();
        let (mut pipe, child_pipe) = UnixStream::pair().unwrap();
        pipe.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        pipe.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
        let stdin: OwnedFd = child_pipe.try_clone().unwrap().into();
        let stdout: OwnedFd = child_pipe.into();
        let mut child = Child(Command::new(runtime).env("ELECTRON_RUN_AS_NODE","1")
            .arg("--experimental-strip-types")
            .arg(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("onboarding/test/native-provider.ts")).arg(policy)
            .stdin(Stdio::from(stdin)).stdout(Stdio::from(stdout)).stderr(Stdio::inherit()).spawn().unwrap());
        pipe.write_all(&serde_json::to_vec(&json!({"facts":inputs,"progress":progress})).unwrap()).unwrap();
        pipe.shutdown(std::net::Shutdown::Write).unwrap();
        let mut output = Vec::new();
        (&mut pipe).take(65_537).read_to_end(&mut output).unwrap();
        assert!(output.len() <= 65_536);
        let result: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["stages"],json!(["board-ink","note","screen-ink","screen-ink","screen-ink","stop","copied"]));
        assert_eq!(result["effects"].as_array().unwrap().len(),1);
        assert_eq!(result["effects"][0]["operation"],"close-whiteboard");
        assert_eq!(result["effects"][0]["capture"],serde_json::to_value(capture).unwrap());
        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        loop {
            if let Some(status) = child.0.try_wait().unwrap() { assert!(status.success()); break; }
            assert!(std::time::Instant::now() < deadline, "Provider child did not exit");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn stroke_observations_are_raw_and_bounded_not_lesson_decisions() {
        let ink = ScreenInk::new(100, (1..=100).rev().map(|i| (i, i, i % 2 == 0)));
        assert_eq!(ink.total,100);
        assert_eq!(ink.recent.len(),64);
        assert_eq!(ink.recent.first().unwrap().index,100);
        assert_eq!(ink.recent.last().unwrap().index,37);
        assert!(ink.recent.first().unwrap().laser);
        let short = ScreenInk::new(1, [(1,6,false)].into_iter());
        assert_eq!(serde_json::to_value(short).unwrap()["recent"][0]["points"],6);
    }
    #[test]
    fn observations_retain_receipts_without_interpreting_lesson_stages() {
        let capture = Capture::new(7,"capture-a",Some("request-a"));
        let mut facts = Facts::new(1,2); facts.begin("recording"); facts.identity(capture.clone());
        facts.board(true); facts.observe(4,ScreenInk::new(3, [(3,6,false),(2,10,true),(1,1,false)].into_iter()),false); facts.note(true);
        facts.complete(capture.clone(),Some(Path::new("/synthetic/a.apparent")),Some(true));
        let receipt = facts.completion.clone();
        facts.complete(capture,None,Some(false)); facts.cancel();
        assert_eq!(facts.completion,receipt);
        assert_eq!(facts.view()["completion"]["clipboard"],"copied");
        assert_eq!(facts.view()["observation"]["noteSaved"],true);
        assert!(facts.view().get("stage").is_none());
        assert_eq!(facts.view()["observation"]["boardPoints"],4);
        assert_eq!(facts.view()["observation"]["screenInk"]["recent"][0]["points"],6);
        assert_eq!(facts.view()["observation"]["screenInk"]["recent"][1]["laser"],true);
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
