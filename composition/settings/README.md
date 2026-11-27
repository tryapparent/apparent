# Settings composition

The shared Settings shell assembles the installed Electron panes. About owns
its presentation and update-channel policy here. The installed entry supplies
the existing artwork and the restricted About bridge. Version identity,
clipboard, external links, update execution, persistence and native recovery
continue through their existing host and platform adapters.

The Desktop frontend build bundles the same update-channel policy into the
installed worker. Its test suite checks the source policy and executes that
worker with the repository outside its working directory. The About Electron
smoke exercises the installed entry and preload with a synthetic parent.
Native update execution and package acceptance remain platform checks.

## Installed routes and recovery

The native coordinator opens General from the menu bar, Linux tray and
controls, app shortcut, and the final onboarding action. Reopening an
existing Settings session from those entry points raises its current pane.
The launch request for an already configured app and the post-update reopen
target About. The recording pill can open Agents directly. In the installed
Electron window, General, Recording, Handoff, Storage, Permissions, Agents, Labs and
About share one sidebar and window. The native session filters actions against
the active pane and passes native effects and preference writes to their
existing owners.

Settings opens with a fixed 740 × 580 content area on Linux and macOS, regardless
of its starting pane. Electron disables user resize and fullscreen, and macOS
also disables maximize. Longer panes and enlarged text scroll within Settings.

Settings has one Electron presentation on Linux and macOS. A child exit closes
the session, releases the Recording meter and shortcut editor, and allows the
next Settings request to launch a new child. When package resources are missing
or Chromium cannot start in its sandbox, Settings is unavailable until the
runtime or installation is repaired. The Linux launcher uses the same sandbox
setup as the installed recording pill. OS permission prompts, device reads,
folder selection, updates and the authoritative config writer remain native.

Restore the previous presenters with a Git revert of the retirement change.
Existing config files need no rollback migration.

Ubuntu Desktop is outside the supported AppImage platforms. On stock Ubuntu
24.04 GNOME, AppArmor prevents the packaged Electron sandbox from starting.
[Ubuntu support via a .deb](https://github.com/tryapparent/apparent/issues/1774)
is deferred.

On Linux, the channel preference selects the source named by the separate
install action, which may install an earlier version. When the check finds no
update, About shows the result without an install action. Selecting a different
source clears that result and offers its install action. About reads restart readiness
from the native AppImage receipt independently of the configured channel.
Dismissing the offer or closing a failed restart keeps **Restart now** available
while that receipt still shows a staged image. About names the installed
channel beside **Restart now**, with a valid Stable release tag or abbreviated
Development commit ID when available. If restart fails and the receipt cannot
be confirmed, the selected source is offered for another install. The header
displays the running build identity. macOS opens the Sparkle check.

On Apple silicon, Stable About includes a secondary **Download Nightly** action
under App updates. The host resolves the latest installer from the Nightly
appcast and opens the exact GitHub release asset. The separate Nightly bundle
checks its own Sparkle feed and shows its version and commit in About. Nightly
starts with fresh onboarding, settings, shortcuts and recordings, and both
bundles reuse verified downloaded speech models. Both apps can run together.

Updater diagnostics schema 6 adds Linux curl transfer milliseconds (0–600,000)
and downloaded bytes (0–1 GiB). Invalid or unavailable measurements remain null.
These facts identify partial downloads reaching the total deadline without
sending content, URLs, paths or raw errors. Deadlines, retries, transaction guards
and reporting consent stay unchanged. A late stall and a continuously slow
transfer may still need further investigation. New facts require an updated
package and a new consented occurrence; historical reports cannot be enriched.

## Recording

Recording opens directly to its microphone and recording controls. The Record
shortcut is in General, T3 sending is in Agents, and experimental preferences
are in Labs.

Recording joins General, About, Agents, Labs and Storage in
the same Electron document. The native session filters actions and owns the
existing config transaction. The Electron host clears Recording facts and
cancels pending acknowledgements on a route change. A lost acknowledgement
leaves the saved value uncertain until the native state arrives.

After the ordinary frontend bootstrap, run `npm run build` in
`capture/desktop/ui/frontend` to rebuild the installed Settings renderer and
Bend module on Linux. Run the `composition/settings/enablement/shell/shared-shell.smoke.mts`
Electron test to verify navigation, keyboard operation, and save/refusal with a
synthetic native parent. For a real-provider check, stage the same Settings
package beside an unchanged native app built with the Recording bridge. Its
normal sidebar sends the same actions and writer acknowledgements. Pure pane
changes rebuild the JavaScript assets only.

## Permissions

The same Electron window presents Record's Permissions section and accepts its
actions only on the Permissions route. The renderer receives status and the
applicable repair affordance. The native presenter waits for an OS observation
started after the action before confirming a Recheck or applying a repair.
Returning to Recording cancels pending requests and closes any owned drag
guides. Screen Recording prompts come from Apparent, and the existing signed
helper handles microphone, camera, speech and the System Settings drag guide.
Reopening uses the guarded application restart and refuses while a capture is
active. On Wayland the command repairs input-device access, and screen
authorization stays with the capture-time portal.

## Optional recording performance

Labs offers **Share performance metrics**, off by default and independent
of error reporting. It covers every new screen recording that reaches a live
frame and finalization while opted in. Start measures native recording setup
through the first observed live frame. Finish measures the native Finish
request through the bundle publication result. A failed finalizer is tagged
as a failure. Set the switch off to invalidate that recording's previous
consent and any pending reports. A request already admitted may finish.

Release builds configured with Apparent's PostHog project token send duration
histograms and timing spans over OTLP HTTP to the EU project. Startup spans
include capture preparation, audio and video setup, portal calls where observed,
and the acknowledgement from Electron when its recording pill reports geometry.
The application log retains the same stage names and relative times for local
diagnosis. The acknowledgement does not establish when the compositor first
displayed the pill. Reports
include the build, operating system, length bucket, outcome, and timing
timestamps. Trace IDs are random and scoped to Start or Finish. The capture
content, paths, account identifiers, and consent revision stay local.
PostHog receives ordinary network metadata for each request.

Enable Application Metrics in the PostHog project to ingest histograms.
Use `recording.start.duration` and `recording.finish.duration` with
`service.version`, `os.type`, and `outcome` to compare p50 and p95. Include
the sample count when comparing releases. In distributed tracing, filter
by `apparent-desktop` and the trace's `service.version`, not only the currently
installed version. Expand Finish → finalizer for native function boundaries:
screen/audio/window shutdown, action context, notes wait, circle labels,
transcription, visual preparation, keyframe selection and decode, cropping,
contact sheets, artifact writes, whiteboard handoff, publication lock,
validation and durability. Worker spans retain their parent and actual overlap;
do not sum parallel durations. Operations that are skipped have no span. Child
completion does not imply success; the Finish outcome remains authoritative.
Each Finish trace retains at most 128 child spans, with `recording.spans_dropped` on
the finalizer. These are instrumented timings, not automatic stack samples.
The local Perfetto benchmark remains available for deeper stack-level diagnosis.

For example, query Finish p95 after filtering to successful bundles.

```promql
histogram_quantile(
  0.95,
  sum by (le, service_version, os_type) (
    rate({__name__="recording.finish.duration_bucket",outcome="success"}[24h])
  )
)
```
