# Onboarding, permissions and Settings

## Opening the app

Opening Apparent from the macOS or Linux app picker opens Settings on About,
including when the app is already running. The shared Electron Settings shell
provides the sidebar to General, Recording, Storage, Permissions and Agents;
panes without an accepted Electron replacement retain their native presentation.
This launch slice reuses that presentation contract and its existing config writer;
it does not add a second preferences writer. Missing Electron assets or a failed
presentation retain the existing native Settings fallback. Removing that fallback
still requires acceptance of the remaining panes on both platforms.

On Linux, both the Electron Settings shell and retained native panes request a
managed floating dialog at 720×530, including when navigation replaces the window.
Tiling compositors can otherwise expand each replacement across the workspace,
discarding a manually floated window's state. This is a window-manager hint, not
an always-on-top overlay or a saved size preference; explicit compositor rules
remain authoritative. Existing pane routing and native fallback are unchanged.

Setup takes priority on an unfinished installation. Launching during selection,
recording or processing leaves the capture unchanged and does not queue a recording.
Explicit recording shortcuts and `app --record` keep their recording behavior.
A bare terminal invocation still prints help. Linux tray-host loss can still show
fallback controls when idle; an explicit app launch opens Settings instead.

### Mac development installation

Install and launch through `capture/desktop/scripts/packaging/install-app.sh`, or
`install-app-remote.sh` for remote installs, rather than running a `target/`
daemon. Cleanup can unlink a target executable and disturb its TCC identity.
Finish captures and quit the destination app before replacement; the installers'
process checks below still apply. Never reset Kit's real permission grants; use
the preview identity and approved isolated test environment. Keep release signing
and update storage outside `target/` and `/tmp`; see [release procedures](release.md).

### Electron Storage and About composition

The accepted Settings design keeps the six-page sidebar and bounds the reading
width. Storage shows the effective folder, immediate folder actions, the draft
retention policy and its Save/Reset actions, then measured folder usage. Optional
explanations open through focus, hover or click on labelled help controls;
environment overrides, fallback warnings and recovery instructions stay visible.
Refresh icons read current folder/policy state without saving a draft. Usage is
an explicit bounded scan, with its locally observed completion time.

About groups the backend's compiled version/revision (including modified or
unknown-build markers) with an icon-only Copy action. The restricted Electron
handler copies only that parent-provided identity, never renderer-supplied text.
Update results remain inline with their real check/install/defer actions and
approved frog artwork; no successful status or check timestamp is invented when
the backend has not supplied one. The GitHub support invitation and project
links, including Join our Discord, open the browser; Show welcome tour invokes the existing in-app workflow.
Focused controls own Enter/Space, so a version-copy or tour activation cannot
also accept an update. Existing native routing and fallbacks are unchanged.

## Mac menu bar icon

The Mac status item keeps the approved lowercase “a” at 18 points. It uses Lilac
on Carbon in dark appearance and the website's darker purple (`#7a58c7`) on
Paper (`#faf9f6`) in light appearance. The latter has 4.93:1 internal contrast.
It follows the application's inherited system appearance through AppKit KVO,
including live changes. A full-screen menu bar can stay dark in both system
modes, so the status button's own appearance must not select the icon variant.
There is no app appearance setting or restart requirement. The Dock/app icon
keeps its Carbon/Lilac colors. The Linux tray uses the same boxed variants; see
[Linux tray appearance](linux/linux.md#tray-appearance).
This is an OS adapter change, not a new Settings workflow;
the development Electron Settings window does not create a second tray icon.

Regenerate the light variant from the approved menu bar raster with
`swift capture/desktop/scripts/native/make-menu-bar-light.swift`; append
`--check` to verify shape, colors and contrast. Native acceptance still needs the running
candidate's status item in Light and Dark mode, in full-screen and normal windows,
a live transition without restarting the app, and an
open menu. An asset check or successful build alone is not that proof.

Read this before changing `capture/desktop/settings/onboarding.rs`, `capture/desktop/settings/settings.rs`, `composition/command_line.rs` or the helper's `Onboarding.swift`, `PermissionPanel.swift` and `Settings.swift`.

## Technical error reporting

General has one small **Send technical error reports** switch, on by default.
The opt-in Electron Settings surface mirrors its readback and toggle through the
same-user control socket; Rust remains authoritative. The existing native Settings
presentations and installed routing remain in place until the Electron slice is
accepted. Rollback is simply to stop opening the development Electron window;
remove the old native presentation only with the accepted Settings routing switch.
`errorReporting: false` in `~/.config/apparent/config.json` disables it without a
restart. Corrupt/unreadable config fails closed for reporting. The shared config
writer preserves unrelated keys and rotates private `errorReportingGeneration`
on every toggle, invalidating queued reports across off/on cycles. That generation
is never sent. Direct file edits apply at the next report admission; edit the
generation too when disabling/re-enabling between admissions. An already admitted
HTTP request can finish after opt-out. No disk spool or retries exist.

Desktop startup installs reporting only when packaging supplies the publishable
`APPARENT_POSTHOG_TOKEN` (`phc_…`) for the intended EU project. Without it, builds
never send. The fixed destination is `https://eu.i.posthog.com/i/v0/e/`; `curl`
must be available. CLI commands/tests never install the global reporter.
Live ingestion, grouping and alerts require bounded synthetic verification in an
isolated project before release; local HTTP tests are not that proof.

The payload allows only a static failure category, version/build, OS/architecture
and repo-relative source call site. Finalization diagnostics additionally contain
up to eight typed native stages with repository source locations and structured
I/O kind/OS error numbers, when available. These describe the failing boundary,
not the original error message; an unclassified error can still need local logs.
Schema 3 distinguishes audio state, writer backlog/history/length, writer
join/write/checkpoint/read, and WAV encode/read/format failures on both macOS and
Linux. `finalization.wav_error_kind` allows only `io`, `format`, `too_wide`,
`unfinished_sample`, `unsupported` or `invalid_sample_format` (otherwise null).
WAV-wrapped I/O failures retain their structured I/O kind and OS code. Neither
WAV format messages nor sample data are reported. These diagnostics do not
change the writer's backlog limit, save failure behavior or recovery guarantees.
Finalization fingerprints include the innermost known stage so unrelated failures
are not grouped solely by the Desktop completion call site. Historical groups
and installed older releases retain their old reports. No raw error/panic text, logs, recordings,
screenshots, transcripts, clipboard contents, window/device names, capture IDs,
share URLs or user paths. Each event gets a random identity; person profiles and
geolocation are disabled. No session replay/usage tracking. The receiving service
still sees the connection's IP address; transport is not anonymous.

New non-panic exception types use the same static operation code as their value
(for example `audio_start_failed` or `electron_renderer_gone`), rather than the
generic `DesktopOperationError`. Panics retain `RustPanic`. Fingerprints are
unchanged; historical event names are not rewritten.

Reports also carry the full compiled `commit_sha`, `build_modified`,
`package_version`, `release_version`, `channel`, `environment`, `component`,
`process` and `diagnostics_schema_version`. Packaging supplies public labels through
`APPARENT_RELEASE_VERSION`, `APPARENT_RELEASE_CHANNEL` (`stable`, `preview` or
`development`) and `APPARENT_REPORTING_ENVIRONMENT` (`production`, `synthetic` or
`development`). Mac preview packaging uses the app's preview version; Linux uses
the release tag or `linux-main-v2-<full SHA>`. Verify-only Linux packaging is
synthetic. Without packaging metadata, release is `unknown` and channel/environment
are `development`; the Cargo package version is not substituted for a release.
These values are frozen at compilation, never read from a user's runtime environment.

Publication also resolves a PostHog release in EU project `329943` and embeds its
public UUID as `APPARENT_POSTHOG_RELEASE_ID`; the native adapter sends it as
`$release_id` for Rust and forwarded Electron failures. Custom `release_version`
alone does not populate PostHog's Releases catalogue. Local/verification builds
omit the ID and do not register releases. Existing installed binaries and old
events are not retroactively linked by this change.

Coverage: desktop recording storage/audio/screen/phone startup, capture finalization,
video export, Linux/macOS update-check errors, and Rust panics after startup. This is a synthetic call-site frame,
**not a full unwound stack or native crash dump**. Segfaults, forced exits,
Swift/Objective-C crashes and failures before startup are not captured. The queue
holds at most 16 events, with 20 attempts/minute and a two-second HTTP timeout.
Ordinary failures only enqueue; a panic waits at most two seconds for best-effort
flush before chaining the previous hook. Full queues, exhausted rate allowance
or slow earlier reports can drop a panic report too; this is not complete crash
coverage. The narrow direct-HTTP adapter avoids
SDK autocapture/raw messages and independent retry queues; its exception schema
follows PostHog's Rust wire contract. Connect logging is unchanged.

Installed release Electron hosts also report main-process uncaught exceptions and
unhandled rejections, plus abnormal renderer/utility-process exits. TypeScript
owns the hooks and fatal-exit policy; generated CommonJS is staged with the UI
assets for Settings, onboarding and notes. Rust-owned child launchers admit this
only when the release reporter is installed; ordinary development hosts do not
send under a production build identity. The same config, queue and rate limits
apply. Only four fixed categories cross the same-user socket, never Error objects,
rejection reasons, URLs, process names, exit codes or stack text. Main-process
failures attempt admission for at most 600 ms before exiting; socket acceptance
does not prove delivery. An existing quit waits at most 600 ms for pending failure
admissions, so Notes can report its renderer crash before closing. Ordinary quits
without a pending failure do not wait. Exception admission bypasses the Settings
worker's config-write lock; it cannot mutate settings. Clean and deliberately
killed child exits are excluded.
Reports inherit the running Rust build identity and identify the affected process.
This provides process-failure categories, not JavaScript stacks or native dumps;
renderer JavaScript errors and hangs remain outside this slice's coverage.

## Onboarding (`capture/desktop/settings/onboarding.rs`, `capture/desktop/native/Onboarding.swift`)

The shared Electron Welcome page asks **Where’s ur agent at?** **Right here** opens
the existing pen picker without account setup. **Up in the cloud** uses the shared
Connect Settings controller. The `idk??` help page routes by whether the agent can
open files on this computer. The illustration assets and color/type roles are the
canonical onboarding assets and shared UI tokens.

Cloud setup shows the new-capture disclosure beside **Continue with Google**. That
action begins Connect's existing upload-consent and device-approval flow, then opens
the validated website automatically once. The website's explicit **Allow uploads**
action is the approval; a verified local upload connection advances directly to the
pen picker. A confirmed waitlist receipt offers **Continue locally** without issuing
credentials. Choosing local while a cloud request is active waits for durable upload
disable confirmation. Browser-close, expiry, network, local-state and receipt errors
never advance setup; automatic browser opening runs once per approval URI, and
**Try opening browser** is an explicit recovery action.
Connect remains the sole auth/credential/config writer, and the onboarding renderer
receives only its validated presentation and action contract.

Electron remains on the existing onboarding route. If its renderer/assets fail, the
existing native onboarding fallback remains local-only and continues to the pen
picker; cloud onboarding is not available in that fallback. Reverting the Electron
entry/Connect bridge restores the prior Welcome presentation while retaining the
existing native fallback. This change does not alter installed routing or config.

On Omarchy the shortcut page shows the actual desktop chord before acceptance and
also offers a custom shortcut. A custom choice uses the existing validated shortcut
writer (`shortcuts.record.source = "app"` retains that explicit preference even for
the built-in chord). It leaves the permanent Hyprland binding available and never
edits the user's compositor configuration. Electron confirms the custom choice through the two-use shortcut setup below;
the native fallback retains its existing trial. Linux sends mapped X11 control/whiteboard rectangles rather
than cached pre-compositor bounds. The coach clears those surfaces when space is
available, defaults near the top centre without an anchor, and removes only its own
Hyprland Lua window border. **Close guide** explains that an active recording
continues; Finish remains in the recording controls. Closing never fabricates lesson
completion. Native fallback remains available if the Electron transport fails;
its legacy account presentation remains local-only.

Rust decides what shows (`Flow`, `launch_plan`, `Gate`, tested) and stores progress under `"onboarding"` in `~/.config/apparent/config.json`, including the tour's current step (`resume`), so any quit (macOS's "Quit & Reopen" too) picks up there; the SwiftUI window in `apparent-helper onboarding` only renders the state it's sent and reports buttons (`grant:<permission>` for a row).
Progress saves on both platforms update only the current schema's leaves through
the shared durable config transaction. Unknown nested onboarding fields and other
settings survive; omitted optional schema fields are removed. A non-object
`onboarding` value rejects the save without replacing the existing file. This
native durability boundary remains the sole writer while practice policy is migrated.

Tour: agent choice → pen → required permissions → shortcut choice → guided capture → Done. Permissions share one checklist: Screen Recording, Microphone and Accessibility, in any order. Electron counts the accepted shortcut choice as practice one and shows **One more time.**; the next real shortcut starts capture. See [Two-use shortcut setup](#two-use-shortcut-setup) and [First-capture drawing sequence](#first-capture-drawing-sequence). The separate demonstration page is removed. An explicit replay from Settings clears tour milestones; ordinary quit/relaunch preserves completed shortcut setup. The native fallback retains its legacy trial and Continue action. Leaving unfinished shortcut recording cancels it and resumes hotkeys. Camera (iPhone) is outside the tour: its first use opens `Flow::fix(vec![Camera])` with one permission row.

The legacy `how-it-works` value remains readable in saved config, but routes past the removed page in both Electron and native fallback. Back navigation and step counts exclude it.

Input Monitoring is never asked for or read (macOS wants a relaunch after it; the enum variant stays only so 0.3.x configs load, and `input_monitoring_is_never_requested` greps the sources): clicks come from an `NSEvent` global mouse monitor (no permission), ⇧ and held modifiers from `CGEventSourceFlagsState` (no permission), keys from an active `kCGEventTapOptionDefault` tap (Accessibility), which the HID poller makes or stops every 500 ms as `AXIsProcessTrusted` changes (`check_key_tap`; live, no relaunch). Never poll key codes (`CGEventSourceKeyState`) or make a listen-only tap.

Grants are re-read every 0.5 s; the coordinator caches them (`ApparentCoordinator::grants`). On macOS the separately signed helper can disagree with the app: Accessibility's effective status comes from `AXIsProcessTrusted` in the recording process, matching the key tap and recording gate. Screen Recording comes from a fresh instance of that same recording executable via the hidden `screen-permission-status` command. It only calls `CGPreflightScreenCaptureAccess`, prints a JSON boolean and exits; it does not capture, request permission or write settings. A failed, invalid or timed-out check denies Screen Recording. The Swift helper still supplies device and speech permissions. A cached positive preflight in the running app must not override a fresh denial. The recording gate checks both that latest grant and this process's screen usability, so a revoked grant blocks a new capture even if macOS lets the old process record until it quits. Linux's portal permission behavior is unchanged.

This is a candidate repair for helper/app permission disagreement, not a confirmed diagnosis of an enabled macOS Settings switch remaining unrecognized. Acceptance still requires the signed candidate on macOS 15: grant, OS Quit & Reopen, onboarding readback and revocation. Existing Electron and native presentations consume the same grant contract; no rendering route or preference writer changes. Rollback restores the helper screen-status source; keep the passive command while its caller exists, and remove both together if that adapter is replaced.

On macOS one background poller runs for the app's lifetime, including when Settings and onboarding are closed. It delivers each successful read to the coordinator and both open windows; those windows do not start duplicate permission pollers. A revocation reaches the recording gate on the next successful refresh (500 ms between reads), without waiting for a window to reopen or running the helper on the UI thread. Linux keeps its existing window-owned polling and portal admission behavior.

macOS shows "Quit & Reopen / Later" the moment Screen Recording is granted, and a running process may not see the grant (`CGPreflightScreenCaptureAccess` caches). So once the fresh app process says granted, `read_grants` tries a one-frame ScreenCaptureKit capture in this process (`capture::screen_capture_usable(true)`); if it fails, `Flow::tick` shows "Reopening Apparent" for `RELAUNCH_AFTER_MS` and returns `Effect::Relaunch`, and the coordinator saves `Progress::relaunching` (tour `resume` = Permissions, or `reopenFix`) and `onboarding::relaunch()` reopens the app (without `-n`) after this pid exits. Quit & Reopen lands in the same place through the saved `resume`; a tour resumed on Permissions stays there. `relaunchedAt` stops a second automatic relaunch within `RELAUNCH_GUARD_MS`; the row then offers Reopen Apparent. `apparent sck-probe [--watch S]` / `apparent-helper sck-probe` test whether a grant reaches a running process.

Until the required ones are on, ⌥⇧S and the menu's record items start nothing (no picker or overlay; the picker sits at `NSStatusWindowLevel + 1` and takes clicks, which trapped macOS prompts under it): `Gate` holds the request and `tick_gate` opens or raises the window once the modifiers are up. Capture code must not call `CGRequestScreenCaptureAccess` or start the iPhone mirror without Camera: go through `ready_to_record` / `ready_for`.

When a row turns on, the window comes forward once macOS stops asking (no UserNotificationCenter or SecurityAgent window, no System Settings alert in front such as its Quit & Reopen; `returnAfterGrant`, for five minutes after the grant). Once Screen Recording works on Permissions or Try it, `Effect::ConfirmScreen` lists the screen once (after those questions, 1.2 s after the window is back) so ScreenCaptureKit's "bypass the system private window picker" alert comes up there, under a note saying to choose Allow (`View::picker_note`), rather than over the first recording.

Onboarding follows the system's light or dark appearance. The macOS window and its SwiftUI canvas resolve dynamic colors before the first visible frame and update together when appearance changes. Linux reads the desktop portal's color-scheme setting before opening the GPUI window, then refreshes the visible window when that setting changes; no user preference is written. Render every macOS screen and permission state with `apparent-helper onboarding --render DIR --light` or `--dark` (render-only overrides, not system preference changes).

Rows for draggable lists (`Permission::draggable`: Screen Recording, Accessibility) go straight to `OpenSettings`, which launches `apparent-helper permission-panel` (`capture/desktop/native/PermissionPanel.swift`) from the row's button: the card flies to just below System Settings (inside its empty lower area when the screen has no room; `PermissionPanel.dock`, checked by `capture/desktop/scripts/support/check-permission-panel-dock.sh`), drags the `Apparent.app` that contains the helper, reads grants from a fresh `--check` process (never trusts the drop), and is told `granted` when the row turns on. Preview it with `permission-panel --permission screen-recording --preview`; never `tccutil reset` Kit's real grants to test it.

### First-capture onboarding

First-capture onboarding is enabled by default. Set
`"experiments": {"onboardingFirstCapture": false}` to opt out, then restart the app
or reopen the tour. The opt-out restores optional shortcut choice and practice.
Existing users who already finished setup are not forced through it again.

In the native fallback, choose a valid combination in the inline recorder and
complete its separate trial before continuing. There is no preselected default or accept-current action.
Invalid or cancelled choices and an untested saved combination cannot advance.
A verified desktop-owned Linux binding instead offers **Use desktop shortcut**;
Apparent cannot rewrite that compositor setting. The next page asks the user to
try giving feedback on onboarding: start with the chosen shortcut, talk and point,
then press it again to finish. This is a local practice capture, not feedback sent
to the team. Menu-started captures and cancelled or failed attempts do not finish
the tour. A successful bundle completion advances to Done.

Closing before shortcut selection is confirmed leaves setup
unfinished, so it resumes on the next launch. `onboarding.shortcutChosen` and
`onboarding.shortcutTestedFor` persist shortcut setup; success marks `seen` and
clears `resume` immediately. `onboarding.firstCaptureCompleted` separately tracks
the guided capture lesson. Permission-repair windows retain their existing behavior.

## Settings (`capture/desktop/settings/settings.rs`, `capture/desktop/native/Settings.swift`)

### Apparent Connect (experiment)

**General → Connect** appears by default above Launch at login on
macOS and Linux. Opening it does not sign in, grant upload consent or enable
uploads. To hide the controls, set `"connectSettings": false` in the existing
`experiments` object in `~/.config/apparent/config.json`, then close and reopen
Settings. It adds no onboarding step and does not require `hostedSharing`. Without a configured `cloud.server`, sign-in uses
`https://hosted.tryapparent.com`; an existing valid custom origin is preserved.

**Sign in to Connect… → Allow and continue → Open browser** explains the full
upload scope before starting device authorization. The browser link carries the public code automatically; approve there, then return
to Settings. Settings does not ask users to match a code that the browser does not show. Website sign-in/approval is not
local success: **Uploads on** requires fresh local credentials, upload consent,
and enabled upload gates. Read-only credentials remain **uploads off**. New
captures may upload privately; existing captures are not scanned, and account
connection creates no public links. Sharing remains a separate experiment.

Cancel sign-in or close Settings to cancel authorization and durably turn uploads
off, including when cancellation races a late successful browser response.
**Disable uploads** cancels unfinished jobs but retains sign-in;
**Disconnect** additionally removes this computer's credentials. Neither deletes
already uploaded data. Cancelled jobs cannot silently resume after a later login.
**Check connection** performs a bounded authenticated background probe; ordinary
Settings refresh reads local state only. Offline, reauthorization, denied/expired
approval and local storage failures retain local capture and offer recovery.
If a disable/disconnect could not finish because local state was busy, uploads
remain blocked across restart. Use Disable uploads or Disconnect again to finish;
do not delete the client's pending revocation files. Failed state writes are not
presented as successful sign-out.
Native renderers only display the shared controller's view and emit commands;
raw errors, tokens and device secrets never enter its presentation contract.

Connect uses the accepted Paper card and the shared frog artwork, without a separate
section heading. The invitation reads “Help others see what you mean.”; successful
local activation becomes a compact confirmation. The top-right account control shows
the initial derived from the verified email on the active local grant, without
exposing the email to Desktop. Older credentials and unavailable identity use a
neutral person icon. Disable and disconnect first show a local confirmation; declining
it does not revoke or cancel anything. Confirmed commands retain the existing
revocation and pending-login cancellation semantics. Shared-link management is
available only through its existing feature gate and validated credential site.

Rust supplies typed presentation and action placement to GPUI, SwiftUI and Electron;
renderers do not infer success from status copy or browser approval. Success uses
#146B43, progress #7A58C7, preventive caution #FFBE2E with Carbon, and failures and
destructive actions #B42318. Each status has a label plus icon/bar; disabled controls
use Carbon at 45%, while explanations stay readable. The source for the reused art
is Public’s approved `assets/pond/belief/hug.png`; the runtime copy is owned by
`shared/assets/brand/connect-frogs.png` and packaged locally, never fetched from the site.

The opt-in Electron development window also presents this bounded workflow using
the same Rust controller and client, not a second auth implementation. Launch
and test instructions are in `../ui/frontend/README.md`. Its persistent socket
belongs to that window: reload/close/crash or an expired idle lease cancels pending
sign-in, including late authorization receipts. Local refreshes do not probe the
server. This does not change installed Settings routing; legacy controls remain
the rollback until equivalent native Linux and macOS acceptance is complete.

The shared config writer serializes CLI and GUI processes with a private
`config.json.lock` sidecar, held from before the file read until atomic publication.
Experiment edits include the nested map read in that transaction. Each writer
rereads the latest object, preserves unknown keys and secrets, writes a unique
`0600` temporary file, syncs it, then renames it inside a pinned canonical parent
directory. Config and lock symlinks are refused; the lock must be an owned private
regular file with one link. Parent directories must be trusted (a private ancestor
may protect otherwise group-writable descendants). The lock contains no preferences
and is not removed on unlock. Existing malformed/unreadable config still fails
closed. External editors do not acquire this advisory lock; normal setting read
timing is unchanged. Hosted operations acquire their queue lock before this lock,
never in reverse, and no network operation holds the config lock.

Native URL launch is a separate default-off experiment. See [native launch](native-launch.md)
for the exact `apparent://open` contract, explicit Linux handler registration and OS checks.

The onboarding pattern again. `apparent-helper settings` draws the `View` it's sent (General, Recording, Storage, Permissions, Agents, About; ⌘, or the menu's **Settings…**, and **Open Settings** on onboarding's last screen) and reports actions as JSON lines; `Panel` decides and writes `~/.config/apparent/config.json` through `handoff::set_config_value_in` (other keys and `0600` kept). If an existing config is malformed or unreadable, writes fail instead of replacing it with a new object and losing preferences.

Both shortcuts live under `"shortcuts"` (Carbon `keyCode`/`modifiers`/`label`; absent means the platform default, and `"paste": null` turns paste off; 0.3.x's file under Application Support is moved across once). Record defaults to standalone Fn on macOS (`keyCode: 63`, no modifiers, label `Fn`) and Alt+Shift+S on Linux; Paste remains Alt+Shift+V. Explicit custom shortcuts remain saved. An explicitly saved shortcut, including the former Record default Alt+Shift+S, remains unchanged; only an absent Record preference inherits Fn on Mac. Reset adopts the platform default. Linux's managed desktop binding keeps source precedence and is not changed by reset.

The editor accepts supported single keys as an explicit choice, and Fn alone on Mac. In Electron onboarding, choose **Use Fn**: macOS Fn flags changes do not reliably arrive as ordinary renderer key events. This selection uses the same validation and settings writer as captured keys. Fn is a press/release toggle: release Fn once to start, then release it again to finish. Pressing another key or modifier while Fn is held cancels that gesture; repeats and cancelled presses do not toggle. The 400 ms rapid-repeat guard remains. Fn+another-key and Fn with extra modifiers are not bindings. The native Mac event tap observes Fn flags changes because Carbon cannot register Fn; it only acts on a standalone release and clears pending state when shortcuts pause, the tap is disabled, or another key/modifier intervenes. The tap passes events through and still depends on Accessibility. macOS may also map Fn/Globe to Dictation, Emoji, or another OS action; Apparent leaves that setting and its permissions untouched, so the OS action may happen alongside recording. This binding is available only when the hardware/OS delivers the Fn event. Do not assume every keyboard exposes the same Fn/Globe key.

Reset in Settings restores the platform default; choosing another shortcut is the rollback path. The existing Engine settings adapter still loads and writes `shortcuts` before the Electron frontend starts, so it remains authoritative for startup and native registration. The editor's TypeScript boundary validates capture input independently, while Rust keeps provider/reserved-key validation and the existing single config writer. Move default/persistence ownership only after Record exposes an independently testable preference provider consumed by startup and Settings; remove the legacy adapter only after those consumers and the native event path are verified on Mac and Linux.

Each shortcut shows only its keys, as rounded keycaps with a little depth in a recessed field, like Hex's control (`capture/desktop/native/ShortcutKeys.swift`). Holding its modifiers while Settings is in front sinks those keys onto their bases and turns the key red. Listening tints the field red: a dot breathes beside "Type a shortcut", and modifiers land as they go down (in macOS order) and lift out when let go, with a red caret after them. An accepted shortcut's keys bob once, left to right. A refused one turns red and shakes before the old keys return, with Rust's reason in the caption. Every value is a closed-form spring evaluated at a time (`Track`, `KeyController`), so the helper draws any moment the same live or rendered, and the TimelineView stops when the keys are still. Clicking a shortcut's row sends `record-shortcut`: Rust pauses every Apparent hotkey (`capture::pause_shortcuts`: Carbon unregistered, `emit_*` muted) so the current combo reaches the recorder, then `settings::validate` checks supported keys, system-reserved combinations and the other shortcut; `capture::set_shortcuts` registers chords and restores the old ones if `RegisterEventHotKey` refuses. A custom combo matches exactly in Carbon and the key event tap. Paste can be turned off (`ShortcutKind::can_unset`; Record can't, it's the way in) with the × beside its field or Delete while it listens (`clear-shortcut`, `Pressed::is_delete`): `ShortcutConfig::unset()` registers nothing and matches no key, and the field shows "Set shortcut".

On Omarchy, Hyprland's `code:201` is the Copilot key. The onboarding and Settings shortcut recorder accept unmodified Copilot and Super+Shift+Copilot. At launch Apparent reads an exact `o.bind("code:201", "Apparent: record", "…/apparent shortcut record")` or `o.bind("SUPER + SHIFT + code:201", …)` definition from `$XDG_CONFIG_HOME/hypr/bindings.lua` (or `~/.config/hypr/bindings.lua`) and checks that the physical key, modifier chord and unique live binding match, and that its command is executable. Hyprland 0.56 hides Lua `code:N` identities in `hyprctl binds -j`; Apparent pairs that inventory with `hyprctl binds`, verifies the complete ordered row sets and fingerprints against JSON snapshots taken before and after, then normalizes supported displayed chords. Unsupported or multi-key rows, changed snapshots and modifier mismatches fail closed. Known `code:201`, `F23`, `XF86Assistant` and `LaunchAssistant` bindings on the same chord count as conflicts; a different known physical code such as `code:12` does not conflict just because its modifier mask matches. If the identity cannot be safely established, Apparent refuses the Copilot chord. This external system shortcut takes precedence over Apparent's saved record preference and default: Settings and Review show that exact chord for Record, mark it as managed in Hyprland, and do not install a second recording binding. Any old Apparent-described Alt+Shift+S binding in the live compositor is removed at launch. Change the binding in Hyprland, reload it, then restart Apparent. If the definition or live binding is missing or ambiguous, Apparent uses its saved shortcut or default instead. An Apparent-owned Copilot shortcut can be stored as `"shortcuts": {"record": {"keyCode": 201, "modifiers": 768, "label": "Super+Shift+Copilot"}}` (or modifiers `0` and label `Copilot`; 0 is unmodified and 768 is Super + Shift in Apparent's stored modifier format).

Recording without speech: `microphoneEnabled` in `~/.config/apparent/config.json` defaults to `true`. The app menu’s **Microphone for next capture** and the Electron Recording control persist the same preference, preserving the selected input. A capture freezes that preference at permission admission: switching it during recording applies to the next capture. With it off, microphone permission is not required, no input is opened and no no-audio warning is emitted. The other capture permissions still apply. The existing `unfinished.json` recovery journal persists `context.microphoneCapture: "off"` before media starts; completion carries it into `apparent.json` and retires the journal. Engine consumes the legacy Desktop admission marker before starting its worker, so no microphone sidecar remains during recording or in completed bundles. Older marker-based bundles remain readable and are migrated on successful reprocessing.

Shift-click opens an Electron note near the click on release; Shift-drag still draws. Enter/Attach saves, Shift+Enter inserts a newline, and empty Enter closes without saving or erasing a saved note. Escape or clicking outside closes while keeping a draft for this capture. The counter follows the recording capsule, opens the compact notes list, and counts only durable saves. Notes can be edited or deleted from the list. Finish waits for already submitted saves; a failed receipt retains recording assets for recovery. Drafts are not exported as note metadata or summary text. Linux display video includes the popup while visible, including text not yet attached. This notes surface uses Electron by default; the existing capture controls and platform input adapters remain in use. Packaging includes its runtime. Removing this routing requires restoring an accepted notes surface, not silently dropping typed feedback. See the frontend README for routing and native acceptance gates.

Recording › Microphone (`capture/engine/runtime/audio/mic.rs`): `"microphone": {"id","name"}` holds an input id in `~/.config/apparent/config.json`; the name only labels a missing device. Absent = System default. Mac uses CoreAudio UIDs (also `AVCaptureDevice.uniqueID`). Linux with a PulseAudio-compatible server (including PipeWire) and `pactl` lists source names as `pulse:<name>`; `capture/desktop/linux/microphone.rs` opens the chosen source with GStreamer's `pulsesrc`, converting it to 16 kHz mono samples for the same capture buffer and Settings meter. A new capture waits for its first sample before accepting the source; a disconnected or unopenable choice falls back to the Pulse default shown in Settings, then to CPAL only if that default cannot open. It never changes the system default. Linux without a working Pulse server / `pactl` falls back to CPAL's available inputs; this may expose only the shared `default` or `pipewire` device, so distinct microphones cannot be selected there. Windows is unsupported; retained code is not a parity target. `mic::Watch` re-lists inputs while Settings is open: CoreAudio listeners on Mac, one-second checks elsewhere. `AudioRecorder` opens the chosen input on its worker thread, otherwise the current system default; a disconnected or unopenable choice remains saved but does not stop a new capture (`mic::Pick` explains the fallback in Settings and `note_pick` logs once). An error partway through a capture keeps samples heard so far. Mac's helper `MicMeter` uses AVCaptureSession; Linux GPUI Settings starts a separate input stream, stops it when leaving Recording, and expires stale level readings after 300 ms. The meter shows input samples, not recognized words or speaker identity; #16 owns no-transcript messaging. `apparent mic list|set <id|default>|watch` reports and changes the same saved selection.

Storage › Location (`CapturesDirView`): Change… opens the helper's folder picker and sends `set capturesDir` with an absolute path; Reset sends `""`, which removes the key. `handoff::default_captures_dir` reads it on every call (`APPARENT_CAPTURES_DIR` wins, then `"capturesDir"`, then `builtin_captures_dir`; `~` expands, a relative path is logged and skipped; tests never read the config). New captures and fresh CLI/size lookups use the new location; already-running retention/transcript workers keep their startup directory until the Rust app restarts. Captures already made aren't moved. The default Electron Storage route, native fallback and its proof limits are documented in `capture/desktop/ui/frontend/README.md`. A folder that can't be created or written falls back to the built-in one (logged once). State kept beside the captures (`inbox.json`, `last-mode`, legacy `config.json`) stays under `builtin_captures_dir`'s parent. The legacy config path stays under `builtin_captures_dir`.

Storage now opens the branded Electron Settings page by default; other Settings pages keep their native presentation. Set `experiments.electronCaptureLocation=false` and reopen Settings to use native Storage. Missing packaged assets or an Electron crash also restore native Storage. Rust supplies the policy/options/note, saves through the existing config transaction and measures the effective folder; the renderer never reads files. Saving/resetting schedules the existing retention worker for about five seconds later (deferred while recording); file edits are read on the next pass, normally hourly. Running workers keep their startup folder until restart. The native Storage presentation remains the opt-out and failure fallback. Activation, rollback, failed/stale results, usage scan limits and the exact old-UI removal condition are in `capture/desktop/ui/frontend/README.md#storage-retention-and-usage-291`.

Recording › Language shows under Transcription while it's Apple Speech: Automatic, then the helper's supported `locales` by name. It writes `appleLocale` (Automatic removes the key) and returns `Effect::SpeechModel`, which restarts the model check for the new language (see `capture/engine/docs/keyframes-and-text.md`).

The sidebar is the helper's alone: a row selects on mouse-down and its pane replaces the last on the next frame, with no transition (keep it that way; a fade read as lag; the level meter starts after the Recording pane has drawn). Rust's `state` never carries the pane (only `show` does, when Settings is opened again), so a reply can't move the selection.

On Linux all Settings panes, including Storage, stay inside the same GPUI window.
Navigation preserves its frame, position and focus. Storage has a native folder
picker, Change/Reset, effective-location readback, retention presets/reset and
Refresh Storage for folder usage. These use the existing Rust preference
transactions; picker Cancel writes nothing and existing captures are never moved.
An environment override or unusable saved folder is shown explicitly. Usage is a
bounded background scan on open or refresh, not continuous scanning. A folder
change affects new captures; an active capture keeps its original destination.
Restart after changing folders so the existing cleanup worker follows that folder.
macOS keeps its existing Electron Storage route and native fallback.

The Electron Settings shell waits for a committed React surface, initial paint
readiness and a hidden compositor snapshot before showing its window. The
TypeScript Desktop adapter discards that snapshot in memory; it is never saved
or sent. Startup still has the existing 15-second deadline and falls back to the
native pane if presentation fails. This does not change pane routing, settings
writes, the Storage opt-out or the native fallback's removal condition.

About shows the package version and the running binary's build-time commit, for example `Version 0.3.13 · ad8d4b1`. Tracked local edits add `+modified`; builds without Git metadata or a valid CI revision say `build unknown`. This identifies the compiled build, not the selected update channel or an update staged for the next launch. Both the Mac helper and Linux GPUI Settings use the same label.

About has a Star on GitHub button below the update control. Its heading, action and caption share one box in the Mac helper and Linux GPUI Settings. It opens `https://github.com/tryapparent/apparent` in the browser; starring remains the user's choice on GitHub.

Settings follows system light or dark appearance without storing a preference. The Mac helper resolves the SwiftUI theme from its environment and the titlebar background from a dynamic AppKit color; an open window updates when macOS appearance changes. Linux reads the desktop portal before opening, then watches its color-scheme revision and repaints the open GPUI window. Hovered buttons and menu items use black on light lilac (`#c4a9e6`) in light mode, and cream on dark lilac (`#302442`) in dark mode; the selected sidebar always has cream text. The Linux update result panel also follows the palette, including its secondary actions.


Settings › About includes a **Copy version** button that copies the displayed version
and Git SHA as plain text (for example, `Apparent 0.3.13 · 6885bac`). The Electron
version text can also be selected. Copying does not send anything.
Unsupported installations show **Updates unavailable**, with installation guidance,
rather than a disabled check action that could be mistaken for ongoing work.
The installed Electron About presentation and Linux native fallback use the same
parent version and update availability; routing and fallback remain unchanged.
The Mac legacy fallback retains its existing presentation until packaged Electron
About is accepted on both platforms.

Settings › About keeps its existing **Check for Updates…** action when updates are available. On Linux, a manual check
shows Checking… only in the disabled check button and ignores duplicate clicks until it completes. Its dismissible result has
one line only: **Update available**, **No update available**, or **Update check failed**, with
the same pixel frog jumping, lounging, or puzzled on its notched lily pad. Failures and
unexpected worker responses are logged; they never become “No update available” or
appear as raw diagnostics in the modal.
The current Linux `check_cli` feed contract checks **and installs**: “Update available” also
covers an image already installed for the next launch. It does not mean a discovery-only check.
That result offers **Update now** (quit, launch the staged AppImage after exit,
and reopen Settings on About) and
**Update later** (dismiss, leaving it for the next launch). The primary Update now action
uses brand Signal violet with Paper text; Update later uses the theme field and contrasting text and border.
Both use the brand's square geometry, 18px control type, and 44px hit height rather than
the compact pill buttons in Settings rows. The result panel has a square theme-colored field,
contrasting rule, 18px native status, and 8px-based spacing; failure text uses the semantic
failure color. Other results use a matching secondary OK action. Tab moves between
the choices, and Enter or Space activates the focused choice; Enter without a
focused choice chooses now. Escape defers. On other results Enter and Escape dismiss.
The app checks that an update is still staged before quitting; a failed relaunch request
shows the failure result instead of silently exiting. macOS continues to hand off to Sparkle's
native updater; it does not synthesize a frog result from a Sparkle launch.
Sparkle's committed update relaunch also reopens Settings on About. Its native
one-shot relaunch receipt is consumed at startup; ordinary launches do not set it.
About now uses the packaged Electron Settings shell with React/TypeScript and
shared shadcn buttons. The private parent pipe projects only version, update availability,
channel and check result; an allowlist accepts check, dismiss, now/later, tour and
validated channel changes. TypeScript owns result presentation and keyboard choices.
Native code remains the single updater/config owner and enforces capture-safe restart.
Other panes retain their current routing. Missing assets, spawn failure or a child crash
restore native About; Storage's existing opt-out is unchanged. Native About remains
the failure fallback until packaged Linux and macOS navigation, update, restart and
fallback acceptance passes and its build/consumer dependencies are verified removable.
No installed-route activation outside this packaged presentation is required.

Restart admission uses the shared coordinator's `capture_busy()` decision, including admitted
captures and detached finalizers whose capsule was dismissed. Settings/onboarding relaunches,
Linux Update now and Sparkle installation refuse while that decision is busy. Quit, SIGINT and
SIGTERM request normal Stop and wait for all finalizer receipts; a failed Stop leaves the app
open to show the error. The Mac AppKit termination guard cancels a busy native termination and
requests the same Stop path; its atomic boolean is only a copy of the coordinator decision.
Force quit/SIGKILL cannot finish a bundle: see narration-only recovery and durability limits in
`capture/engine/docs/capture.md`.

Before running `capture/desktop/scripts/packaging/install-app.sh` or `install-app-remote.sh`,
finish captures and quit the destination app. Both installers refuse replacement while an
executable inside that exact destination bundle is running, including its helpers; inability to
inspect processes also refuses. They do not kill other installations or CLI recorders, and
`APPARENT_NO_LAUNCH=1` does not bypass the replacement check. This is a pre-write snapshot,
not a lock that prevents a separate user from launching the destination during installation.

The three embedded illustrations in `desktop/assets/settings/` isolate the frog-and-pond scenes
from the selected concept. Each fits a transparent 256×192 device-pixel canvas; Settings
shows it at native device size, including fractional DPI. The rounded lily pads, water
ripples, coral cheeks, and the failed scene's broken cable and question mark remain.
The generated card background and labels are removed; result text stays native. Moss,
coral, and lavender in the artwork are **not new UI or status tokens**.


Launch at login writes `"launchAtLogin": true|false` to `config.json` before changing OS registration; if registration fails, it restores the previous preference. An explicit value is reconciled with `SMAppService.mainApp` (only inside Apparent.app) or Linux XDG autostart on app launch and every two seconds while running; stale Linux launch commands are refreshed when enabled, an absent value leaves existing OS registration alone without querying the OS service, and a disabled/approval-needed OS entry is not forced back on. OS approval is still done in System Settings. There's no Dock icon: gpui 0.2.2 makes the app Regular after launch despite `LSUIElement`, so `ui::stay_out_of_dock` sets Accessory again at the top of `run_app`. The menu keeps Record, Choose What to Record…, Open Latest Capture, Export (flag), Settings…, Check for Updates…, Quit.

Agents › Command-line tool (`composition/command_line.rs`) links the app's own binary as `apparent` without asking for admin or replacing a different program. On Mac it symlinks the real app binary (which is how it finds the helper) into the first writable of `/opt/homebrew/bin`, `/usr/local/bin`, else `~/.local/bin`; Linux's installed AppImage provides a `~/.local/bin/apparent` link. A bare `apparent` from a terminal prints help instead of starting a second app. Agents › Agent skill shows `bunx skills add https://github.com/tryapparent/apparent/tree/main/capture/agent/skills/apparent` (`capture/agent/skills/apparent/SKILL.md`, also printed by `apparent skill`), which is the capture-reading skill. The separate `make-it-apparent` walkthrough is installed explicitly with `bunx skills add https://github.com/tryapparent/apparent/tree/main/capture/agent/skills/make-it-apparent` (README › Agents); the default command does not guarantee its installation. This identity change does not migrate earlier captures, settings, OS permissions, or independently installed commands.

Agents › Ask for a Apparent video on complex changes toggles `"experiments": {"agentDemoVideo": true|false}`. Absent is on; set it to false to disable. Settings preserves other experiment flags and config keys; the next copy or paste reads the file without a restart. It adds a conditional request to the copied/pasted agent prompt, not the archived `summary.md`; automatic session delivery has been removed. The agent should only demonstrate a result it can actually see and report if recording is unavailable.

Render every pane (dark, light, each shortcut state: held, listening, partial, refused, accepted, custom; microphone chosen/missing/not allowed) with `apparent-helper settings --render DIR`, and one take on the shortcuts as 60 fps PNGs for a video with `--render DIR --shortcut-clip [--light]`; test with `cargo test settings::`.

## Lower other audio while recording (`capture/desktop/playback.rs`, `capture/engine/native/PlaybackVolume.swift`)

Off by default. General › Lower other audio while recording (`"lowerPlayback": true`) ramps the default output device's volume over one second to `playbackLevel` percent of what it was (Lower to, default 20%; 0 mutes) from the moment the shortcut is pressed or a recording starts, Mac or cabled iPhone, and back when it finishes, is cancelled or the picker closes without recording. `apparent-helper playback-volume --server`, started at launch while the setting is on, does the CoreAudio work and takes `start N` / `stop` lines on stdin. It reads every writable output channel's volume scalar before writing any (the master volume only when the channels have none), so balance and silent channels come back as they were; it never touches the mute flag or any input device. It restores when told to stop, when Apparent exits or crashes (stdin closes) and at once on SIGTERM, SIGINT or SIGHUP; it leaves the volume alone if someone changed it during the recording, and a device switched to mid-recording isn't lowered (the original device is restored). Fixed-volume outputs are left unchanged. Linux does nothing. `apparent-helper playback-volume --self-test` runs the ramp tests on fake devices; `--inspect` prints the current device's volume controls without changing them.

Electron onboarding permission effects stay in Rust: Linux uses its privacy
adapter; macOS keeps an installed `apparent-helper onboarding --permissions-only`
process alive for AVFoundation/Speech consent and permission guidance panels.
That mode never creates the onboarding window, admits only fixed permission
identifiers/actions, closes granted guides, and cleans up guides on pipe closure.
The Electron pipe carries presentation only. Linux onboarding explicitly uses
X11, matching GPUI and the notes/ink surfaces after the app clears
`WAYLAND_DISPLAY`; Electron must not auto-select an unavailable Wayland socket.
Native X11 anchor/board pixels are converted to Electron DIP, and setup/coach
windows fit the logical work area, including a scaled small display.
Native fallback remains available;
its presentation can be removed only after Mac permission/media and isolated
Linux acceptance. On Linux, onboarding and Storage share the Electron display-backend
launcher: when GPUI hides `WAYLAND_DISPLAY`, Electron receives
`--ozone-platform=x11` before its application path. An explicitly retained
Wayland display is left to Electron. About → Welcome tour and first launch use
the same route. Packaged assets route this workflow to Electron; missing assets, spawn failure
or a renderer crash restore the native presentation. During capture, construction
of a crashed presentation’s native replacement waits until capture ends. The
first-capture opt-out changes the workflow requirements; it does not select a
second competing onboarding surface.


The release-baseline onboarding candidate uses the existing packaged Electron route
for the approved pen picker, permission checklist, shortcut editor and floating
practice coaches. The lesson follows real whiteboard/screen ink, completion and
clipboard receipts, then asks the person to confirm a manual paste and open the
same practice bundle. Confirmation does not establish destination focus or audio
quality; installed platform acceptance remains required. `penColor` accepts
`coral`, `purple`, `blue` or `green`, loads at app startup and applies immediately
when saved in setup. Legacy strokes without a color retain red. Config writes
preserve unrelated keys. See [candidate admission and proof](onboarding-release-candidate.md).

### Compact practice illustrations

The shared Electron coach shows finite four-second key/gesture illustrations on
start/retry (the saved Record shortcut), screen drawing (Shift and drag), and
copied/paste (Command V on Mac, Ctrl V on Linux). The inline strip is about
68–74 points tall; secondary actions share a wrapping row to avoid excess blank
space in the existing 380×440 coach window. Replay uses the canonical shared
Button and restarts presentation only. Illustrations send no keys, draw no ink
and advance no Rust milestones. Polling does not restart them; changing practice
stage does. Reduced motion shows static keys/gesture and hides Replay.

Routing and native fallback remain available. The illustrations carry no
config/data migration and must not be treated as native acceptance. Browser
video uses synthetic onboarding state; actual Electron checks cover layout,
saved platform keys, finite playback, replay isolation and reduced motion. New
installed Mac/Linux acceptance is still required before publishing these illustrations.

During the whiteboard lesson, the Electron board view mirrors only human strokes
from the native board. Its loose animated example is a separate, inert overlay;
it is never sent to the capture adapter or counted as completion. Clear removes only real practice ink; replay never clears it. Single-point
clicks appear as round dots immediately and after native acknowledgement, matching
the saved drawing. Pointer cancellation and renderer
loss discard only an unfinished stroke; guide dismissal restores the native
whiteboard with completed human ink intact. Finish keeps its saved shortcut
keycaps and accessible close control; closing the guide leaves recording active.
Linux illustrates opening the already-visible Whiteboard control because capture
is display-only there; macOS retains the supported Screen → Whiteboard sequence.
Rollback is the existing onboarding renderer fallback. Keep the native board
adapter until both platforms accept the Electron path; removal requires verified
Mac and isolated Linux focus, geometry, capture and handoff behavior.

The control illustrations additionally cover Screen → Whiteboard, Finish →
Copied and the Apparent menu → Open Latest Capture. The real Rust capture phase
selects the coach; replay/illustrated clicks are local presentation only. Screen
selection can show only Screen, then the recording-stage coach demonstrates the
Whiteboard control. The location example opens its menu below the icon with an
arrow to the matching entry and uses neutral theme roles rather than wallpaper
tint. These remain finite, replayable and static under reduced motion.

### Required shortcut choice and trial

The Electron recorder keeps listening while Control, Shift, Alt or Super/Command
are pressed; press the final key after holding the desired modifiers. Linux
Copilot accepts any of these modifier combinations, including Control+Shift, or
no modifiers. Actual compositor binding conflicts still refuse the shortcut.
On the X1 keymap, Chromium can report XF86Assistant with no key identity; the
Linux adapter confirms the held physical code 201 against the native keymap
before passing it to the existing editor. An unidentified or already released
key cannot be guessed into a saved Copilot shortcut; retry if identification
fails. The observed X1 Carbon Gen 13 sends `XF86WakeUp` for standalone Fn.
The Linux recorder stores that as key code 95, label `Fn`, with no modifiers;
native X11/Hyprland registration uses `XF86WakeUp` and evdev `KEY_WAKEUP` maps
to that same identity. A dedicated WakeUp key is indistinguishable on this
input path. Firmware-only Fn keys that send no event remain unavailable. This
mapping targets X11 and Hyprland. KDE 5's KGlobalAccel adapter rejects this key;
other Wayland shortcut portals remain unverified and can refuse registration.
Mac retains its separate native Fn identity and explicit choice.
A permanent Hyprland Copilot binding can consume the key before Electron sees
it. During listening, its native Record callback offers the known desktop
binding to the shared TypeScript recorder, which submits it through the same
validated editor. Late offers after leaving/cancelling the recorder do not
select a shortcut. The permanent binding is preserved, not removed or rewritten.
While bindings are paused, Engine forwards this IPC callback as a separate
metadata event instead of a capture event. Desktop ignores it outside the
active onboarding recorder; ordinary capture/paste callbacks remain paused.
The existing Electron route, native fallback, single config writer and rollback
are unchanged. Removing the fallback still requires its existing acceptance gates.

The Electron first-capture tour requires an explicit shortcut choice. Choosing
and releasing the saved shortcut counts as the first practice. The host's
TypeScript selection policy accepts the native receipt; Continue is automatic
and the next prompt is **One more time.** The next real shortcut starts the
capture. Changing the saved binding requires another explicit choice.
`onboarding.shortcutTestedFor` retains the exact effective label for restart
checks. Completed users retain completion. A desktop-managed Linux shortcut
keeps its explicit acceptance path. The native fallback retains its legacy
separate trial and Continue action until its replacement is accepted.

Early setup shortcut presses show setup rather than ordinary recording. The same
setup policy guards menu, picker, agent and iPhone starts; Camera permission
checks and finishing an active capture retain their existing behavior. Closing
an unfinished tour leaves its progress intact; a shortcut reopens it first.
After selection, Electron automatically shows One more time in the setup window.
The next shortcut starts the real local
guided recording, and later presses retain normal finishing.
The explicit first-capture opt-out retains optional legacy behavior.

During screen drawing, the existing transparent Electron coach widens to 720 px
when space permits to show the approved trackpad helper beside the main guide.
Narrow displays keep the same helper inline with scrolling; enlarged text remains
reachable. It shares the existing window and disappears with the drawing phase.
Rust owns the phase; the illustration/hint never sends keys or changes progress.
Native fallback routing remains available until installed acceptance; disabling
the Electron route is the existing rollback. Real platform shortcut/permission/focus
and packaged acceptance remain separate from renderer and state-machine tests.

### First-capture drawing sequence

The private Electron input pipe uses an ordered native writer with at most 32
queued messages and 16 MiB total pending bytes (including the in-flight line).
Each line has a two-second delivery deadline including queue residence. Overflow,
write failure or a live child that stops reading sends the existing scoped
transport-exit event; capture/finalization never waits for pipe capacity. Existing
native fallback still defers replacement while capture is hidden, invalidates
old transport events and retains the sole progress writer. Native permission
helpers keep their existing transport. This bounds delivery only: trusted host
observation acknowledgements, attempt admission and lesson-policy migration are
still required before retiring `settings/practice.rs`. Rollback reverts the
writer and its Session transport variant together; there is no config change.

After a real whiteboard stroke, the whiteboard closes and the Electron coach
continues directly to **Draw on your screen.** The person must make a later,
separate screen stroke before the coach advances to Finish. The note lesson and
its Shift-click illustration are removed; adding notes remains optional, and the
existing notes editor, save receipts and bundle output are unchanged. Old in-memory
practice state at the removed `note` stage maps to screen drawing and requires a
fresh stroke, so it cannot mistake earlier screen ink for the next action.
Whiteboard and screen ink, paste confirmation and opening the current practice
bundle remain the actual completion evidence. The trackpad helper still appears
during screen drawing. Installed Mac/Linux acceptance remains required for native
focus, capture and bundle behavior; renderer simulation is not native proof.

Optional notes still use the existing editor and durable save receipt. On Hyprland,
the native adapter reconciles keyboard focus after placement for the current owned
editor request. Note positions convert native pixels to Electron DIP and back, so
scaled editors retain their complete controls.

The Electron first-capture start state keeps “One more time.” and the saved shortcut in
the setup window, shortened to 520 pixels with the keys centered in its content. It becomes the floating coach only after capture selection
begins; the next shortcut still uses the existing native recording path. Returning
to the start state restores the setup window. Native fallback routing is unchanged.

The removed demonstration has no Electron renderer/assets. Both Electron and native fallback skip its legacy step through the authoritative Rust route; rollback requires reverting that route together with presentation changes.

In the Electron pen picker, clicking a pen saves it and advances after the existing
frog hop (immediately after saving with reduced motion). There is no separate
confirmation button. Back from the following step returns to the picker without
advancing again; selecting even the same colour starts a new save. TypeScript
owns this transition and waits for the matching `penSaveId` emitted after the
native pen/config writer returns. Dispatch acknowledgement and earlier selected
state do not confirm a save. Save failure or missing confirmation leaves the
picker available to retry. The native fallback keeps its existing controls and
writer; this change does not change routing or introduce another config writer.

### Two-use shortcut setup

The Electron shortcut flow counts the accepted choice as the first practice:
choose the shortcut → **One more time.** → the next real shortcut starts capture.
The shared TypeScript host policy (`electron/onboarding/selection.ts`) consumes
only native selection and release facts. Its label-bound receipt is unavailable
to renderer commands; Rust rejects stale, held or fallback receipts and retains
the sole progress/config writer. No UI click starts a recording. The heading and
keycap share a centre with a 16px gap; the heading pops and the keycap depresses
on selection, with motion disabled under reduced-motion preferences.

The existing native fallback retains its legacy trial policy until that separate
surface is retired. Routing is unchanged; rolling back this slice removes the
host receipt and restores the existing native trial. This is a bounded move of
shortcut-practice policy into TypeScript, not independent onboarding release or
migration of the remaining Rust journey/progress writer. Installed Mac/Linux
shortcut release, capture-start and remembered-progress acceptance remain required.
