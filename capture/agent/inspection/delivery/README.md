# Inspection binary package for assembly

This is an offline producer/stager for the existing Rust inspection executable.
It extends the Agent `cargo package` and dedicated-prefix `cargo install`
conventions. The reviewed producer/stager remains an independently usable prerequisite. The
composition layer below adopts its artifact in the normal application, with
versioned root reuse and per-component provenance. Platform acceptance and final
review remain required before publication.

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

## Adopted host and composition v1

The host now invokes only the bundled inspector. Runtime verifies the composition
protocol/target and hashes a bounded regular-file byte snapshot. It writes that
snapshot into a new private directory, executes it with inherited stdout/stderr,
returns the component exit code, and removes the snapshot. Concurrent replacement
of the installed component cannot replace the already-checked execution bytes.
The installed application/composition receipt uses normal package trust; this
is not isolation from a malicious process with the same OS identity.

Ordinary Mac installers/preview/release assembly and Linux AppImage assembly stage
the component automatically before signing/packing. Source builds produce it from
this clean committed Cargo archive. Externally supplied artifacts require canonical
GitHub provenance, exact source and archive digest. Mac signing records a separate
post-sign runtime digest before the enclosing app is signed. There is no runtime
PATH/source fallback and no extra installation for app users.

`composition.ts seal-root ROOT/target/debug debug NEW_RECEIPT` performs the initial
clean root build and records exact source/tree, toolchain, native executable/shared
object hashes and a conservative tracked-input inventory. It audits actual rustc
dep-info (including the library), not Cargo's aggregate Git-identity watch list.
Only inspector main/standalone lock, tests, documentation and delivery tooling, plus
the independently packaged `capture/desktop/ui/frontend/` inputs, are excluded.
Shared UI, Rust bridge/schema/readers, native sources and root build contracts remain
root inputs. Every excluded tracked path must be absent from compiler dep-info.
Renderer package build inputs remain owned by their separate producer/stager; they
do not change the root executable bytes. The policy source hash is pinned in the
receipt, so changing this allowlist invalidates older receipts. Root build-version
metadata retains its original source identity when reused; the composition separately
records inspector/composition revisions. No existing exact-source development-artifact
admission is relaxed.

Local integration proof may call `composition.ts assemble ROOT_DIR ROOT_RECEIPT
ROOT_RECEIPT_SHA INSPECTOR_ARCHIVE INSPECTOR_SHA NEW_DIR`. This checks ancestry,
compatibility and identical root input closure, snapshots/hash-checks root files,
and assembles only verified bytes. It never invokes Cargo. Its local receipt is
not publication authority. Tests run actual root CLI dispatch outside the checkout
with two different inspector binaries, block Cargo in PATH, and check tampering.

For production reuse, `APPARENT_INSPECTION_REUSE` names schema-1 JSON containing
rootDirectory/rootReceipt/rootReceiptSha256/rootProfile and inspectorArchive/
inspectorArchiveSha256/inspectorSourceSha. Ordinary packaging calls `reuse`, which
additionally verifies canonical main GitHub attestations for each exact component.
Root/inspector provenance producer artifacts and successful exact-commit publication
gates must exist before that release path can be used; a locally written receipt or
adjacent checksum cannot replace them. Both signer workflows are constrained to the existing verification-platform.yml,
release-linux.yml and release-mac-preview.yml producers. A release rootProfile
must match its consumer; debug roots cannot enter release assembly.
No workflow is dispatched or authority to publish inferred by these local tools.

The Linux and Mac release workflows produce the Desktop renderer archive from the
exact checked-out source, require a clean renderer input inventory, and pass its
archive, digest and source revision as `APPARENT_DESKTOP_RENDERER_ARCHIVE`,
`APPARENT_DESKTOP_RENDERER_SHA256` and `APPARENT_DESKTOP_RENDERER_SOURCE_SHA`.
The digest comes from the real producer invocation; the embedded manifest and any
adjacent checksum are not independent authentication sources. `renderer/assembly.ts` delegates archive
validation and staging to the producer CLI, then normalizes the verified static
tree to directories `0755` and files `0644` while the enclosing app candidate is
private. The producer manifest remains beside `renderer/` as renderer metadata;
it does not replace root or inspector receipt identity.

The packaged resource is `Contents/Resources/desktop-ui` on macOS and
`usr/share/apparent/desktop-ui` in the Linux AppDir. It is part of the same app
package; no second install is involved. This does not route any installed window
to the renderer or change capture behavior: existing native and `note-ui` paths
remain active. A locally computed archive digest is sufficient only for local
proof, never release admission.

The existing platform verification job now retains source-bound root bundles and
attested inspector archives on its existing runners/budgets; no new workflow,
runner allocation or local paid resource is created. Production is admitted only
when the checked-out revision equals the attested workflow source revision. A Mac
follower selecting a different Linux-verified SHA still performs its existing
verification, but does not emit misleading composition provenance for that SHA.
The expected inspector signer is the same verification-platform.yml producer.
No new Actions run was dispatched for this change.

Root receipts include native transcribe/ggml shared-object hashes and build-variant
environment digests. Preview/helper identity and other compiled variants must
match; a normal root artifact is not silently relabeled as a preview. The existing
Mac development-artifact verifier and its exact-source rules are unchanged.
