# Engine test audit

Current baseline: main `7eb349abbd00db6ef071f7bfa54732b98ab2a5cb`. Port only
the six reviewed source/support files from `b13331c97`; their baseline bytes and
Engine production inputs are unchanged from the original `cb1769661` audit. This covers the published movie SDK/native
provider and staged `capture/engine` admission/lease crate. The legacy native app
(capture/audio/cursor/ink/keyframes/export/recovery outside that crate) remains a
separate pending audit. No publication or production adoption is claimed here.

Read the SDK implementation, native Rust launch/output/Linux decoder, Mac
probe/frame helpers, producer build/qualification entrypoints and Record/Agent
consumer boundaries before judging their tests. Read all staged capture-core
production modules before all four integration files. Migration guidance retains
that staged package despite its absence of production callers; its library/API
safety guards are not obsolete donor tests.

## Bounded cleanup

C: one `tests/support/mod.rs` fixture replaces the repeated bootstrap/process/
review fixture constructors/destructors and manual finalizer setup/cleanup.
Retain random identities, explicit 0700 permissions and independent owned cleanup.
The finalizer case now gets cleanup during assertion unwinding too. Keep
`fixture_roots_are_private_distinct_and_independently_owned`: its sentinel checks
this shared fixture's privacy, separation and cleanup ownership. History
`6480941c8` records the previous process-fixture collision repair.

F: canonicalize the owned temporary base before creating fixtures. A controlled
symlink TMPDIR caused the original finalizer test to fail at `Runtime::open`
with `NotADirectory`, before its assertions. The same case passes afterward, as
does the explicit unsafe-runtime symlink/receipt test under that alias. Production
no-follow checks are unchanged. This restores the fixture rule previously recorded
in `68ab1e902`, lost in the later baseline restoration.

D from default execution only: `bootstrap_worker` and `worker` are dedicated
subprocess entrypoints that otherwise return success without work when their
environment is absent. Mark them explicitly ignored at top level and select them
with `--ignored --exact` in their actual callers. Parent GATED/READY handshakes
require real child execution. No contract test is ignored or deleted: all 21
parents/contract cases remain; both entrypoints still run inside those cases.

F: rename the SDK missing-runtime/deadline/cancellation case to describe its
actual oracle, distinct error results. Its old title also claimed process-exit
observation without an independent assertion. Keep every assertion. The API's
exit-before-rejection promise is not newly established by this rename.

Test/support delta including the new helper: 16 lines removed; no new declarations,
assertions, dependencies, production seams or product changes.

## SDK and real-provider keepers

| Cases | Retained contract / credible regression |
| --- | --- |
| probe: distinct container/video clocks and audio stream IDs | R: normalization loses the video clock or replaces provider-local identity with a filtered ordinal |
| probe: native edit segments; unavailable timings/audio-only | R: Mac edits disappear or missing native facts become fabricated playable values |
| probe: two display matrices/unknown rates | R: Linux/Mac rotation or numeric missing-rate interpretation drifts |
| probe: malformed metadata/times/duplicate IDs | R: unsafe or ambiguous provider output becomes trusted metadata |
| probe: real executable/literal argv/redaction | R: shell interpretation or native diagnostics expose private input |
| probe: missing runtime/deadline/cancellation | F/R: errors collapse into the wrong recovery classification; no new process-exit oracle claimed |
| probe: malformed/oversized stdout | R: truncated or invalid native transport is accepted |
| frames: literal argv/private bytes/request identity | R: path spelling, output anchoring or request association changes |
| frames: fresh owned private directory before launch | R: unsafe output is passed to the provider or existing bytes are overwritten |
| frames: malformed/pre-aborted request before launch | R: invalid requests or revoked work start a provider |
| frames: missing runtime/timeout/cancel/limit/native failure | R: independent frame-execution errors lose their typed/redacted disposition |
| frames: schema/order/count/path/bytes/mode/inventory/symlink | R: forged or unsafe frame output is accepted as complete |
| qualify.ts | R: the packed public SDK cannot read real native metadata/audio/rotation/silence or modifies source media |
| qualify-frames.ts | R: real decoded pixels, open-GOP/backward/duplicate/clamp clocks, edit offsets, scale/no-upscale, 480/481 limits, file privacy or source preservation fail in the delivered provider |

The fake executable tests exercise actual SDK process/transport boundaries; real
provider qualification additionally protects codec/platform and tarball/runtime
composition. These are not duplicate layers. The qualifier's bounded diagnostic
native rerun on failure rethrows the original error; it never retries into a pass.
Mac's forced sequential qualification protects an independent decoder path.

## Staged capture-core keepers

All existing parameter rows remain. Parent and child process/resource ownership
is tested through the actual API, not a mocked lock or fake durable receipt.

| Cases | Retained contract / credible regression |
| --- | --- |
| bootstrap: synchronized first bootstrap | R: metadata/anchor creation splits a live kernel lock; all eight fresh rounds must pass, not retry into success |
| bootstrap: durable identities across processes | R: full Unix/Unicode bundle identities use different or colliding lease namespaces |
| process: private/distinct fixture roots | R: fixture reuse or cleanup removes another fixture's sentinel |
| process: competing admission/killed owner | R: overlapping capture or a rejected request retries into a second take |
| process: failed record write | R: real child-scoped write failure leaks temporaries or replaces prior durable bytes |
| process: durable identity/interrupted receipt | R: wrong authority or identity mutates work; killed owner is inferred saved or loses its terminal receipt |
| process: unauthorized retry after owner death | R: recovery occurs before authorization and changes durable bytes |
| process: leases across processes/rename | R: read/write/finalize/capture cease excluding maintenance or rename breaks stable identity |
| process: finalizer/terminal receipts after exit | R: saved/fail/cancel/mismatch semantics or terminal idempotence fail across actual process death |
| process: crash after proof before publication | R: validated files alone manufacture a saved receipt |
| process: replaced/symlinked locks | R: metadata/recording/bundle lock substitution is trusted or outside bytes are touched |
| process: unsafe runtime/receipt identity | R: runtime aliases, writable roots or a foreign request receipt are accepted |
| process: exec versus fork descriptor lifetime | R: exec inherits authority or forked open descriptions release it too early |
| finalizer: all six post-validation mutations | R: changed bytes/directory, unsafe/unfinished markers, symlink or missing manifest becomes Saved |
| review: output/ancestor permissions before proof/at finish | R: a safe manifest bypasses unsafe directories or a later permission change remains trusted |
| review: durable production/caller identities | R: bundle stems, renamed outputs, receipts or distinct request/token authority stop roundtripping |
| review: manifest size versus receipt size | R: legitimate high-cardinality manifests are truncated or the separate 64 MiB bound disappears |
| review: distinct/invalid identities | R: case/Unicode/long IDs alias locks or path/control-byte identifiers are admitted |
| review: replaced output ancestor | R: proof survives an ancestor identity replacement |

## Evidence and remaining gates

Linux x64 producer baseline: the owning `engine/tools/check.ts` passed 13 SDK
cases, typecheck, tarball installation/public import, isolated native build and
real metadata/frame qualification. It created private artifacts, not a release.
Staged-core baseline: 23 top-level entries passed in PR #1400's normal hook;
two were no-op helper registrations. Candidate: 21 actual contract cases pass,
with those two helper entries ignored only at top level. SDK candidate: 13/13.

Sensitivity on a copied real crate: changing the unsafe-video marker guard makes
the finalizer keeper fail with Saved versus expected Failed. Omitting the child's
`--ignored` selection makes the bootstrap parent fail its mandatory handshake,
not silently pass with an unexecuted helper. Restored controls pass. Exact Rust
filters each selected one test. A copied emitted SDK mapping timeout to generic
failure fails the renamed classification case; restoring the mapping passes.
Production files in the checkout were not mutated.

Independent preservation review found no lost assertion/parameter row, resource
boundary or portability guard. Disposable evidence and probe recipes are under
`/tmp/apparent-dev-engine-audit-0H13BY/` and may need regeneration.

Mac provider execution, signed/sealed package delivery, native app adoption and
live capture are not established by the Linux baseline. Required hosted/platform
and exact-main delivery gates remain; no local Mac spending or manual release was
performed. The legacy native-app and other owner audit lanes remain open.

## Current-main delivery reconciliation

The normal hook at `294bf049e` freshly passed all 13 SDK cases and extracted
Linux metadata/frame package qualification. Its staged-core baseline passed 21
contract cases plus two existing no-op helper registrations. No current-main
SDK/staged production or baseline test drift was found. This reuses original
mutation evidence for identical candidate/owner bytes. Fresh controlled alias
proof against this main reproduces the old finalizer's `NotADirectory` setup
failure; the candidate finalizer and unsafe-runtime refusal control each execute
one case and pass. This uses a separate private crate/target, leaves production
unchanged and cleans the owned alias tree. Evidence:
`engine-sdk-fixture-current.log`, `engine-sdk-{old,current}-symlink.log`,
`engine-sdk-current-unsafe-control.log` and the current fixture receipt under
the private campaign job. Fresh candidate hook remains pending. No Record ancestor or
central campaign-ledger change is imported. The initial central ledger is still
carried by PR #1400; reconcile its Engine row after that ledger lands.

Normal hook, hosted/platform checks, merge and passing CI for the exact landed
commit remain required. Existing automatic publication is authorized; no manual
release or workflow dispatch. The whole-repository campaign remains active.

Current-main Luna preservation review approved all seven staged files with no
blocking findings. It independently verified base/HEAD, both new-file blobs,
empty unstaged diff and staged SHA-256
`50a53455488ab9366591fa54c8b54a45adfae7a146f1f5e53177000757726dd7`.
This was source review, not an independent execution of supplied proof. Only
this review metadata is appended afterward; the six source/support files remain
identical to the reviewed candidate.
