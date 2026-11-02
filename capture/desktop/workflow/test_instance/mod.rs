//! Explicit paths for the separately packaged onboarding test app.
//! HOME and platform-wide directory variables are never changed.
use anyhow::{Context,Result,ensure};
use std::os::unix::fs::{MetadataExt,PermissionsExt};

pub fn initialize()->Result<()> {
    if std::env::var_os("APPARENT_TEST_INSTANCE").as_deref()!=Some(std::ffi::OsStr::new("1")){return Ok(());}
    let home=dirs::home_dir().context("Could not locate the test app's user directory")?;
    let root=if cfg!(target_os="macos"){home.join("Library/Application Support/apparent-onboarding-test")}else{home.join(".local/share/apparent-onboarding-test")};
    if root.exists(){let m=std::fs::symlink_metadata(&root)?;ensure!(m.is_dir()&&!m.file_type().is_symlink()&&m.uid()==unsafe{libc::geteuid()},"Unsafe onboarding test directory");}
    std::fs::create_dir_all(&root)?;std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700))?;
    let config=root.join("config.json");
    if !config.exists(){
        crate::shared::handoff::set_config_value_in(&config,"launchAtLogin",false.into())?;
        crate::shared::handoff::set_config_value_in(&config,"shortcuts",serde_json::json!({"record":{"keyCode":25,"modifiers":6656,"label":"⌃⌥⇧9"},"paste":null}))?;
    }
    let executable=std::env::current_exe()?;
    let resources=executable.parent().context("Missing app executable directory")?.join("../Resources");
    let shell=resources.join("onboarding-shell");ensure!(shell.is_file(),"The onboarding test UI is missing from this app");
    // Called once by main before application threads. Only Apparent-specific
    // settings are supplied; other apps and OS-owned directories stay intact.
    unsafe {
        std::env::set_var("APPARENT_CONFIG",config);
        std::env::set_var("APPARENT_CAPTURES_DIR",root.join("captures"));
        std::env::set_var("APPARENT_CONTROL_DIR",root.join("control"));
        std::env::set_var("APPARENT_UI_PROFILE",root.join("electron-profile"));
        std::env::set_var("APPARENT_ONBOARDING_SHELL",shell);
    }
    Ok(())
}

pub fn control_directory(kind:&str)->Result<std::path::PathBuf> {
    if let Some(root)=std::env::var_os("APPARENT_CONTROL_DIR") {
        let root=std::path::PathBuf::from(root);ensure!(root.is_absolute(),"Apparent control path must be absolute");
        return Ok(root.join(kind));
    }
    Ok(std::path::PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?).join(".config/apparent").join(kind))
}
