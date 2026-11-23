# Record Storage

`@apparent/record-storage` owns capture-location preference interpretation,
retention choices and the request/readback controllers used by Desktop's React
Storage surface. Renderer-controller ports expose bounded preference results and
usage, not files, revisions, credentials or arbitrary native commands. Its host
`LocationWorkflow` consumes revision-bearing native facts/probes, an OS chooser
port and allowlisted set/reset execution; it never exposes revisions to rendering.

```sh
npm ci
npm run build
npm run typecheck
npm test
```

These owner commands require Node >=22.18 and the locked TypeScript compiler.
They need no Rust, Electron, React or native build output. Public consumers load
compiled ESM and declarations through the package export; `npm pack` rebuilds
the fixed `dist` inventory. The Desktop build uses its own installed compiler to
build these same exports before typechecking/bundling its consumer, and generates
the Electron CommonJS location-policy and workflow adapters from the same source.

Reads supersede older reads. Mutations serialize admission and require a trusted
readback; failed or uncertain writes require Refresh before another mutation.
An uncertain reply never causes a write replay. Usage replies are retired when
preferences change and rejected if their effective folder differs. Disposing a
controller retires notifications and follow-up reads. It does not prove that an
open native chooser was cancelled or that a dispatched write was prevented.

Retention readback also carries the defaults reported by the native cleanup
policy. An older backend can still read and save preferences. Reset in Electron
requires the native pair so the user sees the actual limits before committing.
The renderer keeps the submitted pair visible through a pending write and any
uncertain result until an authoritative read succeeds. Bend owns the feedback
phase and Reset availability, and the package build bundles the compiled module.

The native config transaction remains the single durable writer, preserving
unknown fields/secrets, locking, CAS, cancellation before publication and uncertain
publication semantics. Native ports retain chooser execution, filesystem safety,
bounded scanning and active-capture exclusions. Startup-folder timing is unchanged:
existing workers retain their startup folder until the native app restarts.

Record owns location facts/probe resolution, chooser-result validation and
revision-bearing save/reset intent. Desktop retains Electron IPC, OS dialog
execution, shared mutation admission, window lifetime and presentation. The host
must hold that gate for `mutate` and supply its current lifetime check; the
workflow suppresses stale results and never replays writes. A thrown write or
post-publication resolution failure returns `outcome_unknown` for refresh.
`RetentionWorkflow` keeps executor revisions private, coalesces same-version
reads, validates save/reset intent and retires stale preference/usage replies.
Desktop supplies the shared version/lifetime check and holds the native-operation
gate for mutations. Invalidation retires pending replies independently; failed or
uncertain writes require fresh authoritative readback, including when a read
completed while the write was pending. Both renderer and native transport guards
consume Record's same bounded retention-policy validator.
Installed Linux Settings uses the existing Electron Storage surface in the
shared Settings window. The native fallback retains its controller and preset
menu. Both routes persist recognized retention leaves through the same native
Storage executor, preserving unknown nested keys. The fallback obtains a fresh
owner revision before saving; a concurrent change is refused without replay.
Engine no longer supplies a whole-object retention writer;
capture-time default resolution, native preset presentation and the cleanup
scheduler remain compatibility debt. This package's headless checks prove its policy and
controller loop. The [installed Linux checks](enablement/README.md)
cover native GUI acceptance. This package does not establish whole-Settings
build independence. Routing and fallback/removal gates remain in the frontend README.

## Renderer controller verification boundary

Committed modifications to `location-controller.ts` and `retention-controller.ts`
can use Desktop renderer verification without root Rust compilation when their
imports, public ports and method signatures remain unchanged and the audited
consumer inventory has no new references. Public additions and newly called
capabilities also fail qualification. Native-consumer source/build blobs are
pinned; changes require re-auditing that graph before later controller edits can
qualify. This catches indirect imports through the package barrel.
The ordinary frontend build consumes
the compiled package; Linux package/controller tests and actual Electron Storage
and Retention screens remain checked. The existing Mac Electron inventory checks
Hermes runtime and pill foreground, not these screens. Main still requires normal
packaging/publication and its applicable native acceptance.
New files, deletions, mode changes, new capabilities, shared validators/types,
host workflows, cleanup planning, compiler/dependency and staging changes retain
native integration. Unknown history or unavailable proof also retains it.
The qualification lives in `enablement/ci/routing/record-storage/`.
This is a compilation boundary, not proof of native chooser/config/cleanup
effects or a measured recurring CI speedup.

## Cleanup planning

`planRetention` owns age/settling thresholds, action priority and mirror-video
bitrate eligibility over bounded observations. Native CLI cleanup and the
background pass consume its compiled private-stdin worker; the after-capture
shrink job uses the same planner's separate `shrinkOnly` mode. Exact unsigned
64-bit facts cross the bridge as decimal strings. Returned indices refer only
to the native caller's observations; Record supplies no filesystem paths.

Native code retains pin/live/busy/recovery exclusions, filesystem observations,
claims, last-moment mutation checks, Trash publication and media encoding. A
missing or invalid plan fails before cleanup; failed background passes wait an
hour before automatic retry. Config reads keep the existing malformed-leaf
fallback, and the native Storage transaction remains the only durable writer.
The worker reloads retention preferences for each pass and retains its startup
captures folder until restart.

The app stages the compiled ESM worker separately from browser/CommonJS
controllers and requires its assets before native verification. Package checks
run the actual CLI over copied producer bundles in dry-run mode, preserving all
source/config bytes; they do not prove destructive cleanup or live capture.
Rollback restores planner routing, native donor decisions and staged assets
together, preserving the accepted native video admission and mutation guards.
Remove remaining native defaults/presets only with all their consumers
and persistence contracts adopted. Mac, AppImage and exact-main delivery remain
acceptance gates for this slice.

## Maximum storage

The shared Electron Storage pane shows capture-folder usage when it opens. Its
single size preference accepts decimal GB to three decimal places. The native
config transaction writes `retention.maximumMb` as decimal MB. Profiles with
no `retention` setting default to 1 GB. Zero keeps captures without a size limit.
A successful save nudges the existing cleanup worker.

An existing `retention` object without `maximumMb` keeps its age policy until
the first size-limit save. The save retains the previous age keys and any
unrecognized preferences. The legacy
retention controls can explicitly switch back to age-based cleanup by choosing
a preset. Removing only `retention.maximumMb` from the config restores age-based
cleanup. Removing the entire `retention` setting restores the 1 GB default.
The worker rereads the config on its next pass.

Size-based passes measure the effective capture folder's logical bytes.
Bend selects settled, finalized captures from oldest to newest, up to the
amount needed to meet the cap. Native deletion moves them to the Trash through
the existing worker and skips pinned, active, recovering or changing captures.
Unrelated files count toward usage and are never selected for cleanup. This is
a background cleanup threshold. Usage can exceed it while recording or when
protected captures and unrelated files account for the excess.

Record packages the compiled capacity module with both the Settings workflow
and the cleanup worker. The existing native fallback retains its older
location and retention controls while the shared Electron pane owns the cap UI.
