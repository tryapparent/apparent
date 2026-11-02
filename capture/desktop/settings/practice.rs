//! Authoritative first-capture coaching. Renderer actions cannot fake capture events.
use serde::Serialize;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all="kebab-case")]
pub enum Stage { Start, Whiteboard, BoardInk, ScreenInk, Stop, Preparing, Copied, Paste, Locate, Complete, Retry, CopyFailed }
#[derive(Debug)]
pub struct Practice { pub stage: Stage, board_ink: bool, screen_ink: bool, pub latest: bool, screen_baseline: usize }
impl Default for Practice { fn default()->Self { Self{stage:Stage::Start,board_ink:false,screen_ink:false,latest:false,screen_baseline:0} } }
impl Practice {
    pub fn started(&mut self) { if matches!(self.stage,Stage::Start|Stage::Retry|Stage::CopyFailed) {*self=Self::default();self.stage=Stage::Whiteboard;} }
    pub fn whiteboard(&mut self) { if self.stage==Stage::Whiteboard {self.stage=Stage::BoardInk;} }
    pub fn observe_ink(&mut self,board:bool,screen:usize) {
        if self.stage==Stage::BoardInk && board {self.board_ink=true;self.screen_baseline=screen;self.stage=Stage::ScreenInk;return;}
        if self.stage==Stage::ScreenInk && screen>self.screen_baseline {self.screen_ink=true;self.stage=Stage::Stop;}
    }
    pub fn processing(&mut self) { if matches!(self.stage,Stage::Whiteboard|Stage::BoardInk|Stage::ScreenInk|Stage::Stop) {self.stage=Stage::Preparing;} }
    pub fn saved(&mut self,copied:bool) {
        if self.stage!=Stage::Preparing {return;}
        self.stage=if !self.board_ink||!self.screen_ink {Stage::Retry} else if copied {Stage::Copied} else {Stage::CopyFailed};
    }
    pub fn cancelled(&mut self) { if matches!(self.stage,Stage::Whiteboard|Stage::BoardInk|Stage::ScreenInk|Stage::Stop|Stage::Preparing) {self.stage=Stage::Retry;} }
    // A person confirms their manual paste. A key press is never treated as proof
    // of delivery to another application; no monitoring of a private composer.
    pub fn action(&mut self,action:&str)->bool {
        match (self.stage,action) {
            (Stage::Copied,"practice-paste")=>{self.stage=Stage::Paste;true},
            (Stage::Paste,"practice-pasted")=>{self.stage=Stage::Locate;true},
            (Stage::Complete,"practice-finish")=>true,
            _=>false,
        }
    }
    pub fn opened_latest(&mut self) {if self.stage==Stage::Locate {self.latest=true;self.stage=Stage::Complete;}}
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn renderer_cannot_skip_real_capture_or_drawing() {
        let mut p=Practice::default();assert!(!p.action("practice-pasted"));p.started();p.observe_ink(true,1);assert_eq!(p.stage,Stage::Whiteboard);
        p.whiteboard();p.observe_ink(true,0);assert_eq!(p.stage,Stage::ScreenInk);p.observe_ink(true,1);assert_eq!(p.stage,Stage::Stop);
        p.processing();p.saved(true);assert_eq!(p.stage,Stage::Copied);assert!(!p.action("practice-finish"));assert!(p.action("practice-paste"));assert!(p.action("practice-pasted"));p.opened_latest();assert_eq!(p.stage,Stage::Complete);assert!(p.action("practice-finish"));
    }
    #[test] fn failed_copy_and_early_stop_never_claim_copied() {
        let mut p=Practice::default();p.started();p.processing();p.saved(true);assert_eq!(p.stage,Stage::Retry);
        p.started();p.whiteboard();p.observe_ink(true,0);p.observe_ink(true,1);p.processing();p.saved(false);assert_eq!(p.stage,Stage::CopyFailed);
        p=Practice::default();p.started();p.cancelled();assert_eq!(p.stage,Stage::Retry);
    }
}
