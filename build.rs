use std::path::PathBuf;
use std::process::Command;

mod build_version { include!("enablement/build_version.rs"); }

#[path = "engine/diagnostics/build.rs"]
mod sparkle_outcomes;

#[path = "engine/native/input/shortcut_build.rs"]
mod record_shortcut_build;

fn main() {
    build_version::emit();
    record_shortcut_build::compile();
    compile_onboarding_entry_policy();
    emit_recording_permissions();
    emit_native_policy("record", "performance/recording-performance", "settings/permissions/performance-policy.bend");
    emit_native_policy("record", "capture-request/capture-admission", "capture-request/src/capture-admission.bend");
    emit_native_policy("record", "lip-input", "settings/lip-policy.bend");
    emit_native_policy("record/storage", "storage-default", "src/retention/capacity.bend");
    emit_native_policy("record", "note-gesture", "notes/double-shift.json");
    emit_native_policy("onboarding", "note-tip", "host/tips/note-tip.json");
    #[cfg(target_os = "macos")]
    emit_native_policy("onboarding", "frog-nudge", "host/tips/frog-nudge.json");
    compile_embedded_policy("record/enablement/ci/bend/pill.ts", &[
        "record/pill/pill-state.bend", "record/pill/host.ts", "record/pill/presentation.ts",
        "record/enablement/ci/bend/modules.json",
    ], "record-pill.mjs");
    compile_embedded_policy("record/pill/whiteboard/build.ts", &[
        "record/pill/whiteboard", "record/enablement/ci/bend/modules.json",
    ], "record-whiteboard.mjs");
    compile_embedded_policy("connect/enablement/ci/bend/renewal.ts", &[
        "connect/client/typescript/src/renewal", "connect/enablement/ci/bend/modules.json",
    ], "credential-renewal.mjs");
    record_media_build::compile_record_media();
    sparkle_outcomes::compile();
    println!("cargo:rerun-if-env-changed=APPARENT_POSTHOG_TOKEN");
    println!("cargo:rerun-if-env-changed=APPARENT_POSTHOG_RELEASE_ID");
    let release_id = std::env::var("APPARENT_POSTHOG_RELEASE_ID").unwrap_or_default();
    assert!(release_id.is_empty() || (release_id.len() == 36
        && release_id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) { b == b'-' } else { b.is_ascii_hexdigit() }
        })), "APPARENT_POSTHOG_RELEASE_ID must be a PostHog release UUID");
    println!("cargo:rustc-env=APPARENT_POSTHOG_RELEASE_ID={release_id}");
    watch_desktop_tooling();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        stage_transcribe_shared_objects();
        // cargo binaries and tests resolve the staged libraries beside themselves.
        // linuxdeploy rewrites this to the AppImage's usr/lib when packaging.
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    compile_mac_native();
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    if let Ok(output) = Command::new("xcode-select").arg("-p").output()
        && output.status.success()
        && let Ok(developer_dir) = String::from_utf8(output.stdout)
    {
        for runtime in ["swift-5.5/macosx", "swift/macosx"] {
            let swift_runtime = format!(
                "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/{runtime}",
                developer_dir.trim()
            );
            println!("cargo:rustc-link-arg=-Wl,-rpath,{swift_runtime}");
        }
    }
}

fn emit_native_policy(owner: &str, name: &str, table: &str) {
    let generator = format!("{owner}/enablement/ci/bend/{name}.ts");
    println!("cargo:rerun-if-changed={generator}");
    println!("cargo:rerun-if-changed={owner}/{table}");
    let output = Command::new("node")
        .args(["--experimental-strip-types", &generator])
        .output()
        .expect("Node 22 is required to generate native policy");
    assert!(output.status.success(), "{name}: {}", String::from_utf8_lossy(&output.stderr));
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let file = name.rsplit('/').next().unwrap();
    std::fs::write(out.join(format!("{file}.rs")), output.stdout)
        .expect("write generated native policy");
}

fn compile_onboarding_entry_policy() {
    let generator = "onboarding/enablement/ci/entry-policy.ts";
    println!("cargo:rerun-if-changed={generator}");
    println!("cargo:rerun-if-changed=onboarding/host/entry-policy.ts");
    println!("cargo:rerun-if-changed=onboarding/enablement/ci/bend");
    println!("cargo:rerun-if-changed=onboarding/host/traversal/tour-traversal.json");
    let generated = Command::new("node")
        .args(["--experimental-strip-types", generator])
        .output()
        .expect("Node 22 is required to compile Onboarding entry policy");
    assert!(
        generated.status.success(),
        "Unable to compile Onboarding entry policy: {}",
        String::from_utf8_lossy(&generated.stderr),
    );
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    std::fs::write(output.join("onboarding_entry_policy.rs"), generated.stdout)
        .expect("write generated Onboarding entry policy");
}

fn compile_embedded_policy(generator: &str, sources: &[&str], module: &str) {
    for input in [generator, "shared/enablement/bend"].into_iter().chain(sources.iter().copied()) {
        println!("cargo:rerun-if-changed={input}");
    }
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    let result = Command::new("node")
        .arg(generator)
        .arg(output.join(module))
        .output()
        .expect("Node 22 is required to compile embedded policy");
    assert!(result.status.success(), "Compile {module}: {}", String::from_utf8_lossy(&result.stderr));
}

#[path = "engine/native/record_media_build.rs"]
mod record_media_build;

fn emit_recording_permissions() {
    let generator = "record/enablement/permissions/native.ts";
    println!("cargo:rerun-if-changed={generator}");
    println!("cargo:rerun-if-changed=record/capture-request/src/permission-requirements.ts");
    println!("cargo:rerun-if-changed=record/settings/permissions/permission-policy.json");
    let output = Command::new("node")
        .args(["--experimental-strip-types", generator])
        .output()
        .expect("Node is required to compile recording permission requirements");
    assert!(
        output.status.success(),
        "compile recording permission requirements: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out.join("recording_permissions.rs"), output.stdout)
        .expect("write recording permission requirements");
}

/// Keep runtime libraries AND dlopen-only CPU modules together: transcribe.cpp's
/// init_backends_default uses dladdr to search next to the loaded libtranscribe.
fn stage_transcribe_shared_objects() {
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    // Cargo layouts include build/<package>-<hash>/out and, in newer Cargo,
    // build/<package>/<hash>/out. Locate the profile by its build directory,
    // rather than staging into build/ when the package adds another level.
    let profile = out_dir
        .ancestors()
        .find(|path| path.file_name().is_some_and(|name| name == "build"))
        .and_then(|path| path.parent())
        .expect("Unexpected OUT_DIR layout");
    for key in [
        "DEP_TRANSCRIBE_CPP_RUNTIME_DIR",
        "DEP_TRANSCRIBE_CPP_MODULE_DIR",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        let source =
            PathBuf::from(std::env::var_os(key).expect("dynamic transcribe runtime missing"));
        let mut count = 0;
        for entry in std::fs::read_dir(&source).expect("read transcribe runtime") {
            let path = entry.expect("read transcribe library").path();
            let name = path.file_name().unwrap();
            if !name.to_string_lossy().contains(".so") || !path.is_file() {
                continue;
            }
            count += 1;
            for dir in [profile.to_path_buf(), profile.join("deps")] {
                std::fs::create_dir_all(&dir).expect("create runtime directory");
                let staged = dir.join(name);
                std::fs::copy(&path, &staged).expect("stage transcribe library");
                // Cargo snapshots watched mtimes before running this script. Keep
                // the provider's mtime so our own copy is not a new input change.
                let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
                std::fs::File::options().write(true).open(&staged).unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(modified)).unwrap();
                // Cargo may restore build-script state while pruning target outputs.
                // Watching each copy makes a missing cached runtime invalidate this
                // script, so a normal build restores the runtime before execution.
                println!("cargo:rerun-if-changed={}", staged.display());
            }
        }
        assert!(count > 0, "No shared libraries in {}", source.display());
    }
}

/// Track Desktop-owned build/runtime tools and packaging inputs after their physical move.
fn watch_desktop_tooling() {
    for path in [
        "capture/desktop/scripts/packaging/Apparent.entitlements",
        "capture/desktop/scripts/support/apparent-restore-clipboard.py",
        "capture/desktop/scripts/support/bench-start.ts",
        "capture/desktop/scripts/packaging/build-mac-preview.sh",
        "capture/desktop/scripts/support/check-ca-roots.sh",
        "capture/desktop/scripts/support/check-permission-panel-dock.sh",
        "capture/desktop/scripts/packaging/install-app-remote.sh",
        "capture/desktop/scripts/packaging/install-app.sh",
        "capture/desktop/scripts/linux/appimage/appimage.sh",
        "capture/desktop/scripts/linux/maintenance/build-playback.sh",
        "capture/desktop/scripts/linux/gui/capture-smoke.py",
        "capture/desktop/scripts/linux/appimage/check-appimage-decoder.sh",
        "capture/desktop/scripts/linux/appimage/check-appimage-encoder.sh",
        "capture/desktop/scripts/linux/appimage/check-cpu-tiers.py",
        "capture/desktop/scripts/linux/appimage/dependencies.sh",
        "capture/desktop/scripts/linux/gui/gui-vm-reaper.py",
        "capture/desktop/scripts/linux/gui/gui-vm.py",
        "capture/desktop/scripts/linux/maintenance/migrate-scrawl.py",
        "capture/desktop/scripts/linux/maintenance/publish-main-preview.py",
        "capture/desktop/scripts/linux/appimage/smoke-cpu.sh",
        "capture/desktop/scripts/linux/gui/test-capture-smoke.py",
        "capture/desktop/scripts/linux/gui/test-gui-vm.py",
        "capture/desktop/scripts/linux/maintenance/test-native-launch.sh",
        "capture/desktop/scripts/linux/updater/test-updater-gui.py",
        "capture/desktop/scripts/linux/maintenance/test_migrate_scrawl.py",
        "capture/desktop/scripts/linux/updater/updater-fixture.py",
        "capture/desktop/scripts/linux/updater/updater-gui-scenario.sh",
        "capture/desktop/scripts/linux/updater/updater-gui.py",
        "capture/desktop/scripts/release/prepare-mac-signing.sh",
        "capture/desktop/scripts/release/preview_appcast.py",
        "capture/desktop/scripts/release/release-app.sh",
        "capture/desktop/scripts/release/setup-sparkle.sh",
        "capture/desktop/scripts/tests/local_preview_update.py",
        "capture/desktop/scripts/tests/test_export_audio.py",
        "capture/desktop/scripts/tests/test_launch_registration.py",
        "capture/desktop/scripts/tests/test_linux_preview_publication.py",
        "capture/desktop/scripts/tests/test_preview_appcast.py",
        "capture/desktop/scripts/tests/test_preview_apple_signing.py",
        "capture/desktop/scripts/tests/test_preview_release.py",
        "capture/desktop/scripts/tests/test_preview_sparkle_setup.py",
        "capture/desktop/scripts/release/verify-preview-sparkle-key.swift",
        "capture/desktop/scripts/support/virtual-display.swift",
        "composition/enablement/release/linux/dev.kitlangton.apparent.desktop.json",
        "composition/enablement/release/linux/dev.kitlangton.apparent.png",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
}

/// TypeScript owns native build selection/reuse; xcrun remains the compiler.
fn compile_mac_native() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let output = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let script = root.join("enablement/native-build/build.ts");
    println!("cargo:rerun-if-changed={}", script.display());
    let status = Command::new("node")
        .arg("--experimental-strip-types")
        .arg(script)
        .arg(&root)
        .arg(output)
        .arg(std::env::var("CARGO_CFG_TARGET_ARCH").expect("Mac target architecture"))
        .status()
        .expect("Node 22+ is required for Mac native build tooling");
    assert!(status.success(), "Mac helper/shader build failed");
}
