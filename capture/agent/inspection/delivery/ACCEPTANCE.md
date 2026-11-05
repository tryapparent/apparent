# Integrated inspection acceptance

The source identity is the PR head and tree, not a mutable branch label. Retain
`git rev-parse HEAD HEAD^{tree}`, source `.crate` SHA-256, binary archive SHA-256,
root receipt SHA-256 and final application SHA-256 with each run. Failed evidence
must remain separate from subsequent runs.

## Linux

From a clean committed checkout with the documented Linux prerequisites:

    node --experimental-strip-types capture/agent/inspection/delivery/composition.ts \
      root-bundle target/debug debug target/NEW-root
    bash capture/desktop/scripts/linux/appimage/appimage.sh target/NEW-root/apparent
    node --experimental-strip-types capture/agent/inspection/delivery/linux-package-proof.ts \
      target/appimage/Apparent-x86_64.AppImage /absolute/NEW-proof

Run heavy commands through `t3-build --jobs 3` on Clanker. AppImage assembly
automatically produces/tests/installs the independent Cargo archive, stages the
inspector and runs the existing encoder packaging check. The proof executes the
actual AppImage outside the checkout, compares legacy/current semantic goldens,
checks lookup/errors/nonmutation and rejects component tampering. It does not
certify GUI/capture behavior. `composition.test.ts` additionally requires
ROOT_DIRECTORY/ROOT_RECEIPT/INSPECTOR_FIRST/INSPECTOR_SECOND: use two genuinely
different real produced archives; its Cargo trap proves assembly does no build.

## Mac: prepared, not executed

No approved task issue/budget or Mac resource is established. Authenticated funded
NoMac access is not spending authority. Do not allocate, extend, borrow a bucket
or create an issue to reset one. Run only on a subsequently approved resource.

Use the same clean source tree, Node 22.18+, cached locked Rust dependencies and
documented Mac build prerequisites. Create and hash the source archive:

    cargo package --locked --offline --manifest-path capture/agent/inspection/Cargo.toml
    shasum -a 256 capture/agent/inspection/target/package/apparent-inspect-0.1.0.crate
    taskpolicy -c utility cargo build --locked --offline -j 3
    APPARENT_NO_LAUNCH=1 APPARENT_APP_DIR=/absolute/isolated/Apparent.app \
      bash capture/desktop/scripts/packaging/install-app.sh
    codesign --verify --deep --strict /absolute/isolated/Apparent.app
    node --experimental-strip-types capture/agent/inspection/tests/package-proof.ts \
      /absolute/SOURCE.crate EXPECTED_SHA256 /absolute/NEW-proof \
      /absolute/isolated/Apparent.app/Contents/MacOS/apparent

This tests root schema consumer compilation, standalone archive build/test/install,
installed default/configured/environment capture lookup, legacy/current semantic
output and root bundled dispatch comparisons. Repeat the installer into the same
isolated destination; retain enclosing signature verification and installed
component/composition hashes. Invalid staging must preserve the previous signed
app (the real consumer failure regression runs offline on Linux). Exercise runtime
snapshot/tamper rejection on a disposable copy, then remove only these isolated
test artifacts. Do not touch real captures, TCC or another installed app. Mac
publication still requires exact-main Mac verification/signing and the documented
short packaged-app smoke; no Linux result substitutes for those gates.

## Next bounded root-build slice (not implemented here)

The current closure deliberately retains shared inspection schema/readers/
formatters as root inputs. `build_version` watches every tracked file and Git
identity for the root label; reuse retains that label and authenticates a separate
composition identity instead of bypassing exact-source checks. Receipts record
actual root build wall time, toolchain, variant, native runtime hashes and compiler
dep-info admission. Cached timings are evidence of those runs, not benchmarks.

The next candidate is existing capture-control CLI adoption: Desktop currently
imports `apparent_capture` in `workflow/agent_capture.rs`; distinguish versioned
request/action DTOs used by the provider from client transport, then dispatch the
CLI to the already independently packaged PR609 executable. Prove real provider
compatibility and unchanged root-input admission before reusing roots across
client-only changes. This needs a stable wire contract and automatic app assembly;
it is not a new service, rewrite or cosmetic crate move. Broader native Engine
compilation remains a separate boundary and is not claimed solved by this slice.
