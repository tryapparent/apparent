# Onboarding workflow

This owner is being extracted under #575. `src/practice.ts` decides the existing
first-capture lesson from native observations; `src/session.ts` composes it with
progress persistence and injected host capabilities. It imports neither Electron
nor Capture implementation. Capture/request/generation identity, transport
revocation and displayed-stage revision protect the boundary. Replay animations
are presentation only and must never call the observation interface.

`src/progress.ts` owns completion intent and readback/retry decisions. The narrow
`native.rs` adapter compares onboarding leaves inside the existing shared config
transaction. It preserves unknown nested/root values and uses the same lock,
cancellation and durable executor as every other config caller. A failed or
uncertain write requires authoritative readback before explicit retry.

Development (Node 22.18+):

```sh
cd onboarding
npm ci
npm run typecheck
npm test
npm run build
```

The package has only TypeScript/Node type development dependencies. A clean copy
of its manifests, source and tests can install, build, typecheck and test without
Electron, Rust tools or native outputs. The compiled `.` (practice), `./host`,
`./session` and `./progress` exports also load in plain Node from an installed
tarball. `build` cleans only the fixed package output, refuses a symlink and emits
JavaScript/declarations. That proves the headless owner only.

## Production route

The existing Electron onboarding host loads `src/host.ts`, bundled into
`dist/assets/onboarding-workflow.cjs` by Desktop's Vite build and staged with its
other assets. Existing React/shadcn screens display its projection. Native
`Session` sends observations over the existing private parent/child pipe; preload
exposes only scoped user commands, never observations or progress writes. Desktop
builds typecheck the owner with their installed compiler/types, and Desktop tests
include the owner's tests. These consumer checks do not replace standalone proof.

`native/observations.rs` collects capture generation/ID/request ID, ink and durable
note observations, exact finalized bundle/clipboard receipts and shell-open
receipts. It contains no lesson stages. `Session::practice_completion` remains
compatible with the separate Record completion owner: the caller first enforces
native current-generation admission. A known copied receipt survives an unavailable
policy host. The current-main producer's temporary saved-bundle/observation adapter
is removed only after the released Record producer is adopted.

Each transport has a session identity, each admitted attempt has an identity and
each command includes the displayed stage revision. Native host messages also
have increasing IDs, consumed independently of the value/presence CAS. CAS detects
stale values; it is not an authentication or anti-ABA token. Close, later, EOF and
fallback revoke the host, including queued progress publication. Explicit retry
after an uncertain write reads authoritative progress before considering a write.
Neither a clipboard receipt nor a key press implies manual paste. Only the human
confirmation command counts. The matching bundle must subsequently be opened by
the shell. Opening it earlier cannot be replayed as a later lesson receipt.

Capture admission freezes local practice independently of the window lifetime.
Capture execution, note/ink durability, permission requests, real shortcut trials,
resource safety, clipboard writes, shell opening and overlay geometry stay native.
The workflow only asks to close the current whiteboard or finish its own guide.

## Fallback, rollback and remaining scope

Missing assets or a failed Electron child use the existing native setup fallback;
they do not start another policy service. The existing renderer-exit generation
filter retires queued commands. After a running TS host is retired, native fallback
does not mark its unavailable lesson complete just because capture finalized.
Rollback reverts the complete consumer/policy
slice; the compatible completion receipt method can remain for Record consumers.

Basic native setup/permission-repair progression, legacy progress readers and
ordinary Capture/Settings readiness still need the next bounded extraction.
The unused Rust practice donor remains only until the actual native seam is
accepted, after which its module and replaced tests must be deleted. Preserve the
released #1122 account/shortcut/geometry fixes when integrating refreshed main.
Installed Mac/Linux permission/input/focus/bridge/packaging and real bundle text/
image acceptance are required separately. Synthetic parent/window tests are not
native capture proof, and no CI lane or savings is claimed here.
