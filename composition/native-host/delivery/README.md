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
`OWNER_TARGET=macos-x64 npm run build` on the matching x64 host. The producer
refuses target relabeling, non-x64 hosts, dirty/untracked source and an existing
nonempty `dist/`. The Mac build uses fresh private `HOME`, app staging and
Sparkle staging paths and invokes the existing installer with
`APPARENT_NO_LAUNCH=1`; it never writes the user's `~/bin` route or launches the
app. Linux uses the existing AppImage packager and its encoder check. It refuses
to run if `target/appimage` already exists, because that script removes/replaces
its `AppDir` and owns that output directory. The generated AppImage is inventoried
as a single opaque executable; this manifest does not claim its internal files
are byte-identical to the source executable (linuxdeploy may patch ELF files).

`dist/manifest.json` pins the full source commit and Git tree, native target,
development build profile, entry point, launch mechanism, process profile rules,
and the closed staged inventory. Inventory records every regular file's SHA-256
and mode and every symlink's relative target and mode. Validation rejects path
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
