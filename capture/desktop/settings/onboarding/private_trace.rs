//! Temporary PRIVATE causal observation only; no protocol payloads or product policy.
use std::{fs::OpenOptions, io::Write, os::unix::fs::{MetadataExt,OpenOptionsExt,PermissionsExt}, sync::{OnceLock,Arc,atomic::{AtomicUsize,Ordering},mpsc},time::{Instant,Duration,SystemTime,UNIX_EPOCH}};
const LIMIT:usize=1024*1024;
const WINDOW:Duration=Duration::from_secs(30);
struct Record { event:&'static str, detail:String, mono:u128, wall:u128 }
struct Trace { queue:mpsc::SyncSender<Record>, first:Arc<OnceLock<Record>>, drops:Arc<AtomicUsize>, start:Instant }
static TRACE:OnceLock<Option<Trace>>=OnceLock::new();
fn start()->Option<Trace>{
 let dir=std::env::var_os("APPARENT_PRIVATE_PRACTICE_TRACE_DIR")?;
 let (tx,rx)=mpsc::sync_channel::<Record>(256);let first=Arc::new(OnceLock::<Record>::new());let drops=Arc::new(AtomicUsize::new(0));
 let (f,d)=(first.clone(),drops.clone());let start=Instant::now();
 std::thread::Builder::new().name("private-practice-trace".into()).spawn(move||{
  let path=std::path::Path::new(&dir);let Ok(meta)=std::fs::symlink_metadata(path) else{return};
  if !meta.is_dir()||meta.permissions().mode()&0o777!=0o700||meta.uid()!=unsafe{libc::geteuid()}{return}
  let Ok(mut file)=OpenOptions::new().create_new(true).write(true).mode(0o600).custom_flags(libc::O_NOFOLLOW).open(path.join(format!("native-{}.jsonl",std::process::id()))) else{return};
  let mut used=0;let mut first_written=false;let mut capped=false;
  let mut write=|r:&Record,priority:bool|->bool{if capped&&!priority{return true}let line=serde_json::json!({"pid":std::process::id(),"event":r.event,"detail":r.detail,"monoUs":r.mono,"wallMs":r.wall,"dropped":d.load(Ordering::Relaxed)}).to_string()+"\n";if !priority&&used+line.len()>LIMIT-4096{capped=true;let _=file.write_all(format!("{{\"event\":\"trace-cap\",\"dropped\":{}}}\n",d.load(Ordering::Relaxed)).as_bytes());return true}used+=line.len();file.write_all(line.as_bytes()).is_ok()};
  while within(start,Instant::now()) {
   if !first_written {if let Some(r)=f.get(){if !write(r,true){return}first_written=true;}}
   match rx.recv_timeout(Duration::from_millis(5)){Ok(r)=>{if !write(&r,false){return}},Err(mpsc::RecvTimeoutError::Disconnected)=>return,Err(_)=>{}}
  }
  let _=file.write_all(format!("{{\"event\":\"trace-expired\",\"dropped\":{}}}\n",d.load(Ordering::Relaxed)).as_bytes());
 }).ok()?;
 Some(Trace{queue:tx,first,drops,start})
}
fn record(event:&'static str,detail:String,first:bool){
 let Some(Some(t))=TRACE.get() else{return};if !within(t.start,Instant::now()){return}
 if detail.len()>2048{t.drops.fetch_add(1,Ordering::Relaxed);return}
 let r=Record{event,detail,mono:t.start.elapsed().as_micros(),wall:SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()};
 if first{let _=t.first.set(r);}else if t.queue.try_send(r).is_err(){t.drops.fetch_add(1,Ordering::Relaxed);}
}
pub(super) fn arm(){let _=TRACE.get_or_init(start);}
pub(super) fn emit(event:&'static str,detail:impl FnOnce()->String){if TRACE.get().is_some_and(|t|t.is_some()){record(event,detail(),false)}}
pub(super) fn failure(reason:&'static str,detail:impl FnOnce()->String){arm();if TRACE.get().is_some_and(|t|t.is_some()){record(reason,detail(),true)}}
pub(super) fn identity(v:&serde_json::Value)->String{
 ["source","transport","attempt","capture","sequence","intent"].into_iter().map(|key|{let value=v[key].as_str().filter(|s|s.len()<=20&&s.bytes().all(|b|b.is_ascii_digit())).unwrap_or("invalid-or-null");format!("{key}={value}")}).collect::<Vec<_>>().join(" ")
}

fn within(start:Instant,now:Instant)->bool{now.duration_since(start)<WINDOW}
#[cfg(test)] mod lifecycle_tests {use super::*;#[test] fn long_setup_capture_failure_window(){let setup=Instant::now();let capture=setup+Duration::from_secs(720);assert!(within(capture,capture+Duration::from_millis(1951)));assert!(!within(capture,capture+WINDOW));}#[test] fn early_failure_window_is_not_extended(){let setup=Instant::now();let first=OnceLock::new();let armed=*first.get_or_init(||setup);let repeated=*first.get_or_init(||setup+Duration::from_secs(720));assert_eq!(armed,repeated);assert!(!within(repeated,setup+Duration::from_secs(720)));}}
