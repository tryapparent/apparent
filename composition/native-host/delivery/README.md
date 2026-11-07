# Existing GUI native-host artifact

This producer stages the existing root `apparent` GUI on native x64 Linux or
macOS. It does not build `apparent-engine`, the Electron Foundation shell, a new
service, or a native-host replacement. The Linux output is the existing full
AppImage; the Mac output is the complete `Apparent.app` produced by
`capture/desktop/scripts/packaging/install-app.sh`. Both are explicitly
development-profile artifacts. The producer is available to Platform delivery
catalogs; it is not installed, activated, launched, or accepted as GUI/native
proof by building or packaging it.

Run `npm ci`, `npm run verify`, then `OWNER_TARGET=linux-x64 npm run build` or
`OWNER_TARGET=macos-x64 npm run build` on the matching x64 host. Linux requires
the official packaging-tools manifest to be resolved before delivery
fingerprinting, with its absolute path in `APPARENT_PACKAGING_TOOLS_MANIFEST`
and exact file SHA-256 in `APPARENT_PACKAGING_TOOLS_SHA256`. The build snapshots
those prepared bytes and refuses missing or changed inputs; it does not resolve
a moving release after admission. The existing tool installer verifies the
official URLs and digests before use.

The producer refuses target relabeling, non-x64 hosts, dirty/untracked source,
custom/cross Cargo output paths and any existing `dist/`. Cargo's JSON artifact
output must identify the current native executable, preventing a stale
`target/debug/apparent` from being packaged after compilation went elsewhere.
Compiler-selected inputs permit Cargo's hard links while retaining stable
no-follow reads and metadata checks. Staged artifacts and prepared tool inputs
still require single-link regular files; Mac snapshots are fresh private copies.
The Mac build preserves the real compiler/user environment, uses fresh app and
Sparkle staging paths, and calls the existing installer's internal staging function
with private snapshots of the validated executable and the same package's Cargo
build-script helper output. Cached Cargo builds still identify that helper's
`OUT_DIR`. Staging checks exact copied bytes before signing, performs no second
build, and creates no `~/bin` link or launch. The executable installer retains its
normal compile or immutable-main artifact admission gate. Linux uses the existing AppImage packager and encoder check. It refuses
to run if `target/appimage` already exists, because that script removes/replaces
its `AppDir` and owns that output directory. The generated AppImage is inventoried
as a single opaque executable. `guiExecutable` separately pins the actual ELF
at `usr/bin/apparent` after extraction, because linuxdeploy may patch the original
Cargo output. On Mac it pins the signed staged executable. Neither build path
launches the GUI.

`dist/manifest.json` pins the full source commit and Git tree, native target,
development build profile, entry point, launch mechanism, process profile rules,
and the closed staged inventory. Inventory records every regular file's SHA-256
and mode and every symlink's relative target and mode. The required manifest is
validated separately from the inventory that it describes. File bytes and mode
are read from one stable no-follow handle. Validation rejects path
escape, missing/extra entries, hash or mode drift, and links that escape or do
not resolve within the bundle. The complete tracked Git tree is the declared
source input closure: root `Cargo.toml`/`Cargo.lock`, root `build.rs`, its
`enablement/build_version.rs` and `enablement/native/build_cache.rs` includes,
all Rust path crates/modules/tests/assets (`include_bytes!`/`include_str!`),
platform build inputs (including Metal/Swift sources and Mac plist), and the
existing packaging scripts/resources. Cargo's external locked crates, compiler,
system libraries, packaging tools and host environment are toolchain/runtime
inputs rather than repository files; the manifest records Cargo/rustc and OS
identity but does not replace Platform's source fingerprint or build attestation.

At launch, use the packaged entry and the platform mechanism in the manifest:
execute the Linux AppImage, or open the Mac app through LaunchServices. The
manifest fixes Linux arguments to `--appimage-extract-and-run app` and Mac
LaunchServices arguments to `app`, avoiding terminal-dependent default CLI
selection. Native-host transport is protocol 1. The
launcher must supply one trusted `HOME`/profile. `HOME/.config/apparent/` owns
the GUI socket at `agent-control/capture.sock`; `APPARENT_CONFIG`, if set, must
point to the config file whose revision/CAS the GUI process actually uses. Do
not pair a config override from one profile with a socket/GUI from another.
Native-host effects and readbacks are process-scoped to the running GUI and its
profile; this artifact alone proves neither process ownership nor effect
readback. There is no PATH lookup, source-tree runtime, compilation at launch,
or auto-launch fallback.

This artifact preserves only the existing root GUI's behavior. It makes no
claim for `NativeTrial`, capture-to-stroke, capture exclusion, onboarding
adoption, installed-route activation, permission grants, or release readiness.
Platform owns catalog/selector integration, archive admission, launch identity,
GUI socket/effect proof and all activation decisions.
