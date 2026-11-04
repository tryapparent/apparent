# Inspection binary package for assembly

This is an offline producer/stager for the existing Rust inspection executable.
It extends the Agent `cargo package` and dedicated-prefix `cargo install`
conventions. It does not publish, fetch, update an installation, switch root CLI
routing or change Desktop/Connect packaging. It is a delivery prerequisite, not
completion of independently shipped app inspection.

With Node 22.18+, Rust/Cargo and cached locked dependencies:

    node --experimental-strip-types capture/agent/inspection/delivery/package.ts build \
      SOURCE.crate EXPECTED_SOURCE_SHA256 NEW_OUTPUT_DIRECTORY

The input must be a clean canonical Cargo archive from PR617 or its successor.
Its identity comes from `.cargo_vcs_info.json`; Cargo omits `git.dirty` for clean
archives. The producer verifies source bytes, runs archive build/test/install and
installed golden/lookup/error checks, then uses ordinary optimized Cargo install
and compares that executable's outputs with the tested debug executable. It emits
one target-specific binary archive and checksum, plus retained local proof/logs.
No root application, Desktop, GPUI, native capture or Connect is built. Current
packaging is host-native; run the same producer on each supported target rather
than pretending a Linux build proves Mac execution.

The binary archive contains exactly `apparent-inspect` and `manifest.json`.
Manifest schema/protocol 1 records source commit/archive digest, package version,
actual ELF/Mach-O target and executable digest. This describes the existing CLI
arguments/output contract; it is not a new service or runtime protocol. Local
checksums and this self-description are integrity evidence, not official producer
authentication. A release consumer must obtain its expected archive digest from
an authenticated accepted producer under existing publication rules; an adjacent
checksum file alone supplies no trust. No publisher/attestation bypass is added.

Stage accepted bytes during exclusive application assembly:

    node --experimental-strip-types capture/agent/inspection/delivery/package.ts stage \
      BINARY.tar.gz AUTHENTICATED_ARCHIVE_SHA256 TARGET NEW_PACKAGE_DIRECTORY/inspection

The parent directory must already exist, be owned, and deny group/other writes.
Staging refuses an existing destination, unexpected inventory, links, wrong target
or altered bytes. It hashes one input byte snapshot and extracts that snapshot,
so changing the original archive pathname afterward cannot change staged bytes.
It neither executes a downloaded binary nor implements runtime path verification.
Do not transplant this stager as a verify-path-then-spawn runtime adapter.

Tests use a real produced artifact, including actual staged executable output and
rejection of altered/extra files, wrong target and destination replacement:

    APPARENT_INSPECTION_ARTIFACT=/absolute/BINARY.tar.gz \
      node --experimental-strip-types --test capture/agent/inspection/delivery/package.test.ts

## Parent integration boundary

The smallest app adoption places this component beside the existing root binary
(`Contents/MacOS/inspection` on Mac, `usr/bin/inspection` in AppImage) and changes
only local inspection dispatch in `composition/cli.rs`. Preserve the separate
Connect resolver, CLI arguments, stdout/stderr and exit codes; do not add PATH
search, runtime downloading, a manual user install, or a silent source fallback.
Keep schema and producer imports until their real consumers no longer need them.

Concrete shared assembly overlap with Connect PR616 at `a16c01d8` is its component
staging before signing in `build-mac-preview.sh`, `install-app.sh`, `release-app.sh`,
and before linuxdeploy in `linux/appimage/appimage.sh`. These files are untouched
here. Parent integration must compose both components before signing/admission.
Mac signing changes executable bytes: retain producer identity separately from
final signed assembly identity; do not treat the pre-sign digest as the final
signed digest. No runtime verification-to-execution guarantee is claimed here.

Independent updates also need accepted reuse of the unchanged root artifact.
`enablement/verification/mac-artifact-consumer.ts::verify` currently requires the
root artifact's exact source SHA/tree, lock and build config; its header explicitly
limits it to development inputs, not release admission. Preview/release scripts
still build the root application. This stager cannot bypass either contract.
Parent integration needs an explicit accepted composition receipt binding the
unchanged verified root artifact and independently authenticated inspection
artifact, followed by ordinary app signing/update/publication gates. Demonstrate
root-byte reuse during actual package assembly and real CLI dispatch on both
platforms before calling independent app delivery complete. No generic distribution
redesign, new updater, daemon or unrelated Connect adoption belongs in this slice.
