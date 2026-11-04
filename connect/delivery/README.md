Connect producer prerequisite

connect-delivery.yml builds and verifies browser and Worker outputs on main push
or manual main dispatch, without native CI. It uploads separate immutable Actions
artifacts named connect-browser-<full SHA> and connect-worker-<full SHA>, each
containing manifest.json and dist/. The reusable publisher accepts required string
input `producer-run`; an empty input selects the producer, a nonempty input selects
publication. Public invokes it independently with `secrets: inherit`.

Run `node --experimental-strip-types connect/delivery/artifacts.ts seal DIR KIND`
then `validate DIR KIND` from a clean committed checkout. KIND is connect-browser
or connect-worker. The manifest records source identity, input and output hashes,
production environment and runtime versions. This is local integrity evidence,
not independent trusted GitHub-run admission; Public owns that integration.

Producer analytics covers shared configuration, production artifacts and synthetic
Connect consent behavior. Public owns composed analytics transport acceptance.
Five browser assets still come from Public. Existing
Python theme checks and native Connect client/consumer coupling remain; this
producer is not complete Connect language or delivery independence.

Worker publisher transition

The publish job in connect-delivery.yml consumes authenticated canonical producer metadata and verifies
its GitHub archive SHA256 before extracting exactly manifest.json and dist/worker.js.
The artifacts CLI validates complete candidate inventory, output hashes and source
ancestry against current main. Wrangler receives the verified payload with
--no-bundle; no product build runs in the publisher.

Publication retains HOSTED_CD_ENABLED, hosted-production bindings and the common
web-delivery-production-eligible lock. The retirement check deliberately
fails while web-delivery.yml still declares its hosted job. Public must remove that
job atomically with adoption; this is an existing-publisher retirement contract.
Browser composition remains Public-owned. Native consumers still couple to Connect;
this Worker publisher does not establish whole-product independence.

runtime/ contains byte-identical transitional copies of hosted_config.py and
verify_worker.py. PYTHONPATH supplies the existing enablement/release_gate import;
the originals remain untouched. Remove donors only with Public's coordinated
consumer migration; move release_gate ancestry policy only as a separately verified
compatible owner change. Runtime controls, resources and migrations are unchanged.

Selection enumerates authenticated successful main workflow runs in pages of 100
until an empty page, checking direct browser and Worker artifacts against complete
current inputs and production environment. Receipt-only runs do not truncate the
search. Manual dispatch forces a fresh producer run.

The callable requires string input `producer-run`: empty runs selection/production;
nonempty publishes that successful run. Each completed invocation uploads
`connect-selection-<SHA>` containing exactly `connect-selection.json`, with JSON
`{"schema":1,"selectedRun":""}` for a fresh build or a prior direct producer run ID
as the string `selectedRun`. Publication authenticates the current receipt and its
one-hop prior producer, including archive digests, expiry and Git ancestry. Outputs
are `selected-run`, `build`, and `applicable` (currently always true).

Recipient producer prerequisite

`connect-delivery.yml` runs only on canonical main and builds the standalone
Rust recipient in a temporary source directory, outside root Cargo configuration.
Each of four macOS/Linux architecture outputs includes its executable and a
protocol-1 manifest sealing the actual executable SHA256, full source SHA and
unique workflow run/attempt version. GitHub build attestations cover both files.
A main-only release job verifies both attestations against the canonical workflow,
main ref and exact source digest, then publishes four target archives and SHA256SUMS
as durable GitHub release assets. Versions are independently named
`recipient-<full SHA>-<run ID>-<attempt>`; reruns create a new version. Existing
versions/assets must never be edited, deleted or overwritten. Release creation
fails on an existing tag; no update/upload-clobber path exists. Actions archives
are only intermediate transport. GitHub repository administrators can still alter
releases: consumers must verify the embedded executable and manifest attestations,
not trust a release URL or checksum alone. These binaries are not Apple signed or
notarized. No Desktop packaging, app release or hosted activation is included.

Before adoption, authenticate the canonical workflow run on main and its source,
verify GitHub attestations with the expected repository/workflow identity, validate
platform/architecture/protocol and hash the downloaded executable before copying
it into the application. Never fall back to source compilation. App signing,
notarization, updater identity and exact-commit publication gates remain required.

Recipient failed-job reruns reuse successful targets from earlier attempts of the
same run and source SHA. The publisher validates every discovered name, manifest
and executable digest, authenticates both files (including superseded candidates),
and selects the greatest producer attempt per target no later than the release
attempt. Missing targets and invalid candidates fail closed.

The release tag and archive prefix identify the current publication attempt.
Embedded manifests remain byte-for-byte original and may identify earlier producer
attempts. `recipient-identities.json` schema 1 contains `releaseVersion` and a
`targets` array of complete selected manifest identities. Consumers must pin the
release version separately from each target's producer attempt/version, validate
the original manifest against that reviewed producer identity, and verify both
attestations. The index is discovery metadata, not an independent trust anchor.
Stage during package construction with Node 22 and authenticated `gh` plus `tar` installed:

```
node --experimental-strip-types connect/delivery/recipient/stage.ts /absolute/reviewed-pin.json x86_64-unknown-linux-gnu /absolute/package/recipient
```

The destination must not exist; its ancestors must not be symlinks. The package receives `apparent-connect-recipient` (0755) and `manifest.json`. No runtime PATH lookup or source build occurs. Failed downloads, provenance checks or validation leave no published destination. Use a trusted package directory without concurrent writers.

The reviewed JSON pin contains `sourceSha` (40 lowercase hex), `run` and `attempt` (positive decimal strings), `target`, `sha256` (binary digest), `version` (`recipient-SHA-RUN-ATTEMPT`), and `manifest`: `{ "schema": 1, "protocol": 1, "repository": "tryapparent/apparent", "workflow": ".github/workflows/connect-delivery.yml", "executable": "apparent-connect-recipient" }`. Obtain these from the completed trusted producer; never infer a pin from downloaded assets. No real release pin is included here.

Both extracted files must pass GitHub attestation verification for the trusted workflow, main source ref and pinned source digest before binary architecture, digest and manifest identity validation. Tests use synthetic headers and injected transport/attestation results; they do not establish real producer provenance.

Run tests: `node --experimental-strip-types --test connect/delivery/recipient/*.test.ts connect/delivery/recipient/tests/*.test.ts`.

Packaging preparation: all four assembly routes consume `pins.json` through
`package.ts`. `adopted:false` preserves current production assembly. Adoption
requires all four reviewed real pins together; missing pins then fail closed.
Keep this integration unmerged until producer execution and native proof pass.
Mac assembly signs the nested recipient before the enclosing app. The original
attested manifest is retained as `recipient-provenance.json`; `manifest.json`
contains the signed executable digest. Linux adoption MUST bind the raw producer digest in the trusted adapter
argument. Mac adoption authenticates the signed receipt through the enclosing
app signature as described below; an adjacent manifest alone is insufficient. Current production dispatch remains unchanged. This is still an open
integration gate; raw producer hashes cannot be used as signed output hashes.
No recipient updater or runtime download is introduced.

Assembly publishes `recipient/` beside the root executable (on Mac,
`Contents/MacOS/recipient/`). Signing and strict nested verification complete in
a private same-destination staging directory before directory rename; failure
removes staging. Existing output is refused. Ancestors and concurrent writers
must remain trusted throughout assembly.

The staged Mac adapter accepts a receipt only inside the running app's canonical
bundle, after `/usr/bin/codesign --verify --strict --deep` on the enclosing app,
running executable and recipient. Their nonempty TeamIdentifiers must agree.
The enclosing signature must seal `recipient/manifest.json` and the retained
provenance. The receipt digest then binds the signed executable bytes. Linux
continues to require a trusted compiled raw digest argument; no real pin exists.
Injected assembly tests and Linux Rust tests do not prove Mac resource sealing
or packaged signature behavior. Parent-owned packaged Mac proof must verify
receipt mutation rejection, wrong-team rejection and successful invocation before
adoption. Production dispatch and `adopted:false` remain unchanged.

For retry assembly, an optional reviewed `releaseVersion` locates the release tag
and exact target archive. It must name the same source SHA and run with an attempt
at least as new as the producer `attempt`. The manifest `version` and producer
attempt remain original. `recipient-identities.json` is untrusted inventory for
reviewing candidate identities; it never supplies authority or automatically
updates a trusted pin. The reviewed pin remains authoritative.

The root adapter test accepts an explicit private fixture path through
`APPARENT_TEST_RECIPIENT_EXECUTABLE`; it copies that executable beside a synthetic
root path outside the checkout and invokes the real adapter. This test-only input
never changes runtime resolution or PATH.

Takeover review and remaining admission (2026-11-04):

- Prior dispatch review fixed canonical output-parent comparison and structural pin validation in e6031f34. Its separate race investigation made no changes. Runtime now also rejects partial adoption maps, matching assembly's four-target requirement.
- Runtime still hashes a pathname then spawns it. A writer replacing that pathname after hashing can execute different bytes. This is not an immutable execution guarantee. Linux descriptor execution alone would not stop in-place writes; Mac pathname signature checks likewise are not an atomic execution primitive.
- Existing install-app.sh installs under ~/Applications by default, copies executable files and signs the enclosing bundle; it does not isolate those files from the owning user. AppImage assembly puts the recipient beside the root in usr/bin. Normal mounted image execution supplies a read-only filesystem, but extracted AppDirs remain mutable. The root executable and its other packaged helpers already rely on trusted installation writers. The recipient pin protects artifact selection and detects pre-invocation tampering; it does not establish a new hostile-same-user boundary. The cooperative Mac installer exclusion now uses a shared invocation/exclusive installer advisory lock. It closes the supported-installer window, not hostile same-user mutation. Parent review and native Mac proof remain required.
- Mac discovery found the authenticated cached @nomac/cli and usable account credit. The shared queue wrapper matches its owning source; existing tickets belong to other work. Prepared-candidates.json contains only unrelated historical candidates. This task has no identified canonical issue or explicitly named non-issue budget, so account funding is not rental authority. No ticket, reservation, allocation or foreign-session mutation was performed.
- Final integration must obtain all four identities from a completed trusted producer and durable release, stage each with real attestation verification, then update pins.json together. Never fill Mac hashes from Linux outputs. Rebuild the root with the reviewed map, assemble packages, verify Linux invocation outside checkout and Mac enclosing seal/team/receipt rejection plus invocation. Keep adoption false until these gates pass. The retained Linux artifact from run 41886123555 is useful adapter evidence, not a substitute for final candidate pins or full packaged-app proof.

Installer exclusion contract: `with-install-lock.sh` uses the system Perl BSD `flock` binding (no flock utility). Rust and shell resolve the installation parent canonically and open the same sibling `.<app-name>.recipient.lock` with no symlink following. Locks must be owned regular files, mode 0600, with one link. They persist across release. Rust holds a shared lock before verification through child completion/cancellation; both Mac installers hold an exclusive lock before the destination process census through installed-tree writes. Busy fails immediately. Local installer reentry uses an internal environment marker; callers deliberately bypassing this mechanism remain outside the cooperative-writer contract.

Required signed Mac acceptance packet (UNRUN): use an isolated signed app with real reviewed recipient pins, record root/recipient/receipt identities and signing teams, invoke safe status/read login/full and evidence download. Hold invocation after verification and attempt each real installer: expect busy with unchanged installed hashes/seal; reverse ordering with installer held before census and expect invocation busy. Complete/cancel/fail each holder and prove subsequent acquisition, retaining the same lock inode. Then verify ordinary successful invocation, receipt mutation rejection, wrong-team rejection and exact owned cleanup. No TCC or capture is needed. Linux shell/Rust interoperability tests prove lock protocol only, not Darwin signing or this packaged acceptance.
