use super::*;
use std::io::{BufRead, Write};
use std::process::{Child, Command, Stdio};
use std::os::unix::fs::DirBuilderExt;
struct FixtureRoot(std::path::PathBuf);
impl FixtureRoot { fn path(&self)->&std::path::Path { &self.0 } }
impl Drop for FixtureRoot { fn drop(&mut self) { let _=std::fs::remove_dir_all(&self.0); } }

#[test]
fn preview_process_fixture() {
    let Ok(role) = std::env::var("APPARENT_PREVIEW_FIXTURE") else { return; };
    if role=="invalid" { assert!(initialize().is_err()); return; }
    initialize().unwrap();
    let config = std::path::PathBuf::from(std::env::var_os("APPARENT_CONFIG").unwrap());
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    match role.as_str() {
        "first" => crate::shared::handoff::set_config_value_in(&config, "penColor", "blue".into()).unwrap(),
        "second" => {
            assert!(value.get("penColor").is_none(), "another preview's choices leaked into this build");
            crate::shared::handoff::set_config_value_in(&config, "penColor", "green".into()).unwrap();
        }
        "resume" => assert_eq!(value["penColor"], "blue", "restart lost this preview's saved state"),
        _ => panic!("unknown fixture role"),
    }
    let _owner = crate::capture::desktop::workflow::launch_instance::acquire().unwrap()
        .expect("new preview forwarded to another build's launch owner");
    let _capture_control=crate::capture::desktop::workflow::agent_capture::listen().unwrap();
    println!("PREVIEW_READY");
    std::io::stdout().flush().unwrap();
    if role == "first" { let mut line=String::new(); std::io::stdin().read_line(&mut line).unwrap(); }
}

struct HeldPreview(Child);
impl Drop for HeldPreview {
    fn drop(&mut self) { let _=self.0.kill(); let _=self.0.wait(); }
}

#[test]
fn different_preview_builds_keep_their_own_launch_owner_and_saved_state() {
    let path=std::path::PathBuf::from(format!("/tmp/ai-{:x}",std::process::id() ^ std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos()));
    std::fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
    let root=FixtureRoot(path);
    let home=root.path().join("home"); std::fs::create_dir(&home).unwrap();
    let mut apps=Vec::new();
    for name in ["First.app", "Second.app"] {
        let app=root.path().join(name).join("Contents");
        std::fs::create_dir_all(app.join("MacOS")).unwrap();
        std::fs::create_dir_all(app.join("Resources")).unwrap();
        std::fs::write(app.join("Resources/onboarding-shell"), "fixture").unwrap();
        let binary=app.join("MacOS/preview-test");
        std::fs::hard_link(std::env::current_exe().unwrap(), &binary).unwrap(); apps.push(binary);
    }
    let command=|index:usize, role:&str, build:char| {
        let mut c=Command::new(&apps[index]);
        c.args(["--exact","capture::desktop::workflow::test_instance::tests::preview_process_fixture","--nocapture"])
            .env("HOME",&home).env("APPARENT_TEST_INSTANCE","1")
            .env("APPARENT_TEST_BUILD",build.to_string().repeat(40)).env("APPARENT_PREVIEW_FIXTURE",role)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()); c
    };
    let mut first=HeldPreview(command(0,"first",'a').spawn().unwrap());
    let mut reader=std::io::BufReader::new(first.0.stdout.take().unwrap());
    let mut ready=false;
    loop { let mut line=String::new(); if reader.read_line(&mut line).unwrap()==0 {break;} if line.trim()=="PREVIEW_READY" {ready=true;break;} }
    assert!(ready,"first preview did not initialize");
    let second=command(1,"second",'b').output().unwrap();
    assert!(second.status.success(),"{}{}",String::from_utf8_lossy(&second.stdout),String::from_utf8_lossy(&second.stderr));
    first.0.stdin.take().unwrap().write_all(b"finish\n").unwrap();
    assert!(first.0.wait().unwrap().success());
    let invalid=command(1,"invalid",'z').output().unwrap();
    assert!(invalid.status.success(),"invalid preview identity was accepted");
    let resumed=command(0,"resume",'a').output().unwrap();
    assert!(resumed.status.success(),"{}{}",String::from_utf8_lossy(&resumed.stdout),String::from_utf8_lossy(&resumed.stderr));
}
