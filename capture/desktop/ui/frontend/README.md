# Desktop UI foundation

Shared Electron Settings surfaces and a separate opt-in development window use
React/TypeScript, shadcn/ui and Tailwind. Installed routing and retained native
fallbacks are described per surface below. The development window has native
Linux and macOS checks with their own proof limits. No Windows support.

From the repository root, with Node 22 and npm 10 or newer:

```sh
cd capture/desktop/ui/frontend
npm ci
npm start
```

Open the current Rust Apparent app separately, under the same user and HOME,
then click **Refresh state**. The window never launches Rust itself. With no app,
it shows **Not connected**. `npm run preview` serves the built synthetic UI on
loopback; browser preview has no Rust bridge. It deliberately uses production
assets and CSP rather than a less-restricted Electron development server.

## Narrow contract

The existing producer is `capture/desktop/workflow/agent_capture.rs` and the
`None` action in `App::agent_request` in `capture/desktop/mod.rs`. The Electron
main process connects to `$HOME/.config/apparent/agent-control/capture.sock`,
sends exactly `state\n`, reads a bounded newline-delimited JSON reply, validates
`state.phase`, and returns only `{ status: 'connected', phase }`. Capture IDs
and other backend fields never reach the renderer through this state method.
This observes the **running Rust GUI**, not package metadata or a synthetic backend. It does not make Rust
independent of the current GUI lifecycle.

Missing/stale sockets are disconnected; unsafe permissions, invalid replies,
unknown phases and timeouts are errors. The control directory and socket must
belong to the effective user, be private, and not be symlinks. Nothing creates or
changes the Rust config directory. One absolute 3.5-second deadline bounds a
read. Reads occur only on open/renderer reload or manual refresh, with one
in-flight read and a one-second cooldown. There is no background polling.

The sandboxed, isolated preload exposes runtime state, selected-reference read/copy,
capture-location, retention/usage, Connect and typed error-reporting methods below.
The main process rejects other windows/frames, nonlocal URLs and unexpected arguments.
There is no generic IPC, shell, filesystem or recording command API.
Only bounded Settings workflows save their preferences; Copy ID changes only the clipboard.
Navigation, popups, webviews, network connections and permission requests are
blocked. Electron keeps its own Chromium profile in `apparent-ui-foundation`,
separate from the installed application's identity/config. These constraints do
not grant or reset OS permissions or change login/URL registration.

Synthetic states cover idle, recording, processing, uploading, preparing,
permission failure and error. They never drive the live state display. A copied
link is explicitly not a ready-to-watch recording. Shared controls and light
tokens live in `shared/ui`. After editing
shared sources, rerun `npm ci`; builds reject a stale installed snapshot.

## Experimental General → Apparent Connect

The default-on `connectSettings` flag also gates this opt-in window's Connect
card; an explicit false hides it. Visibility alone never enables uploads. Installed General connection actions open
`--settings-connect` when its packaged assets are available. This mode loads the
existing Connect card with a Connect-only preload, and no Storage, capture, clipboard
or reporting capabilities. It consumes the originating native action once after
a successful local read; renderer reload never replays it. Navigation returns to
the existing Settings pages. Missing assets and startup/crash failure restore the
native General presentation. No onboarding route changes. See
`../../docs/onboarding-and-settings.md` for consent and recovery behavior.

Electron main owns one persistent, same-user Rust socket/controller. Opening and
one-second local refreshes never initiate network access. Each bounded request
uses Electron's monotonic clock; a ten-second idle lease, EOF, renderer reload,
crash or window close drops the controller and cancels pending authorization.
Rust owns all consent, credentials, health probes and durable revocation; JS does
not read config or implement an auth client. Raw errors/config/device secrets do
not enter the renderer. Only an explicit zero-argument **Open browser** command
can open the current Rust-validated public verification URI; no arbitrary URL is
accepted from the renderer. Ambiguous commands are never retried automatically.

`tests/connect/transport.test.cjs` exercises real Unix-stream transport and projection;
`tests/connect/smoke.cjs` exercises shipped Electron main/preload/renderer against
an explicitly synthetic socket. `tests/rust-connect.cjs`, launched by the ignored
Rust `connect_settings_electron_rust_roundtrip` test, exercises the actual Rust
listener/controller/production client using Electron's real clock and a synthetic
loopback pending-device HTTP fixture. It verifies explicit consent admission,
public-only projection, durable cancel/EOF revocation and preserved config;
it does not approve a real account or upload media. Run it from the root with
`APPARENT_CONNECT_TEST_ELECTRON` set to the absolute frontend Electron executable:
`cargo test --offline connect_settings_electron_rust_roundtrip -- --ignored --nocapture`.
On Clanker, wrap the command once with `t3-build` as documented in `AGENTS.md`.
Neither check substitutes for native Linux/macOS acceptance. The earlier shell evidence below does not
certify this new workflow. Roll back by disabling `connectSettings`; missing packaged Connect assets or
a failed Connect window also restore native General. Do not remove the legacy
presentation until both platforms pass equivalent consent/cancel/recovery proof.

Background completion receipts are consumed only on a valid window request,
not while the stream is idle. Closing before the next read therefore retains
pending-login cancellation even when the server has already completed a grant.
File edits disabling `connectSettings` apply at the next command/receipt or
client authorization-predicate check, and within half a second for an otherwise
idle stream. Observing a disabled/unreadable flag closes that controller before
worker authorization. This is not an atomic filesystem-edit/network-dispatch
promise; durable upload withdrawal still uses Disable uploads/Disconnect.
## Selected capture reference

The **Selected capture** card ports only Copy capture ID, not capture review or history.
It reads the saved capture already selected by the running Rust GUI; it never picks
"latest", opens a capture or starts Rust. No selection disables Copy. Rust alone
derives the exact directory basename and updates the system clipboard as plain text.
The normal `copyCaptureId` default applies; an explicit config `false` hides both UIs.

Main/preload expose only `readCaptureReference()` and `copyCaptureReference()` with
no renderer arguments. The typed socket family is `{"reference":"read","deadline":N}`
or `{"reference":"copy","expected":ID,"deadline":N}`. Main retains the read ID, not
the renderer. Rust compares it to its live selection on the GUI thread, rejects stale
IDs before writing, and checks a maximum three-second admission deadline using the
same clock translation as Storage. Replies expose only a nullable basename, copied
boolean or enumerated error—not paths, summaries, history, config or raw errors.
There is no automatic retry, paste, upload or mark-handled effect. Refresh is explicit.

Routing remains `npm start` opt-in; installed routing and the working GPUI action are
unchanged. Close the foundation window to roll back to the existing presentation;
`experiments.copyCaptureId: false` disables the action in both. Remove the GPUI donor
only after the corresponding shared capture/handoff routing is separately accepted
and its macOS/Linux native behavior is verified. This slice does not authorize that
routing switch or a desktop review workspace.

`tests/reference-native.cjs` exercises real Electron, Rust selection, native clipboard
PNG replacement, repeat dispatch, stale-selection refusal, no-selection and opt-out.
It refuses a personal desktop: macOS requires a disposable GitHub-hosted runner;
Linux native mode requires the isolated VM, while its explicit Xvfb mode is integration
proof only. Pass absolute `APPARENT_REFERENCE_BINARY` (installed App on Mac) and a fresh
`APPARENT_REFERENCE_OUTPUT`; set `APPARENT_REFERENCE_VM=1` in the Linux guest, or
`APPARENT_REFERENCE_XVFB=1` under `xvfb-run` for integration. Screenshots contain only
the owned generated-fixture windows and stay outside git.

## Storage retention and usage (#291)

Installed Settings routes Storage to the branded React presentation by default.
`experiments.electronCaptureLocation=false` restores the native Storage page on
its next open. No retention policy is changed by enabling the presentation.
`readRetention()`, `saveRetention(preset)`, `resetRetention()` and
`readCaptureUsage()` are the only additional preload methods. Only Save takes
an argument: a validated `week`, `month` or `forever` identifier. Rust supplies
the option labels, current/custom policy, policy note, effective path and
formatted logical-byte usage. No renderer-provided path, config, revision,
deadline, filesystem, shell or arbitrary IPC operation is accepted.

The existing bounded socket worker admits `retention`, `saveretention`,
`resetretention` and `usage` through its unchanged activation/expiry gate.
Main retains the last authoritative retention revision; a concurrent edit
conflicts rather than silently overwriting it. The existing config transaction
preserves unrelated top-level and nested policy keys and secrets; Reset removes
only the recognized retention fields, restoring `Policy::default()` (7-day
media/30-day bundle policy). A custom hand-edited policy remains visible until
explicitly replaced. Writes fail closed, including malformed/unsafe config;
failed or outcome-unknown saves require a refresh and are never retried.

Saving/resetting nudges the **existing** Rust cleanup worker, as native Settings
does: it schedules a pass about five seconds later, deferring while recording.
The worker reloads policy on each pass; manual config edits apply on the next
pass (normally hourly; first launch pass after about 90 seconds). It retains
its startup capture folder until app restart. Nothing in the bridge runs a
cleanup pass or moves a capture; normal policy cleanup remains unchanged.

Usage scans the freshly resolved Rust effective location, not a cached renderer
path, on open and manual refresh only. It counts logical file bytes (not free
space or physical allocation), does not follow symlink entries, and returns
an error rather than a partial total on I/O failure, expiry, its 100,000-entry
limit or a directory nesting depth of 256. A missing root is empty.
Main and React discard old replies after a
location mutation, save, reload or unmount; the renderer also checks the returned
effective path. Loading/error states hide old totals, and Retry never starts
Rust. A slow filesystem syscall can outlive client expiry; the existing single
Storage worker stays busy rather than spawning unbounded scans.

The Rust Settings session owns navigation and the Electron child. The installed
page contains Storage only, with the existing Settings sidebar and system-following
light/dark Paper/Carbon/Signal palette. Other sidebar pages return to their native
presentation. Retired windows cannot send commands or close the current page.
Closing Settings cancels the session; an Electron crash restores native Storage.
Missing packaged assets also fall back to native Storage. Reopen Settings after
editing the opt-out. Saved preferences remain readable by both presentations.

`stage-settings.py` builds the locked frontend/runtime into Linux AppImage and Mac
installer/release packages. Installed packages contain no development dashboard or
synthetic examples. Node/npm are build prerequisites, not runtime dependencies.
macOS stages and signs nested Electron code before the enclosing app is signed.
The old Storage presentation is retained solely for the explicit opt-out and
startup/crash fallback. Remove it only after exact-candidate installed Mac/Linux
acceptance and a deliberate retirement of that fallback contract. Functional
transport tests and synthetic backend fixtures remain verification tooling.

`tests/retention-smoke.cjs` exercises production Electron with a **synthetic**
socket (save/reset/readback/write error/loading/usage error/stale results,
keyboard/responsive layout and bridge rejection). `tests/rust-storage.cjs`
extends the real Rust/Electron contract regression. The shared native assertion
helper `tests/native-retention.cjs` exercises production Electron against a real
Rust GUI in an exclusively owned disposable desktop, including genuine private
directory write/usage failures and file preservation. The existing Mac CI probe
calls it; only an executed, inspected run proves the Mac gate. Prior #277
native evidence does not cover these additional controls.

An isolated Omarchy run on `29cf0819` passed the unchanged native retention
helper against the frozen Rust GUI and shipped Electron 45.2.1. Inspected images
showed Month (30-day media/90-day bundles), reset to Week, genuine private-config
write refusal, usage failure without a stale total, and recovery to the measured
1 MB synthetic folder. Unrelated config and the synthetic file survived; Rust,
Electron, owned VM/overlay/firmware/sockets and expiry were cleaned up. This is
Linux Settings proof only, not timed Trash/cleanup, capture permissions or Mac.
No recording/bundle was produced; that guest reports a missing H.264 decoder,
and its walkthrough capture/export path was not exercised. Private evidence is
retained outside the repository; the PR records candidate identity and gates.


## Checks

Run Electron smoke files sequentially: Electron's lazy binary installation is
shared by both tests and concurrent first launches can race during extraction.

```sh
npm test                    # real Unix-socket fixtures; no GUI or Rust launch
npm run build               # strict TypeScript and production bundle
npm run test:electron       # real Electron, synthetic socket; needs a display
# On a headless Linux host:
xvfb-run -a npm run test:electron
```

For a Linux integration checkpoint before Mac access, run from the repository root:

```sh
(
TMPDIR="$(mktemp -d /tmp/apparent-ui.XXXXXXXX)" || exit 1
export TMPDIR
python3 enablement/owner_lanes.py --lane desktop-ui-integration --run --online
# Preserve this private directory if fixtures need diagnosis.
)
```

On Clanker, replace the Python command inside the subshell with
`/home/simon/.local/bin/t3-build -- python3 enablement/owner_lanes.py --lane desktop-ui-integration --run --online`.
Use the runner once; do not wrap an already admitted invocation.
The lane honors the runner's `T3_BUILD_JOBS` and runs npm unit tests, the existing
sequential Electron smoke script (including TypeScript/build) under Xvfb, then
both ignored `_electron_rust_roundtrip` Rust tests, with the absolute Electron
package executable supplied to `APPARENT_STORAGE_TEST_ELECTRON` and
`APPARENT_CONNECT_TEST_ELECTRON`. Those tests use the actual Rust listener and
controller with private temporary fixtures; the Connect HTTP account fixture is
synthetic. They run Electron in Node mode and need no display. No standalone
application build or installed app launch is performed.

The temporary root must be short, owned and mode 0700; failed fixtures may be
retained for diagnosis; the subshell preserves the caller’s TMPDIR.

Prerequisites: Node 22/npm 10+, Xvfb (`xvfb-run` and `xauth`), Electron's Linux
runtime libraries, Rust/system build dependencies and available build capacity.
The command above permits npm/Electron installation and uses Cargo `--locked`.
Omit `--online` for `npm ci --offline` and `cargo test --offline`; populate both
package caches first and set `ELECTRON_OVERRIDE_DIST_PATH` to an absolute,
preinstalled Linux Electron distribution directory outside this frontend's
`node_modules` (matching its locked Electron version). Offline mode requires
that executable before npm ci, preventing Electron's lazy downloader from
silently fetching a binary. Missing prerequisites fail rather than skip proof.
The ordinary `desktop-ui` lane remains lightweight and unchanged.

This checkpoint proves renderer/synthetic transport behavior and real Rust bridge
roundtrips only. It does not replace exact-candidate isolated Linux/Omarchy GUI,
portal/picker, permissions, capture/output or installed packaging proof, nor Mac
native acceptance. Follow `../../docs/native-testing.md` and
`../../docs/linux/linux.md`; required exact-SHA CI/release receipts remain separate.

The Electron smoke checks controls/keyboard use, disconnected/error/reconnect,
renderer reload, minimum-width layout, sandbox/Node isolation, navigation/network
refusal and rejection of a second renderer. It is not native platform acceptance.
`tests/native-smoke.cjs` is a disposable-guest-only Electron entrypoint. The
existing isolated Linux runner is `capture/desktop/scripts/linux/gui/gui-vm.py`;
follow `../../docs/native-testing.md` for template/access/lifecycle requirements.
In an owned disposable Mac, run it with `SCRAWL_GUI_OUTPUT` set to a private
evidence directory. Use a fresh private HOME for disconnected checks; for live
checks use the running Rust app's HOME and `NATIVE_EXPECT_CONNECTED=1`. It saves
only its own window, never the host screen. Native evidence is private, not a
repository asset.

The Linux native run connected to a frozen Rust baseline with recorded
provenance. NoMac verification on macOS 26.6.2/arm64 with Electron 45.2.1 passed
all 11 socket tests, the Electron interaction/security test and native window
checks. A subsequent run cloned published head
`ff420b5d7539a455e53b20e3c753475291103965`, built and installed the real Rust GUI
with the repository installer, and passed the native smoke with a live
`connected` / `idle` response. Its Error tab was a separately labelled synthetic
fixture, not a failed recording. The guest and queue ticket were cleaned up.
These are shell/bridge checks, not capture, overlay, permission, updater,
physical-device or performance acceptance.

## Experimental Storage card

The installed Storage bridge is on unless `experiments.electronCaptureLocation`
is explicitly false in the Rust app's `~/.config/apparent/config.json`. File edits
apply at the next request; reopen Settings to change presentation routing. The
separate `npm start` window remains a developer harness; it is not installed or
used by the Settings route. Browser preview has no Storage bridge.

`readCaptureLocation()`, `changeCaptureLocation()` and `resetCaptureLocation()`
accept no path, revision, dialog options or other arguments. Main reads the
revision from Rust before opening its parented native folder dialog. Cancel,
reload, navigation and closing the window discard an unfinished selection.
Change and Reset are single-flight. A timeout never retries a mutation: refresh
to establish its actual outcome before trying again.

The same-user socket accepts strict JSON `{storage:"read",deadline}`,
`{storage:"set",path,expected,deadline}` and `{storage:"reset",expected,deadline}`
frames with a trailing newline. `deadline` is same-host monotonic milliseconds;
Rust caps admission at three seconds and rechecks it after acquiring the config
lock. Storage uses libuv's clock: `CLOCK_MONOTONIC` on Linux,
`CLOCK_MONOTONIC_RAW` on macOS. The legacy Rust-client clock is unchanged.
`expected` is an opaque 16-hex stale-edit fingerprint of **only** the raw
`capturesDir` value, not a security token or portable content digest.
Other config edits survive; a changed capture preference refuses the stale save.
One worker handles Storage without blocking the GUI or queuing config writers.
Legacy state/start/inspect/stop/cancel requests keep their existing contract.

Rust validates paths, preserves unknown config keys, removes the saved key on
Reset, and returns authoritative saved/effective/display paths and source
(`environment`, `configured`, `builtin`, `fallback`). Revisions remain in main;
raw config and diagnostics never reach the renderer. An environment override
still wins over the saved preference. An unusable saved folder falls back to
the built-in folder. Existing bundles keep their recorded directory; nothing
is relocated. Subsequent captures resolve the new preference. Existing
background retention/transcript workers retain their startup directory until
the Rust app restarts; this slice does not change their lifecycle.

Rust config/socket tests and synthetic Electron tests are not native picker or
capture proof. The earlier Linux/macOS foundation results above do **not**
establish changed Storage behavior.

A separate disposable Omarchy run on the repaired Storage candidate exercised
the real Change and Reset buttons, real portal folder chooser, Rust config
write/readback and visible effective-location updates. Cancel preserved the
file; unknown fixture keys and an existing-file sentinel survived. Electron
45.2.1 and the rebuilt Rust GUI ran in a private HOME with outbound networking
blocked. The guest, disk overlay and expiry timer were cleaned up. This proves
that Linux Settings roundtrip, not capture output or Mac behavior.

The first guest inherited `GDK_SCALE=2` from its Omarchy monitor config despite
its scale-1 display, making the GTK portal chooser 2510×2002. Matching the
disposable guest's GTK scale to its display enabled real pointer Choose/Cancel.
A separate 1920×1080, scale-1 run verified the entire native dialog fits, actual
pointer selection/Cancel, renderer Change/Reset, Rust persistence and visible
readback. The app, persistent VM template and host settings were not changed.
The guest and expiry were cleaned up after the successful runs.

On 1280×800 the scale-1 GTK dialog still requests 1255×1001, even when given a
smaller GTK geometry preference. This remains a small-display desktop/toolkit
limitation, not an app-side size fix; do not mutate users' GTK settings to hide
it.

[CI run 41354248911](https://github.com/tryapparent/apparent/actions/runs/41354248911)
on slice `5d6fceed` passed the explicit Electron/libuv-to-Rust regression on Linux
and macOS. Its GitHub-hosted `macos-26`/arm64 job also passed the actual installed
Rust GUI + shipped Electron Storage flow with Electron 45.2.1: parented native
Choose, visible custom-path readback, Cancel with identical config bytes/inode/
mtime, and Reset to the built-in path. Unknown config fields and the existing-file
sentinel survived. The native picker, saved-state and reset-state images were
inspected; owned processes exited and the private fixture was removed. This
closes this slice's Mac Settings gate, not capture, permissions, overlays,
performance or replacement of installed Settings. The experiment remains off by
default; this evidence does not authorize enabling, merging or releasing it.

For an actual Electron/libuv → Rust clock and persistence regression (no GUI or
host config writes), after installing the frontend Electron binary, run from
the repository root:

```sh
APPARENT_STORAGE_TEST_ELECTRON="$PWD/capture/desktop/ui/frontend/node_modules/electron/dist/electron" \
  cargo test --offline storage_electron_rust_roundtrip -- --ignored --nocapture
# On macOS the executable is dist/Electron.app/Contents/MacOS/Electron.
# On Clanker wrap this command once with /home/simon/.local/bin/t3-build.
```

The default Rust suite ignores this dependency-bearing integration test; an
ignored case is not a pass. Root CI explicitly runs it after the existing
Rust checks on Linux and macOS, using those same jobs rather than a paid Mac
rental. The explicit run uses the real Rust listener and
shipped JS transport, actual hrtime deadlines, synthetic file-backed activation,
set/readback/conflict/expired/reset and malformed-config refusal.

The existing Mac root job also builds an isolated app with the repository
installer (`APPARENT_NO_LAUNCH=1`) and explicitly runs
`tests/mac-storage-native.cjs`. That CI-only probe uses the shipped renderer,
installed Rust GUI and native parented picker. System Events input is restricted
to the owned Electron PID; it checks the runner's existing automation permission
and fails rather than granting or resetting TCC. It also checks the reporting
toggle's default-on state, opt-out, authoritative readback, Rust-process restart
plus renderer-reload persistence, and explicit re-enable/disable. Synthetic reports and owned
window images are retained for seven days, including failures. A Linux skip or
an unexecuted CI definition is not native Mac proof. No Mac rental is required.

## Technical error reports

The reporting card is available without an experiment. `readErrorReporting()`
and `setErrorReporting(boolean)` share the existing private socket using only
`{errorReporting:"read",deadline}` / `{errorReporting:"set",enabled,deadline}`.
Main accepts the one Boolean only from its owned local main frame. Rust owns
default-on policy, fail-closed config reads, atomic persistence and consent
generation rotation; no config paths, tokens, raw config or error text reach the
renderer. Both Settings contracts share one rendezvous worker so a config-lock
wait cannot block capture controls. A mutation's deadline is checked again under
the config lock; unknown outcomes are never retried automatically.

This window does not replace installed Settings routing. The native toggle
remains until replacement Settings acceptance; rollback is to close this opt-in
window, not change the saved consent. Remove the old presentation only with the
future Settings routing switch. The reporting preference itself is not an
off-by-default experiment. A packaged PostHog token is required to send reports.

## Drawing controls (#355)

The development window's **Draw across displays** section reads active screen
recording status and mark count, and **Undo last mark** invokes the same Rust
undo operation as the native shortcut (desktop ink or a newer pin). Hold Shift
and move over the desktop to draw; Electron does not intercept pointer events.
Refresh explicitly after drawing. Pin Undo first persists deletion of its typed note; a failed or timed-out receipt preserves the pin for recovery. This receipt has a two-second bound. No recording is started, target changed or
permission granted by this section. Phone and lab sessions are unavailable.

Routing: `npm start` opens the development controls; the separately running Rust
GUI owns admission, capture, input and overlays. This adds no feature flag and
does not activate any existing experiment or switch installed launchers. Linux and macOS use per-display native
panels. These are OS adapters, not competing React ink canvases. The native
shortcut remains usable alongside this control, as keyboard access to the same
operation. Closing Electron rolls back to the installed native controls without
changing config or active capture state. Remove the legacy control surface only
after the shared shell is routed and accepted on both platforms and all its
callers/build/package inputs are verified; this slice does not authorize that
routing change or removal.

The same-user private socket accepts typed `drawing: read|undo` JSON with a
monotonic deadline. Main holds the observed recording revision; the renderer
cannot supply it. Rust validates the deadline and exact recording identity on
the GUI thread before mutation. Navigation invalidates the receipt. Requests
are serialized, never retried automatically; after an ambiguous timeout refresh
before another undo. No paths, capture contents or raw errors reach React.

Transport and renderer fixtures are synthetic checks, not native drawing proof.
Exact-candidate isolated Linux and macOS cross-display proof, bundle text/image
inspection and a verified playable video remain required before acceptance.

## Explicit public link from the selected capture (#171)

The Selected capture card includes Copy public link, followed by an explicit
anyone-with-link/non-E2E confirmation. Rust pins the selected completed bundle
path, filesystem identity and capture generation. Preparation runs off the GUI
thread; short `publicShare` start/read/deliver/cancel requests never carry a
renderer path or URL. Electron main retains the operation ID and expected capture
reference, rejects foreign frames/arguments and cancels on reload/close. Rust
checks current operation, selection, expiry and client authorization before its
single foreground clipboard write. Failed/ambiguous writes are never retried.
Cancellation stops future work; data already transmitted cannot be recalled.

This shares exactly one separate service-readable copy through #346, without
changing private encrypted transfers or local Paste. A copied link may still show
Preparing recording; the UI directs the recipient to the link for readiness.
Disconnected devices use existing Connect Settings; signing in does not create a
public link. No automatic-sharing preference or historical scan is introduced.

Routing remains the existing Electron development window (`npm start`); installed
native Copy link retains its refusal for encrypted captures. Close this window to
roll back. Do not remove the legacy donor or switch installed capsule routing
until this workflow passes real macOS/isolated Linux acceptance and the routing
switch is authorized. Socket/controller/browser fixtures are not native proof.

## Shift-click notes

The default-available notes surface runs `electron/notes/main.cjs`, launched by
Rust for a screen capture. It renders only the nearby text popup and a small
saved-note badge/list beside the existing capture controls; picker, ink and
capture lifecycle remain on their current native path. There is no competing
Electron capture state machine. This is independent of the foundation Settings
window and requires no experiment. Packagers ship its production assets and
Electron runtime via `scripts/package-notes.mjs`; development must run `npm ci`
and `npm run build` before starting the rebuilt Rust app.

A private inherited pipe carries click-time anchors and bounded note commands.
Only trusted local main frames can submit draft/save/edit/delete/dismiss/list;
no renderer paths, window IDs, IPC names, shell or network commands are accepted.
Rust writes saved notes to `notes.json` before acknowledging/counting them;
unsent drafts stay in the capture's Rust session rather than note metadata/summary. Linux display video still includes the visible popup and its text. Enter with no text closes the
field and retains the pin. Escape keeps the in-capture draft; Shift+Enter adds
a newline. Capture completion closes this capture-local surface. Restarting or
ending a capture does not promise recovery of unsubmitted drafts.

The native menu and Electron Recording control share `microphoneEnabled` in
`~/.config/apparent/config.json`. It defaults on, preserves device selection,
and applies at the next capture. Off skips microphone admission/acquisition;
the bundle records `context.microphoneCapture=off`, including local recovery,
so intentional silence does not masquerade as an audio failure. Config writes
use Rust's existing atomic writer and preserve unrelated keys. No setting edit
interrupts active audio.

On Linux, Electron uses X11/XWayland. Rust checks each XID against this capture's
child PID and prepares it while hidden; Electron alone shows and hides it. The
compositor's visible pinned order can diverge from X11's input stack after focus
returns to the recorded app. The notes worker checks that stack at most every
100 ms and raises its visible surfaces only when needed. Renderer commands cannot
place windows. Counter/editor clicks are excluded from capture telemetry.

Rust owns the private Chromium profile and removes it after reaping Electron,
before the Finish receipt. Deleting it in Electron's `quit` event races Chromium's
last writes and can open an error dialog. Notes use the shared system-appearance
tokens while keeping the window background transparent.

Notes route solely to this Electron surface. Closing it leaves capture and
existing drawing running; a lost notes renderer must not claim a saved note.
The old pin/drawing path is retained, while no legacy note editor exists to
remove. A rollback reverts this slice and keeps already saved note events
readable. Native focus, positioning, Shift input and real output acceptance on
both platforms remain distinct from synthetic Electron/pipe tests.

The shared Rust resolver is `capture::desktop::workflow::electron::resolve() -> Result<Resources>`;
`Resources { executable, root }` supplies paths only. Surface owners launch their own
entry and own protocol, child cleanup and native acceptance. Assets remain in
`Contents/Resources/note-ui` on Mac and `usr/lib/apparent/note-ui` in Linux AppImages.
The executable is the existing Settings runtime at `Contents/Resources/settings/runtime`
or `usr/share/apparent/settings/runtime`; popup packaging adds no second runtime.
`package-notes.mjs` stages the required `electron/notes/` and includes `electron/share/`
when its `main.cjs` exists, alongside the same `dist/` and single `runtime/`. The absent
share consumer adds no entry or routing. A share owner must verify its installed route
on both platforms before enabling it; resolver availability alone is not that proof.

## Agents replacement slice

`AgentsSettings` in `src/agents/page.tsx` is the reusable Agents page body for the
installed shared Settings foundation. It is available by default with no new
activation flag. Only the installed Agents window exposes or accepts these
four narrow methods; the development window has no Agents controls or methods:
`readAgents()`, `installCli()`, `uninstallCli()`, `setAgentDemoVideo(boolean)`.
No renderer-supplied paths, commands, config keys or deadlines are accepted.
The command is displayed for selection, never executed by Electron.

Rust reuses `composition/command_line.rs` for OS paths and link policy and the
existing serialized config transaction for `experiments.agentDemoVideo`.
Unrelated config and nested flags survive. This existing preference defaults on;
file edits apply on the next read and the existing handoff consumer's next read.
CLI status excludes paths and distinguishes unavailable development binaries,
foreign programs, stale links, missing links and Homebrew-managed installation.
Homebrew-managed uninstall is refused. A created command may require the user to
add its directory to PATH; installed status does not prove shell discovery.

All operations use the authenticated same-user socket and shared rendezvous
worker, strict tagged requests, three-second monotonic admission, and bounded
response sizes. Demo writes recheck expiry under the config lock and before
publication. Main admits one Agents request at a time and discards stale replies
after navigation/close. No mutation retries; errors require explicit readback.
CLI syscalls already admitted can finish after a client timeout.
The existing explicit `storage_electron_rust_roundtrip` also checks the real
Agents read/demo write/readback and canonical command contract.

Installed routing now uses the shared page; see the routing section below for
failure fallback, explicit rollback and native deletion scope. Keep native Agents
until exact installed macOS and isolated Linux CLI, foreign-program, persistence,
keyboard/error and skill-command acceptance passes. Parent independent review
and platform gates remain.
No Mac rental is authorized for this non-issue work; an approved existing Mac
runner or other approved Mac access is required. No native acceptance is claimed
from socket fixtures, builds or the prior Storage evidence.

### Installed Agents routing (#376)

Agents navigation now opens the shared Settings shell and reusable Agents page by
default on macOS and Linux. Rust owns policy, config transactions and CLI OS
operations; the renderer receives only the four Agents calls and sidebar
navigation. Storage cannot call Agents; Agents cannot call Storage, Connect,
sharing, reporting, runtime, clipboard or filesystem handlers. The existing
packaged assets, UI-process ownership, generation and private parent pipe are
shared with Storage and installed Connect. Connect keeps its dedicated preload,
consume-once initial action, and Navigate/Close-only parent pipe. Returning from
Connect can select Agents or Storage; each replacement receives a new generation
and its own capability set. Other pages still use native Settings.

Missing assets, launch errors and renderer crashes reopen native Agents. Until
platform acceptance, explicit operational rollback is to restore the previous
accepted application package (no config or experiment changes). The retained
native Agents implementations are in settings_window.rs and native/Settings.swift;
remove only their Agents bodies, CLI/demo action/view presentation consumers and
obsolete presentation tests after exact installed macOS and isolated Linux proof
(including navigation, restart persistence, foreign CLI preservation and close).
Keep Rust policy/socket contracts and other native pages. Parent owns final
removal and platform acceptance; development-window evidence is insufficient.

The existing `tests/mac-storage-native.cjs` lifecycle now also runs its bounded installed Agents checks after Storage/reporting. It opens Settings
through the verified installed Rust PID’s owned status-menu Settings action, selects native Agents,
and inspects only its mapped packaged Electron child. It checks the visible
sidebar/title/canonical skill command, real focused Space toggles, authoritative
Rust/config readback with unrelated keys preserved, Rust restart/reopen,
navigation away/back, and window close with the daemon still idle and reachable.
No separate Electron Agents launch, debug port, renderer config write or new
workflow is used. The total fixture timeout is 180 seconds (150-second action
budget plus cleanup); existing Storage/reporting assertions and evidence remain.

CLI acceptance checks all Rust Mac candidates (`/opt/homebrew/bin`,
`/usr/local/bin`, private `~/.local/bin`, plus `~/bin`) before mutation. Any
existing command leaves CLI explicitly `UNRUN` and the overall fixture fails
incomplete. On the disposable GitHub runner only, an absent writable candidate
gets real UI install/status/uninstall, then an exclusively created synthetic
foreign file to check disabled Install and preservation. Cleanup removes only a
symlink with the exact installed executable target or the exact synthetic file
identified by device/inode/content; it never replaces an existing program.
This proves UI refusal, not a forced forbidden IPC mutation.

Source preparation is **not Mac acceptance**. Before executing, the parent must
supply the approved existing platform CI dependency (#366), the installed frozen
candidate with packaged Settings assets, an interactive GitHub-hosted macOS
session and existing System Events Accessibility/AppleEvents permission. No TCC
grant/reset or Mac allocation is part of this test. Unknown AX roles/tree shapes,
missing focus, native navigation shortcuts or packaged child mapping fail closed
with owned-window diagnostics; their actual compatibility remains unrun until
Darwin execution. The root job already provides the guard/output/app variables:

```sh
cd capture/desktop/ui/frontend
node --check tests/mac-storage-native.cjs
node --test tests/mac-storage-native.cjs
# Existing focused shipped Electron regression (Linux needs an isolated X display):
xvfb-run -a node --test tests/retention-smoke.cjs
```

For actual Mac proof use that same `node --test tests/mac-storage-native.cjs`
invocation in the existing job after its owned app installation; retain
`mac-storage-native.json` (`agents` included), Rust log and existing images with
the job's evidence handling. A non-Mac skip, syntax check or Electron regression
cannot certify Darwin compilation, AX/input, installed routing or native parity.
Native Agents removal, merge and CI acceptance remain the parent's gates.

Candidate native Mac Settings acceptance can be explicitly dispatched through
`Mac verification` with `settings_native=true` on the owned feature ref. That
focused job builds/installs the candidate and executes the existing native
Settings fixture only. It emits no full verification/publication receipt; the
full caller and reusable jobs remain main-only. Full CI runs after merge and
gates publication of the exact main commit. Native failure still blocks Agents
retirement and merge regardless of the absence of a branch full-CI requirement.

The focused Settings job uses Rust cache shared-key `rust` and the same three
workspace inputs as main, retaining the action’s platform/toolchain/lock
fingerprints. Cache-on-failure preserves completed dependency compilation after
a native fixture failure. Native AX evidence includes the verified helper window
and bounded partial traversal output; a timeout is not proof that a control is
absent, and never waives the native acceptance gate.

The focused job typechecks the test-only Swift AX reader before building Rust.
The fixture compiles its own hashed reader under the private evidence directory;
it directly reads the verified helper/Electron window and performs only the
listed Settings actions. The status-menu/close AppleScript remains separate.
This removes per-node System Events round trips while retaining the original
3.5-second call and whole-fixture deadlines, bounded traversal and uniqueness,
executable/PID checks, focused Space input and authoritative Rust/config readback.
Darwin compilation and execution remain required; Linux checks cannot prove them.

The focused candidate job selects `APPARENT_SETTINGS_NATIVE_SURFACE=agents`.
That runs installed Agents directly from the verified Rust app; the default
`all` entry still executes Storage/reporting and Agents. Each receipt states its
surface, so Agents proof does not claim a Storage picker pass. Failed earlier
picker evidence remains retained. Agents acceptance covers both false and true
Rust restart durability and owned foreground-window screenshots, as well as CLI
ownership, navigation and ordinary close with the daemon alive.

For the verified packaged Electron PID, the native test client requests
`AXManualAccessibility` using Electron 45’s documented assistive-technology API.
It does not change TCC, system preferences, product flags or renderer state.
The receipt retains the native request result and last returned tree before
content assertions, plus an owned-window failure image when available.

The Agents preload is authored in TypeScript (`electron/preloads/agents.cts`).
The frontend build emits the ignored `agents.cjs` at the unchanged runtime path;
packaging copies the generated preload and excludes its TypeScript source.
The same sandbox, typed operation names and main-process capability guards apply.

Electron 45 debounces the native assistive-client request for two quiet seconds.
The fixture sends `AXManualAccessibility` once for each newly opened packaged
Electron process, after its owned window is ready. Readiness polls and later
control reads never resend it; repeated writes would keep resetting activation.
The receipt counts accepted requests per process and retains the returned tree.

The native keyboard driver sends one checkbox focus request, then waits at most
800 ms for Chromium's asynchronous AX focus readback within the existing helper
deadline. It sends Space only after confirmed checkbox and application focus;
no focus request or keyboard mutation is retried. An accepted AX request alone
is never recorded as keyboard acceptance.

For a failed keyboard readback, the fixture retains the authoritative Rust state,
synthetic config, AX tree and an owned foreground-window image when available.
The input receipt includes the pre-input value, event/session modifier flags,
and confirmation that the app's focused window and focused UI element match the
owned checkbox. Space is suppressed on a target mismatch. These diagnostics
do not retry input or turn an accepted event post into a successful mutation.
